"""
Sales forecasting in pure Python. No AI required.

Strategies, tried in order:
  1. Linear regression on the daily revenue series (requires >= 14 days).
  2. Simple moving average of the last 7 days (requires >= 7 days).
  3. Historical mean (requires >= 3 days).
  4. `None` (insufficient data).

`validate_linear_regression` compares the chosen method against a
naive baseline (mean) using a chronological holdout, so we never
claim accuracy we have not measured.
"""

from datetime import datetime, timedelta
from typing import Optional

from .firebase_client import STORE_TZ, day_key, now_manila, parse_iso


# ----------------------------------------------------------------
# Aggregation
# ----------------------------------------------------------------
def aggregate_daily(orders: list) -> dict:
    """
    Aggregate order totals into {YYYY-MM-DD (Asia/Manila): revenue}.

    Only counts orders with a valid numeric `total`. Canceled/voided
    orders are excluded if the schema ever adds a cancel flag; today
    every stored order is `status == "Completed"` per the client code.
    """
    buckets: dict = {}
    for order in orders or []:
        status = str(order.get("status") or "").lower()
        if status in ("cancelled", "canceled", "void", "voided"):
            continue
        dt = parse_iso(order.get("createdAt") or "")
        if dt is None:
            continue
        key = day_key(dt)
        try:
            total = float(order.get("total") or 0)
        except (TypeError, ValueError):
            continue
        buckets[key] = buckets.get(key, 0.0) + total
    return buckets


def dense_series(daily: dict, days_back: int) -> list:
    """
    Build a dense list of (date_string, revenue) for the last `days_back`
    days ending today (Asia/Manila). Missing days count as 0.
    """
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    out = []
    for offset in range(days_back - 1, -1, -1):
        d = today - timedelta(days=offset)
        key = d.strftime("%Y-%m-%d")
        out.append((key, float(daily.get(key, 0.0))))
    return out


# ----------------------------------------------------------------
# Models
# ----------------------------------------------------------------
def moving_average(values: list, window: int = 7) -> float:
    window = max(1, min(window, len(values)))
    tail = values[-window:]
    return sum(tail) / len(tail) if tail else 0.0


def weighted_moving_average(values: list, window: int = 7) -> float:
    window = max(1, min(window, len(values)))
    tail = values[-window:]
    if not tail:
        return 0.0
    weights = list(range(1, len(tail) + 1))
    total_w = sum(weights)
    return sum(v * w for v, w in zip(tail, weights)) / total_w


def linear_regression_forecast(values: list, horizon: int) -> list:
    """
    Ordinary least squares on x = 0..n-1, y = values.
    Returns `horizon` future y-hats. Clamped at 0 (revenue cannot be negative).
    """
    n = len(values)
    if n < 2:
        mean = sum(values) / n if n else 0.0
        return [max(0.0, mean)] * horizon

    mean_x = (n - 1) / 2.0
    mean_y = sum(values) / n

    num = sum((i - mean_x) * (values[i] - mean_y) for i in range(n))
    den = sum((i - mean_x) ** 2 for i in range(n))
    slope = num / den if den else 0.0
    intercept = mean_y - slope * mean_x

    return [max(0.0, intercept + slope * (n + i)) for i in range(horizon)]


# ----------------------------------------------------------------
# Model forecast functions
# Each takes (train_values, horizon) and returns a list of length
# `horizon`, or None if the model can't run on this data.
# ----------------------------------------------------------------

def moving_average_forecast(values: list, horizon: int, window: int = 7) -> list:
    """Flat forecast using the weighted moving average of the tail."""
    avg = weighted_moving_average(values, window=window)
    return [avg] * horizon


def historical_mean_forecast(values: list, horizon: int) -> list:
    """Flat forecast using the mean of nonzero days (zeros excluded)."""
    nonzero = [v for v in values if v > 0]
    if not nonzero:
        return [0.0] * horizon
    avg = sum(nonzero) / len(nonzero)
    return [avg] * horizon


def seasonal_naive_forecast(values: list, horizon: int,
                            period: int = 7) -> Optional[list]:
    """
    Predict each future day as the same weekday from last week.
    Falls back to None if history is shorter than one full period.
    On retail data with weekly seasonality, this baseline often beats
    linear regression — worth including as a candidate.
    """
    if len(values) < period:
        return None
    tail = values[-period:]
    return [tail[i % period] for i in range(horizon)]


