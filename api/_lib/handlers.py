"""
Intent handlers. Each handler:
 - receives {nlp, firebase data, user, intent, period, product, text}
 - returns {response: str, data: dict, source: str}

Handlers NEVER invent data. If a query cannot be answered from the
actual Firestore contents, they return an honest error message.
"""

from datetime import datetime, timedelta, timezone

from .firebase_client import (
    STORE_TZ, get_all_inventory, get_orders_in_range, get_orders_today,
    get_recent_orders, now_manila, parse_iso,
)
from .forecasting import forecast_next_7_days


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def _php(amount: float) -> str:
    try:
        return f"PHP {float(amount):,.2f}"
    except (TypeError, ValueError):
        return "PHP 0.00"


def _is_low_stock(product: dict) -> bool:
    qty = float(product.get("quantity") or 0)
    min_qty = float(product.get("min_stock") or product.get("minStock") or 0)
    return 0 < qty <= min_qty


def _is_out_of_stock(product: dict) -> bool:
    return float(product.get("quantity") or 0) <= 0


def _order_total(order: dict) -> float:
    try:
        return float(order.get("total") or 0)
    except (TypeError, ValueError):
        return 0.0


def _order_is_cancelled(order: dict) -> bool:
    return str(order.get("status") or "").lower() in (
        "cancelled", "canceled", "void", "voided",
    )


def _period_range(period: str):
    """
    Return (start_aware, end_aware, label) for a period key.
    End is exclusive (start of the next period).
    """
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow = today + timedelta(days=1)

    if period in (None, "today"):
        return today, tomorrow, "today"

    if period == "yesterday":
        return today - timedelta(days=1), today, "yesterday"

    if period == "this_week":
        # Monday-start week (common in PH retail reporting).
        monday = today - timedelta(days=today.weekday())
        return monday, tomorrow, "this week"

    if period == "last_week":
        monday = today - timedelta(days=today.weekday())
        return monday - timedelta(days=7), monday, "last week"

    if period == "this_month":
        start = today.replace(day=1)
        return start, tomorrow, "this month"

    if period == "last_month":
        first_this = today.replace(day=1)
        last_month_end = first_this
        last_month_start = (first_this - timedelta(days=1)).replace(day=1)
        return last_month_start, last_month_end, "last month"

    if period == "this_year":
        return today.replace(month=1, day=1), tomorrow, "this year"

    if period == "last_year":
        y = today.year - 1
        return today.replace(year=y, month=1, day=1), today.replace(year=y + 1, month=1, day=1), "last year"

    if period == "last_7_days":
        return today - timedelta(days=6), tomorrow, "the last 7 days"

    if period == "last_30_days":
        return today - timedelta(days=29), tomorrow, "the last 30 days"

    return today, tomorrow, "today"


def _orders_for_period(period: str) -> list:
    start, end, _ = _period_range(period)
    orders = get_orders_in_range(start, end)
    return [o for o in orders if not _order_is_cancelled(o)]


def _filter_by_period(orders: list, period: str) -> list:
    """Filter an already-fetched list of orders by period client-side."""
    start, end, _ = _period_range(period)
    s, e = start, end
    out = []
    for o in orders:
        if _order_is_cancelled(o):
            continue
        dt = parse_iso(o.get("createdAt") or "")
        if dt is None:
            continue
        local = dt.astimezone(STORE_TZ)
        if s <= local < e:
            out.append(o)
    return out


# ----------------------------------------------------------------
# Individual handlers
# ----------------------------------------------------------------

def handle_greeting(ctx):
    return {
        "response": (
            "Hello! I can help you with inventory, sales, transactions, "
            "and forecasts. Try asking: \"Show low stock\", \"What are today's sales?\", "
            "or \"Predict next week's sales.\""
        ),
        "data": {},
        "source": "local",
    }


def handle_help(ctx):
    return {
        "response": (
            "I understand these kinds of questions: "
            "inventory checks (\"How many hammers are left?\"), "
            "low stock (\"What should I restock?\"), "
            "sales (\"How much did we earn this week?\"), "
            "best sellers (\"Which products sell the most?\"), "
            "recent transactions (\"Show recent orders\"), "
            "and forecasts (\"Predict sales for next week\")."
        ),
        "data": {},
        "source": "local",
    }


def handle_inventory_check(ctx):
    product = ctx.get("product")
    if not product:
        return {
            "response": (
                "I couldn't find a matching product. "
                "Please check the product name and try again."
            ),
            "data": {"matched": False},
            "source": "local",
        }

    qty = int(float(product.get("quantity") or 0))
    name = product.get("name") or "that product"
    unit = "unit" if qty == 1 else "units"
    return {
        "response": f"{name}: {qty} {unit} in stock.",
        "data": {
            "matched": True,
            "product": {
                "name": name,
                "sku": product.get("sku", ""),
                "quantity": qty,
                "category": product.get("category", ""),
                "price": product.get("price"),
            },
        },
        "source": "local",
    }


