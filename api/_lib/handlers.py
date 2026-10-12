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


def _product_slices(product):
    """
    Return [(label, stock), ...] for every tracked stock slice.

    Unified shape:
      options: [ {name, values}, ... ]   (present, non-empty → per-variant stock)
      variants: { "v1::v2": {price, stock}, ... }

    Legacy shapes (sizeStocks / brandStocks / variants without options)
    are accepted for products not yet migrated.
    """
    options = product.get("options")
    if isinstance(options, list) and options:
        variants = product.get("variants") or {}
        out = []
        for key, val in variants.items():
            if not isinstance(val, dict):
                continue
            label = str(key).replace("::", " · ")
            out.append((label, float(val.get("stock") or 0)))
        return out or [("", float(product.get("quantity") or 0))]

    # Legacy shapes — tolerate until every doc is migrated.
    variants = product.get("variants")
    if isinstance(variants, dict) and variants:
        out = []
        for key, val in variants.items():
            if not isinstance(val, dict):
                continue
            label = str(key).replace("::", " · ")
            out.append((label, float(val.get("stock") or 0)))
        return out or [("", float(product.get("quantity") or 0))]

    size_stocks = product.get("sizeStocks")
    if isinstance(size_stocks, dict) and size_stocks:
        return [(str(s).strip(), float(v or 0)) for s, v in size_stocks.items()]

    brand_stocks = product.get("brandStocks")
    if isinstance(brand_stocks, dict) and brand_stocks:
        return [(str(b).strip(), float(v or 0)) for b, v in brand_stocks.items()]

    return [("", float(product.get("quantity") or 0))]


def _is_low_stock(product: dict) -> bool:
    """True when at least one tracked stock slice is 0 < qty <= min_stock."""
    slices = _product_slices(product)
    if not slices:
        return False
    min_qty = float(product.get("min_stock") or product.get("minStock") or 0)
    return any(0 < q <= min_qty for _, q in slices)


def _is_out_of_stock(product: dict) -> bool:
    """True when every tracked stock slice is zero."""
    slices = _product_slices(product)
    if not slices:
        return True
    return all(q <= 0 for _, q in slices)