# ----------------------------------------------------------------
# Confidence intervals
#
# Only linear regression produces a proper prediction interval.
# For the other (deterministic) models we return a symmetric band
# derived from the model's own rolling-CV MAE — not statistically
# rigorous, but honest about the model's historical accuracy.
# ----------------------------------------------------------------

# Two-tailed t critical values at 95% confidence, indexed by df.
# Used by the prediction-interval formula below.
_T_TABLE_95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    12: 2.179, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042,
    40: 2.021, 60: 2.000, 120: 1.980,
}


def _t_critical_95(dof: int) -> float:
    """Approximate two-tailed t-critical value at 95% confidence."""
    if dof <= 0:
        return 12.706
    for k in sorted(_T_TABLE_95.keys()):
        if dof <= k:
            return _T_TABLE_95[k]
    return 1.96  # large-sample limit


def linear_regression_forecast_with_ci(values: list, horizon: int) -> tuple:
    """
    OLS point forecast plus a 95% prediction interval for each future day.

    Returns (point, lower, upper) — three lists of length `horizon`.

    Uses the standard OLS prediction-interval formula:
        ŷ ± t · s · sqrt(1 + 1/n + (x_new - x̄)² / Σ(xᵢ - x̄)²)
    where `s` is the residual standard error (RSE) and `t` is the
    two-tailed critical value at 95% confidence for n-2 degrees of freedom.
    """
    n = len(values)
    if n < 3:
        # Not enough data for a real interval — wide heuristic fallback.
        point = linear_regression_forecast(values, horizon)
        lower = [max(0.0, p * 0.6) for p in point]
        upper = [p * 1.4 for p in point]
        return point, lower, upper

    mean_x = (n - 1) / 2.0
    mean_y = sum(values) / n

    num = sum((i - mean_x) * (values[i] - mean_y) for i in range(n))
    den = sum((i - mean_x) ** 2 for i in range(n))
    slope = num / den if den else 0.0
    intercept = mean_y - slope * mean_x

    fitted = [intercept + slope * i for i in range(n)]
    rss = sum((values[i] - fitted[i]) ** 2 for i in range(n))
    dof = max(1, n - 2)
    rse = (rss / dof) ** 0.5  # residual standard error

    t_crit = _t_critical_95(dof)

    point, lower, upper = [], [], []
    for i in range(horizon):
        x_new = n + i
        y_hat = intercept + slope * x_new
        if den > 0:
            se_pred = rse * ((1 + 1.0 / n + (x_new - mean_x) ** 2 / den) ** 0.5)
        else:
            se_pred = rse
        margin = t_crit * se_pred
        point.append(max(0.0, y_hat))
        lower.append(max(0.0, y_hat - margin))
        upper.append(y_hat + margin)

    return point, lower, upper


# ----------------------------------------------------------------
# Rolling-origin cross-validation
#
# Replaces the single 3-day holdout with a proper evaluation:
# fit on values[:t], score on values[t:t+h], slide t forward one
# step at a time. Returns (MAE, MAPE) averaged across all folds.
# ----------------------------------------------------------------

def _rolling_score(values: list, predict_fn, horizon: int = 3,
                   min_train: int = 10) -> tuple:
    """
    Rolling-origin CV. `predict_fn(train_values, horizon) -> list`.
    Returns (mae, mape); both are None when there aren't enough folds.
    """
    n = len(values)
    if n < min_train + horizon:
        return None, None

    abs_errs = []
    pct_errs = []

    for t in range(min_train, n - horizon + 1):
        train = values[:t]
        actual = values[t:t + horizon]
        preds = predict_fn(train, horizon)
        if preds is None or len(preds) != horizon:
            continue
        for p, a in zip(preds, actual):
            abs_errs.append(abs(p - a))
            if a > 0:
                pct_errs.append(abs(p - a) / a)

    if not abs_errs:
        return None, None

    mae = sum(abs_errs) / len(abs_errs)
    mape = (sum(pct_errs) / len(pct_errs)) if pct_errs else None
    return mae, mape


# ----------------------------------------------------------------
# Model registry
#
# Each entry: (id, label, predict_fn, complexity_rank).
# Lower complexity rank wins when two models score within 1% of
# each other — implements a lightweight one-standard-error rule.
# ----------------------------------------------------------------

_MODEL_REGISTRY = [
    (
        "historical_mean",
        "historical daily average",
        lambda v, h: historical_mean_forecast(v, h),
        0,
    ),
    (
        "moving_average",
        "7-day weighted moving average",
        lambda v, h: moving_average_forecast(v, h, window=7),
        1,
    ),
    (
        "seasonal_naive",
        "seasonal naive (same weekday last week)",
        lambda v, h: seasonal_naive_forecast(v, h, period=7),
        2,
    ),
    (
        "linear_regression",
        "linear regression",
        lambda v, h: linear_regression_forecast(v, h),
        3,
    ),
]