def handle_product_search(ctx):
    return handle_inventory_check(ctx)


def handle_low_stock(ctx):
    products = get_all_inventory()
    low = [p for p in products if _is_low_stock(p)]
    low.sort(key=lambda p: (float(p.get("quantity") or 0)
                            - float(p.get("min_stock") or 0)))

    if not low:
        return {
            "response": "All stock levels look healthy right now.",
            "data": {"items": []},
            "source": "local",
        }

    items = [{
        "name": p.get("name"),
        "sku": p.get("sku", ""),
        "quantity": int(float(p.get("quantity") or 0)),
        "min_stock": int(float(p.get("min_stock") or 0)),
    } for p in low[:10]]

    top = ", ".join(f"{i['name']} ({i['quantity']} left)" for i in items[:5])
    more = "" if len(low) <= 5 else f" and {len(low) - 5} more"
    return {
        "response": f"{len(low)} product{'s' if len(low) != 1 else ''} are low on stock. Top: {top}{more}.",
        "data": {"items": items, "count": len(low)},
        "source": "local",
    }


def handle_out_of_stock(ctx):
    products = get_all_inventory()
    out = [p for p in products if _is_out_of_stock(p)]

    if not out:
        return {
            "response": "No products are currently out of stock.",
            "data": {"items": []},
            "source": "local",
        }

    items = [{
        "name": p.get("name"),
        "sku": p.get("sku", ""),
    } for p in out[:15]]

    names = ", ".join(i["name"] for i in items[:5])
    more = "" if len(out) <= 5 else f" and {len(out) - 5} more"
    return {
        "response": f"{len(out)} product{'s' if len(out) != 1 else ''} are out of stock: {names}{more}.",
        "data": {"items": items, "count": len(out)},
        "source": "local",
    }


def handle_daily_sales(ctx):
    orders = get_orders_today()
    total = sum(_order_total(o) for o in orders)
    return {
        "response": (
            f"Today's total sales: {_php(total)} across "
            f"{len(orders)} order{'s' if len(orders) != 1 else ''}. "
            f"(Gross revenue, Philippines time zone, Asia/Manila.)"
        ),
        "data": {
            "period": "today",
            "revenue": round(total, 2),
            "order_count": len(orders),
            "currency": "PHP",
            "metric": "gross_revenue",
        },
        "source": "local",
    }


def handle_sales_summary(ctx):
    period = ctx.get("period") or "this_week"
    orders = _orders_for_period(period)
    total = sum(_order_total(o) for o in orders)
    _, _, label = _period_range(period)
    return {
        "response": (
            f"Total sales for {label}: {_php(total)} across "
            f"{len(orders)} order{'s' if len(orders) != 1 else ''}. "
            f"(Gross revenue, Asia/Manila.)"
        ),
        "data": {
            "period": period,
            "label": label,
            "revenue": round(total, 2),
            "order_count": len(orders),
            "currency": "PHP",
            "metric": "gross_revenue",
        },
        "source": "local",
    }


def handle_sales_history(ctx):
    """Return daily totals for the last 7 days."""
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=6)
    orders = get_orders_in_range(start, today + timedelta(days=1))
    orders = [o for o in orders if not _order_is_cancelled(o)]

    buckets = {}
    for o in orders:
        dt = parse_iso(o.get("createdAt") or "")
        if dt is None:
            continue
        key = dt.astimezone(STORE_TZ).strftime("%Y-%m-%d")
        buckets[key] = buckets.get(key, 0.0) + _order_total(o)

    days = []
    for offset in range(6, -1, -1):
        d = today - timedelta(days=offset)
        key = d.strftime("%Y-%m-%d")
        days.append({"date": key, "revenue": round(buckets.get(key, 0.0), 2)})

    total = round(sum(d["revenue"] for d in days), 2)
    return {
        "response": f"Last 7 days: {_php(total)} total. Per-day breakdown returned in `data.days`.",
        "data": {"days": days, "total": total, "currency": "PHP"},
        "source": "local",
    }


def handle_best_seller(ctx):
    period = ctx.get("period") or "last_30_days"
    orders = _orders_for_period(period)
    counts = {}
    for o in orders:
        for item in (o.get("items") or []):
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            qty = float(item.get("quantity") or 0)
            if qty <= 0:
                continue
            counts[name] = counts.get(name, 0.0) + qty

    if not counts:
        return {
            "response": "I don't have any sales data for that period yet.",
            "data": {"items": []},
            "source": "local",
        }

    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    items = [{"name": n, "units_sold": int(v)} for n, v in ranked]
    top_line = ", ".join(f"{i['name']} ({i['units_sold']} units)" for i in items)
    _, _, label = _period_range(period)
    return {
        "response": f"Top sellers for {label}: {top_line}.",
        "data": {"items": items, "period": period},
        "source": "local",
    }