def handle_restock_recommendation(ctx):
    products = get_all_inventory()
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=30)
    orders = get_orders_in_range(start, today + timedelta(days=1))
    orders = [o for o in orders if not _order_is_cancelled(o)]

    # Bucket sold quantities per (name, label) using the same label
    # format as _product_slices so the two sides line up.
    sold_slice = {}
    for o in orders:
        for item in (o.get("items") or []):
            name = str(item.get("name") or "").strip().lower()
            if not name:
                continue
            qty = float(item.get("quantity") or 0)
            if qty <= 0:
                continue
            size = str(item.get("size") or "").strip()
            brand = str(item.get("brand") or "").strip()
            parts = [p for p in (size, brand) if p]
            label = " · ".join(parts)
            key = (name, label)
            sold_slice[key] = sold_slice.get(key, 0.0) + qty

    candidates = []
    for p in products:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        name_lc = name.lower()
        min_stock = float(p.get("min_stock") or 0)

        for (label, stock) in _product_slices(p):
            sold = sold_slice.get((name_lc, label), 0.0)
            daily_rate = sold / 30.0
            days_left = (stock / daily_rate) if daily_rate > 0 else 999.0

            if stock <= 0:
                urgency = "critical"
            elif min_stock > 0 and stock <= min_stock:
                urgency = "critical"
            elif daily_rate > 0 and days_left <= 3:
                urgency = "critical"
            elif daily_rate > 0 and days_left <= 7:
                urgency = "high"
            elif daily_rate > 0 and days_left <= 14:
                urgency = "medium"
            else:
                urgency = "low"

            if sold <= 0 and stock > min_stock * 2:
                continue
            if urgency == "low" and sold <= 0:
                continue

            target_30d = daily_rate * 30.0
            needed_for_30d = max(0.0, target_30d - stock)
            top_up_to_min = max(0.0, min_stock - stock)
            recommended = int(round(max(needed_for_30d, top_up_to_min)))

            reason_bits = []
            if stock <= 0:
                reason_bits.append("stock out")
            else:
                reason_bits.append(f"{int(stock)} left")
            reason_bits.append(f"{daily_rate:.1f}/day" if daily_rate > 0 else "no recent sales")
            if min_stock > 0:
                reason_bits.append(f"min {int(min_stock)}")

            candidates.append({
                "name": name,
                "label": label,
                "urgency": urgency,
                "days_left": round(days_left, 1) if days_left < 999 else None,
                "sold_30d": int(sold),
                "stock": int(stock),
                "min_stock": int(min_stock),
                "recommended_order": recommended,
                "reason": " · ".join(reason_bits),
            })

    if not candidates:
        return {
            "response": "No restock recommendations right now — all tracked items look healthy.",
            "data": {"items": []},
            "source": "local",
        }

    urgency_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    candidates.sort(key=lambda c: (
        urgency_rank.get(c["urgency"], 4),
        -c["sold_30d"],
        c["days_left"] or 999,
    ))

    top = candidates[:8]
    crit_count = sum(1 for c in top if c["urgency"] == "critical")

    def _describe(c):
        head = f"{c['name']} ({c['label']})" if c["label"] else c["name"]
        return f"{head} → order {c['recommended_order']}"

    summary = ", ".join(_describe(c) for c in top[:3])

    return {
        "response": (
            f"{len(candidates)} item{'s' if len(candidates) != 1 else ''} may need restocking"
            + (f" ({crit_count} critical)" if crit_count else "")
            + f". Top priorities: {summary}. "
            + "Suggestions are read-only — stock is never modified automatically."
        ),
        "data": {
            "items": top,
            "total_candidates": len(candidates),
        },
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
    "You are Kirby's Hardware POS assistant — the owner's day-to-day "
    "analyst. You answer questions about this store's sales, inventory, "
    "orders, customers, and operations.\n"
    "\n"
    "You will be given a JSON block titled STORE_DATA containing real, "
    "current aggregates from the store's database. Use ONLY those numbers "
    "when answering. NEVER invent numbers, product names, or transactions "
    "that are not present in STORE_DATA.\n"
    "\n"
    "If STORE_DATA does not contain ANY of the numbers needed to answer, "
    "reply with exactly: \"I don't have enough data to answer that.\"\n"
    "\n"
    "If STORE_DATA contains PARTIAL information — e.g. the specific day "
    "asked about is missing but neighboring days are present, or the "
    "exact metric requested is absent but a closely related one exists — "
    "answer with what you CAN determine, and state clearly which part is "
    "uncertain. Prefer a partial answer over a refusal.\n"
    "\n"
    "For questions about a specific day of the week (e.g. \"last Tuesday\"), "
    "look up that weekday in daily_series_last_14. Compare it to the same "
    "weekday in the prior week if both are present.\n"
    "\n"
    "TONE\n"
    "- Direct and confident. Talk like a manager reviewing the numbers, "
    "not like a chatbot.\n"
    "- No filler openings (\"Based on the data...\", \"Great question!\", "
    "\"According to STORE_DATA...\"). Start straight with the answer.\n"
    "- No markdown. No bullet lists. No headings. Plain sentences only.\n"
    "- 2-4 short sentences. If the answer is one number, say one number.\n"
    "\n"
    "DATA RULES\n"
    "- Cite actual numbers from STORE_DATA (₱ amounts, unit counts).\n"
    "- When comparing, lead with the delta: e.g. \"Sales are up 12.4% "
    "vs the previous week.\"\n"
    "- When giving advice, tie it to the specific products or trend in "
    "STORE_DATA — never generic tips.\n"
    "- Do not repeat the question back to the user.\n"
    "\n"
    "EXAMPLES (do not copy verbatim — match the style)\n"
    "\n"
    "User: How are we doing this week?\n"
    "Assistant: Sales hit ₱48,210 this week, up 12.4% from last week. "
    "The top mover was 2kg bakal at 180 units. Hammer stock is trending "
    "low, so a restock before the weekend would help.\n"
    "\n"
    "User: What should I restock?\n"
    "Assistant: Three items are critical: 2kg bakal (12 left, selling "
    "6/day), plastic rope (0 left), and nails 1-inch (8 left, min 20). "
    "The bakal alone will run out in two days at the current pace.\n"
    "\n"
    "User: Who are my top customers?\n"
    "Assistant: Your top three buyers in the last 30 days are Juan "
    "Dela Cruz at ₱12,400 across 8 orders, Maria Santos at ₱8,150, and "
    "Pedro Reyes at ₱6,900. Together they are 41% of your 30-day revenue.\n"
    "\n"
    "User: Magkano benta ngayong araw?\n"
    "Assistant: ₱6,320 ang benta ngayon, mas mataas ng 8.2% kumpara "
    "kahapon. Ang pinakamalakas ay ang 3kg bakal na may 24 units.\n"
    "\n"
    "LANGUAGE\n"
    "Reply in the same language the user wrote in. Tagalog/Taglish in → "
    "Tagalog/Taglish out. English in → English out.\n"
    "\n"
    "CURRENCY\n"
    "All amounts are Philippine pesos. Write every value as ₱ followed "
    "immediately by the number — ₱1,234.56. Never write the word \"PHP\" "
    "or the letters \"PHP\" before an amount.\n"
    "\n"
    "The metric is gross revenue (orders.total summed)."
)
# ----------------------------------------------------------------
# AI CONTEXT — compact business snapshot for open-ended questions
# ----------------------------------------------------------------