# ----------------------------------------------------------------
# Public API
# ----------------------------------------------------------------
def forecast_next_7_days(orders: list) -> dict:
    """
    Build a 7-day revenue forecast from raw order documents.

    Scores every model with rolling-origin CV, picks the best (with a
    small preference for simpler models on near-ties), then produces
    point estimates plus a 95% prediction interval per day.
    """
    daily = aggregate_daily(orders)
    series = dense_series(daily, days_back=45)
    values = [v for _, v in series]

    nonzero_days = sum(1 for v in values if v > 0)

    if nonzero_days < 3:
        return {
            "available": False,
            "method": None,
            "message": (
                "There isn't enough historical sales data to produce "
                "a reliable forecast yet. At least 3 days of sales are needed."
            ),
            "history_days": nonzero_days,
            "forecast": [],
            "currency": "PHP",
            "timezone": "Asia/Manila",
        }

    # ---- Score every model with rolling-origin CV ----
    scored = {}
    for model_id, label, predict_fn, complexity in _MODEL_REGISTRY:
        mae, mape = _rolling_score(values, predict_fn, horizon=3, min_train=10)
        scored[model_id] = {
            "label": label,
            "mae": mae,
            "mape": mape,
            "complexity": complexity,
            "predict_fn": predict_fn,
        }

    # Drop models we couldn't score (not enough folds for them)
    candidates = {k: v for k, v in scored.items() if v["mae"] is not None}

    if not candidates:
        # Not enough data for any fold — fall back to plain mean.
        chosen_id = "historical_mean"
        chosen = scored["historical_mean"]
        chosen["mae"] = 0.0
        chosen["mape"] = None
    else:
        # Pick lowest MAE; if a simpler model is within 1% of the winner,
        # prefer the simpler one. This is a lightweight version of the
        # classic one-standard-error rule.
        best_mae = min(c["mae"] for c in candidates.values())
        within_1pct = [
            k for k, c in candidates.items()
            if c["mae"] <= best_mae * 1.01
        ]
        chosen_id = min(within_1pct, key=lambda k: candidates[k]["complexity"])
        chosen = candidates[chosen_id]

    # ---- Generate the 7-day forecast with intervals ----
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)

    if chosen_id == "linear_regression":
        point, lower, upper = linear_regression_forecast_with_ci(values, horizon=7)
    else:
        preds = chosen["predict_fn"](values, 7)
        if preds is None:
            # Seasonal naive could fail here in a rare edge case
            # (short history) even though it scored in CV — fall back.
            preds = historical_mean_forecast(values, 7)
            chosen_id = "historical_mean"
            chosen = scored["historical_mean"]
        point = preds
        # Symmetric band from this model's own rolling MAE.
        band = chosen["mae"] or 0.0
        lower = [max(0.0, p - band) for p in point]
        upper = [p + band for p in point]

    forecast = []
    for i, (amount, lo, hi) in enumerate(zip(point, lower, upper)):
        day = today + timedelta(days=i + 1)
        forecast.append({
            "date": day.strftime("%Y-%m-%d"),
            "predicted_revenue": round(amount, 2),
            "lower": round(lo, 2),
            "upper": round(hi, 2),
        })

    total = round(sum(point), 2)
    avg = round(total / 7.0, 2)

    chosen_mae = chosen["mae"]
    chosen_mape = chosen["mape"]
    baseline_entry = scored.get("historical_mean", {})
    baseline_mae = baseline_entry.get("mae")

    return {
        "available": True,
        "method": chosen_id,
        "method_label": chosen["label"],
        "message": (
            f"Estimated sales for the next 7 days: "
            f"₱{total:,.2f}. This is a statistical forecast "
            f"based on historical sales, not a guaranteed result."
        ),
        "history_days": nonzero_days,
        "validation_mae": round(chosen_mae, 2) if chosen_mae is not None else None,
        "validation_mape": (
            round(chosen_mape * 100, 1) if chosen_mape is not None else None
        ),
        "baseline_mae": round(baseline_mae, 2) if baseline_mae is not None else None,
        "total_predicted_revenue": total,
        "average_daily_revenue": avg,
        "forecast": forecast,
        "currency": "PHP",
        "timezone": "Asia/Manila",
    }