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


def linear_regression_score(values: list, holdout: int = 3) -> Optional[float]:
    """
    Chronological holdout: fit on values[:-holdout], score on the tail.
    Returns MAE or None if not enough data.
    """
    if len(values) < holdout + 5:
        return None
    train = values[:-holdout]
    test = values[-holdout:]
    preds = linear_regression_forecast(train, holdout)
    return sum(abs(p - t) for p, t in zip(preds, test)) / holdout


def naive_baseline_score(values: list, holdout: int = 3) -> Optional[float]:
    """Baseline MAE using the mean of the training slice."""
    if len(values) < holdout + 5:
        return None
    train = values[:-holdout]
    test = values[-holdout:]
    mean = sum(train) / len(train)
    return sum(abs(mean - t) for t in test) / holdout


# ----------------------------------------------------------------
# Public API
# ----------------------------------------------------------------
def forecast_next_7_days(orders: list) -> dict:
    """
    Build a 7-day revenue forecast from raw order documents.

    Returns a structured payload the frontend can render directly.
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

    # Method selection with validation on the last 3 days.
    chosen = "historical_mean"
    chosen_score = None
    baseline_score = naive_baseline_score(values, holdout=3)

    if nonzero_days >= 14:
        lr_score = linear_regression_score(values, holdout=3)
        if lr_score is not None and (
            baseline_score is None or lr_score <= baseline_score * 1.15
        ):
            chosen = "linear_regression"
            chosen_score = lr_score
        elif baseline_score is not None:
            chosen = "moving_average"
            chosen_score = baseline_score
        else:
            chosen = "linear_regression"
            chosen_score = lr_score
    elif nonzero_days >= 7:
        chosen = "moving_average"
        chosen_score = baseline_score
    else:
        chosen = "historical_mean"

    # Produce 7 daily predictions.
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    if chosen == "linear_regression":
        preds = linear_regression_forecast(values, horizon=7)
    elif chosen == "moving_average":
        avg = weighted_moving_average(values, window=7)
        preds = [avg] * 7
    else:
        avg = sum(v for v in values if v > 0) / nonzero_days if nonzero_days else 0.0
        preds = [avg] * 7

    forecast = []
    for i, amount in enumerate(preds):
        day = today + timedelta(days=i + 1)
        forecast.append({
            "date": day.strftime("%Y-%m-%d"),
            "predicted_revenue": round(amount, 2),
        })

    total = round(sum(preds), 2)
    avg = round(total / 7.0, 2)

    method_label = {
        "linear_regression": "linear regression",
        "moving_average": "7-day weighted moving average",
        "historical_mean": "historical daily average",
    }[chosen]

    return {
        "available": True,
        "method": chosen,
        "method_label": method_label,
        "message": (
            f"Estimated sales for the next 7 days: "
            f"PHP {total:,.2f}. This is a statistical forecast "
            f"based on historical sales, not a guaranteed result."
        ),
        "history_days": nonzero_days,
        "validation_mae": round(chosen_score, 2) if chosen_score is not None else None,
        "baseline_mae": round(baseline_score, 2) if baseline_score is not None else None,
        "total_predicted_revenue": total,
        "average_daily_revenue": avg,
        "forecast": forecast,
        "currency": "PHP",
        "timezone": "Asia/Manila",
    }