def _classify_context_need(message: str) -> str:
    """
    Decide which slice of data the AI needs to answer this question.
    Returns one of: 'sales', 'inventory', 'customers', 'both', 'none'.
    """
    m = (message or "").lower()

    wants_sales = any(w in m for w in (
        "sales", "sale", "revenue", "earned", "earning", "profit",
        "income", "benta", "kita", "kumita", "tubo",
        "trend", "down", "up", "growth", "grow",
        "compare", "comparison", "performance", "analyze", "analysis",
        "today", "yesterday", "week", "month", "year", "daily", "weekly",
        "araw", "linggo", "buwan", "taon",
    ))
    wants_inventory = any(w in m for w in (
        "stock", "inventory", "product", "restock", "reorder",
        "supply", "item", "shelf", "shop",
        "imbak", "paninda", "kulang", "ubos", "paubos",
    ))
    wants_customers = any(w in m for w in (
        "customer", "buyer", "client", "loyal", "repeat",
        "suki", "mamimili",
    ))

    hits = sum([wants_sales, wants_inventory, wants_customers])
    if hits == 0:
        return "both"       # default: give sales + inventory summary
    if hits >= 2:
        return "both"
    if wants_sales:
        return "sales"
    if wants_inventory:
        return "inventory"
    return "customers"