def handle_transaction_history(ctx):
    orders = get_recent_orders(limit=10)
    orders = [o for o in orders if not _order_is_cancelled(o)]

    if not orders:
        return {
            "response": "There are no recent transactions on record yet.",
            "data": {"items": []},
            "source": "local",
        }

    items = [{
        "id": o.get("id"),
        "date": o.get("createdAt"),
        "customer": o.get("customerName") or "Walk-in",
        "total": round(_order_total(o), 2),
        "payment": (o.get("paymentMethod") or "cash").lower(),
    } for o in orders]

    latest = items[0]
    return {
        "response": (
            f"Latest transaction: {latest['id']} on {latest['date']} "
            f"for {_php(latest['total'])} ({latest['payment']}). "
            f"Returned {len(items)} recent transactions in `data.items`."
        ),
        "data": {"items": items},
        "source": "local",
    }


def handle_sales_forecast(ctx):
    # Pull up to 60 days of orders once; the forecast module aggregates.
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=60)
    orders = get_orders_in_range(start, today + timedelta(days=1))
    result = forecast_next_7_days(orders)

    if not result.get("available"):
        return {
            "response": result.get("message", "Not enough data to forecast yet."),
            "data": result,
            "source": "python_forecast",
        }
    return {
        "response": result["message"],
        "data": result,
        "source": "python_forecast",
    }


def handle_restock_recommendation(ctx):
    products = get_all_inventory()
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=30)
    orders = get_orders_in_range(start, today + timedelta(days=1))
    orders = [o for o in orders if not _order_is_cancelled(o)]

    sold_30d = {}
    for o in orders:
        for item in (o.get("items") or []):
            name = str(item.get("name") or "").strip().lower()
            if not name:
                continue
            qty = float(item.get("quantity") or 0)
            sold_30d[name] = sold_30d.get(name, 0.0) + qty

    candidates = []
    for p in products:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        stock = float(p.get("quantity") or 0)
        min_stock = float(p.get("min_stock") or 0)
        sold = sold_30d.get(name.lower(), 0.0)
        if sold <= 0 and stock > min_stock * 2:
            continue

        daily_rate = sold / 30.0
        days_left = (stock / daily_rate) if daily_rate > 0 else 999.0

        if stock <= 0:
            urgency = "critical"
        elif days_left <= 3:
            urgency = "critical"
        elif days_left <= 7:
            urgency = "high"
        elif days_left <= 14:
            urgency = "medium"
        else:
            urgency = "low"

        target_30d = daily_rate * 30.0
        recommended = max(0, int(round(target_30d - stock)))

        candidates.append({
            "name": name,
            "urgency": urgency,
            "days_left": round(days_left, 1) if days_left < 999 else None,
            "sold_30d": int(sold),
            "stock": int(stock),
            "recommended_order": recommended,
            "reason": (
                f"Sells about {daily_rate:.1f}/day, "
                f"{('stock out' if stock <= 0 else f'{days_left:.1f} days left')}"
            ),
        })

    if not candidates:
        return {
            "response": "No restock recommendations right now — all tracked items look healthy.",
            "data": {"items": []},
            "source": "local",
        }

    urgency_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    candidates.sort(key=lambda c: (urgency_rank.get(c["urgency"], 4),
                                   c["days_left"] or 999))

    top = candidates[:6]
    summary = ", ".join(f"{c['name']} (order {c['recommended_order']})" for c in top[:3])
    return {
        "response": (
            f"{len(candidates)} item{'s' if len(candidates) != 1 else ''} may need restocking. "
            f"Top priorities: {summary}. "
            f"Suggestions are read-only — stock is never modified automatically."
        ),
        "data": {"items": top, "total_candidates": len(candidates)},
        "source": "local",
    }


# ----------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------
DISPATCH = {
    "greeting": handle_greeting,
    "help": handle_help,
    "inventory_check": handle_inventory_check,
    "product_search": handle_product_search,
    "low_stock": handle_low_stock,
    "out_of_stock": handle_out_of_stock,
    "daily_sales": handle_daily_sales,
    "sales_summary": handle_sales_summary,
    "sales_history": handle_sales_history,
    "best_seller": handle_best_seller,
    "transaction_history": handle_transaction_history,
    "sales_forecast": handle_sales_forecast,
    "restock_recommendation": handle_restock_recommendation,
}


def dispatch_intent(intent: str, ctx: dict):
    handler = DISPATCH.get(intent)
    if handler is None:
        return None
    return handler(ctx)


# ----------------------------------------------------------------
# AI system prompt (only for open-ended follow-ups)
# ----------------------------------------------------------------
AI_SYSTEM_PROMPT = (
    "You are Kirby's Hardware POS assistant. You answer only questions "
    "about this store's sales, inventory, orders, customers, and operations. "
    "You never invent numbers, product names, or transactions. "
    "If you are not given data that answers the question, reply: "
    "\"I don't have enough data to answer that.\" "
    "Reply in 1-2 short sentences of plain English. No markdown. "
    "The store is in Bulacan, Philippines. All amounts are in PHP."
)