def _build_sales_summary() -> dict:
    """Aggregated sales: today, last 7, last 30, top products."""
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)

    last_7_start = today - timedelta(days=6)
    last_30_start = today - timedelta(days=29)

    orders_30d = get_orders_in_range(last_30_start, today + timedelta(days=1))
    orders_30d = [o for o in orders_30d if not _order_is_cancelled(o)]

    # Bucket by day
    daily = {}
    for o in orders_30d:
        dt = parse_iso(o.get("createdAt") or "")
        if dt is None:
            continue
        key = dt.astimezone(STORE_TZ).strftime("%Y-%m-%d")
        daily[key] = daily.get(key, 0.0) + _order_total(o)

    today_key = today.strftime("%Y-%m-%d")
    today_rev = round(daily.get(today_key, 0.0), 2)

    # Last 7 and last 30 revenue
    rev_7 = round(sum(
        daily.get((today - timedelta(days=i)).strftime("%Y-%m-%d"), 0.0)
        for i in range(7)
    ), 2)
    rev_30 = round(sum(daily.values()), 2)

    # Prior 7 days for a delta
    rev_prev_7 = round(sum(
        daily.get((today - timedelta(days=i)).strftime("%Y-%m-%d"), 0.0)
        for i in range(7, 14)
    ), 2)

    # Top 8 products by units in last 30 days
    counts = {}
    for o in orders_30d:
        for item in (o.get("items") or []):
            name = str(item.get("name") or "").strip()
            qty = float(item.get("quantity") or 0)
            if name and qty > 0:
                counts[name] = counts.get(name, 0.0) + qty
    top_products = [
        {"name": n, "units_sold_30d": int(v)}
        for n, v in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:8]
    ]

    # Daily series (last 7)
    # 14 days so the AI can compare "last Tuesday" to "the Tuesday before".
    daily_series = [
        {
            "date": (today - timedelta(days=i)).strftime("%Y-%m-%d"),
            "weekday": (today - timedelta(days=i)).strftime("%A"),
            "revenue": round(daily.get((today - timedelta(days=i)).strftime("%Y-%m-%d"), 0.0), 2),
        }
        for i in range(13, -1, -1)
    ]

    # ---- Pre-compute notable days (>= 25% away from the 14-day average) ----
    # Small models often skip the "scan for outliers" step when given raw
    # numbers. Handing them a sorted list of what stands out makes the
    # question "why did Tuesday drop?" answerable from context alone.
    notable_days = []
    nonzero_revs = [d["revenue"] for d in daily_series if d["revenue"] > 0]
    if nonzero_revs:
        avg_14 = sum(nonzero_revs) / len(nonzero_revs)
        if avg_14 > 0:
            for d in daily_series:
                if d["revenue"] == 0:
                    continue
                delta = (d["revenue"] - avg_14) / avg_14
                if abs(delta) >= 0.25:
                    notable_days.append({
                        "date": d["date"],
                        "weekday": d["weekday"],
                        "revenue": d["revenue"],
                        "vs_avg_14d_pct": round(delta * 100, 1),
                    })

    delta_pct = None
    if rev_prev_7 > 0:
        delta_pct = round(((rev_7 - rev_prev_7) / rev_prev_7) * 100, 1)

    return {
        "today_revenue_php": today_rev,
        "last_7_days_revenue_php": rev_7,
        "previous_7_days_revenue_php": rev_prev_7,
        "week_over_week_change_pct": delta_pct,
        "last_30_days_revenue_php": rev_30,
        "order_count_30d": len(orders_30d),
        "daily_series_last_14": daily_series,
        "notable_days_last_14": notable_days,
        "top_products_last_30d": top_products,
        "metric": "gross_revenue_php",
        "timezone": "Asia/Manila",
    }


def _build_inventory_summary() -> dict:
    """Aggregated inventory: counts, low stock, out of stock."""
    products = get_all_inventory()
    low = [p for p in products if _is_low_stock(p)]
    out = [p for p in products if _is_out_of_stock(p)]

    return {
        "total_products": len(products),
        "low_stock_count": len(low),
        "out_of_stock_count": len(out),
        "low_stock_items": [
            {
                "name": p.get("name"),
                "quantity": int(float(p.get("quantity") or 0)),
                "min_stock": int(float(p.get("min_stock") or 0)),
            }
            for p in low[:8]
        ],
        "out_of_stock_items": [
            {"name": p.get("name")} for p in out[:8]
        ],
    }


def _build_customer_summary() -> dict:
    """Aggregated customer stats."""
    # We don't have a get_all_customers in firebase_client — pull orders
    # instead and derive unique customer names from the last 30 days.
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=29)
    orders = get_orders_in_range(start, today + timedelta(days=1))
    orders = [o for o in orders if not _order_is_cancelled(o)]

    spend = {}
    order_counts = {}
    for o in orders:
        name = str(o.get("customerName") or "").strip() or "Walk-in"
        spend[name] = spend.get(name, 0.0) + _order_total(o)
        order_counts[name] = order_counts.get(name, 0) + 1

    top = [
        {"name": n, "total_spent_php": round(spend[n], 2), "orders": order_counts[n]}
        for n in sorted(spend, key=lambda k: spend[k], reverse=True)[:5]
        if n != "Walk-in"
    ]

    return {
        "unique_customers_30d": len(spend),
        "top_customers_last_30d": top,
    }


def build_ai_context(message: str) -> dict:
    """
    Return a compact business snapshot tailored to the question.
    Never includes raw transaction rows — only aggregates.
    """
    need = _classify_context_need(message)
    ctx = {"as_of": now_manila().isoformat(), "store_timezone": "Asia/Manila"}

    try:
        if need in ("sales", "both"):
            ctx["sales"] = _build_sales_summary()
        if need in ("inventory", "both"):
            ctx["inventory"] = _build_inventory_summary()
        if need in ("customers", "both"):
            ctx["customers"] = _build_customer_summary()
    except Exception as exc:
        # Never let context-build crash the chat — just log and continue.
        import sys
        print(f"[ai-context] failed: {exc}", file=sys.stderr)

    return ctx