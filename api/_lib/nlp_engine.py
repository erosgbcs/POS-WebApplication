"""
Custom NLP engine for POS intent detection.

No external AI is required for intent classification, entity extraction,
or product-name fuzzy matching. Gemini/Groq are only consulted for
genuine open-ended conversational requests that the local engine
cannot classify.

Design goals:
 - deterministic for known POS commands
 - extensible via the INTENTS dictionary
 - never silently hallucinate: ambiguous / unknown -> `unknown`
"""

import re
from difflib import SequenceMatcher
from typing import Optional

MAX_INPUT_CHARS = 500


class NLPEngine:
    # ----------------------------------------------------------------
    # Intent catalogue. Weighted keywords + phrase bonuses.
    # `min_score` is the threshold to accept the intent.
    # ----------------------------------------------------------------
    INTENTS = {
        "greeting": {
            "keywords": {
                "hello": 3, "hi": 3, "hey": 3, "greetings": 2, "yo": 1,
                "kumusta": 3, "kamusta": 3, "musta": 2,
            },
            "phrases": [
                "good morning", "good afternoon", "good evening", "good day",
                "magandang umaga", "magandang hapon", "magandang gabi",
            ],
            "min_score": 3,
        },
        "help": {
            "keywords": {
                "help": 3, "ask": 1, "capable": 2, "support": 2,
                "tulong": 3, "tulungan": 3,
            },
            "phrases": [
                "what can you do", "help me", "what can i ask",
                "how do you work", "what are your features",
                "ano ang kaya mo", "paano ka gumagana",
            ],
            "min_score": 4,
        },
        "low_stock": {
            "keywords": {
                "low": 3, "restock": 3, "reorder": 3, "running": 2,
                "stock": 2, "replenish": 3, "almost": 2,
                "kulang": 3, "kaunti": 2, "paubos": 3, "ubos": 2,
                "restockin": 3, "dagdagan": 3, "punuin": 2,
            },
            "phrases": [
                "low stock", "running low", "need restock", "need reorder",
                "running out", "low on stock", "which items need restocking",
                "what should i restock",
                "paubos na", "kulang na", "kaunti na lang",
                "kailangan i-restock", "ano ang kailangan i-restock",
                "anong paubos na",
            ],
            "min_score": 5,
        },
        "out_of_stock": {
            "keywords": {
                "out": 3, "zero": 2, "none": 2, "empty": 2, "unavailable": 2,
                "ubos": 3, "wala": 2,
            },
            "phrases": [
                "out of stock", "no stock", "zero stock", "sold out",
                "what products are out of stock", "which products are out of stock",
                "wala nang stock", "ubos na ang stock", "ubos na lahat",
            ],
            "min_score": 5,
        },
        "inventory_check": {
            "keywords": {
                "have": 3, "left": 3, "stock": 2, "quantity": 2, "available": 2,
                "much": 1, "many": 1,
                "magkano": 3, "ilan": 3, "may": 2, "meron": 2,
                "natitira": 3, "presyo": 3, "halaga": 2,
            },
            "phrases": [
                "how many", "how much", "do we have", "is there", "in stock",
                "how many hammers are left",
                "ilan pa", "meron pa ba", "may stock ba",
                "magkano ang", "ilan ang", "ilan na lang",
            ],
            "min_score": 4,
        },
        "product_search": {
            "keywords": {
                "find": 3, "search": 3, "product": 2, "item": 2, "price": 2,
                "hanapin": 3, "hanap": 3, "tingnan": 2,
                "magkano": 2, "presyo": 3,
            },
            "phrases": [
                "find product", "search product", "look for",
                "price of", "how much is", "how much does",
                "hanapin ang", "hanapin ang presyo",
                "magkano ang presyo",
            ],
            "min_score": 4,
        },
        "daily_sales": {
            "keywords": {
                "today": 3, "sales": 3, "revenue": 2, "earned": 2, "sold": 2,
                "ngayon": 3, "benta": 3, "kita": 3, "kumita": 2,
            },
            "phrases": [
                "today's sales", "sales today", "earned today",
                "sold today", "revenue today", "how much did we sell today",
                "benta ngayon", "kita ngayon", "magkano ang benta ngayon",
                "kumita tayo ngayon",
            ],
            "min_score": 5,
        },
        "sales_summary": {
            "keywords": {
                "week": 2, "month": 2, "year": 2, "summary": 2,
                "total": 2, "sales": 2, "revenue": 2,
                "linggo": 2, "buwan": 2, "taon": 2,
                "benta": 2, "kita": 2, "kabuuang": 3,
            },
            "phrases": [
                "this week", "this month", "this year",
                "last week", "last month", "last year",
                "sales summary", "total sales",
                "how much did we earn this week",
                "ngayong linggo", "ngayong buwan", "ngayong taon",
                "nakaraang linggo", "nakaraang buwan",
                "kabuuang benta", "kabuuang kita",
            ],
            "min_score": 5,
        },
        "sales_history": {
            "keywords": {
                "history": 3, "past": 2, "previous": 2, "daily": 2,
                "weekly": 2, "sales": 2,
                "nakaraan": 2, "nakalipas": 2,
            },
            "phrases": [
                "sales history", "past sales", "previous sales",
                "daily sales", "weekly sales",
                "kasaysayan ng benta", "nakaraang benta",
            ],
            "min_score": 4,
        },
        "best_seller": {
            "keywords": {
                "best": 3, "top": 3, "seller": 2, "sellers": 2,
                "selling": 2, "popular": 2, "most": 2,
                "sold": 2, "sell": 2, "sells": 2,
                "mabenta": 3, "pinaka": 2, "sikat": 2,
            },
            "phrases": [
                "best seller", "best sellers", "best selling",
                "best-selling", "top product", "top products",
                "top seller", "top sellers",
                "most popular", "most sold", "most selling",
                "most ordered", "most purchased",
                "sells the most", "sold the most",
                "which products sell the most",
                "what is the most sold",
                "what are the most sold",
                "best seller today",
                "best seller this week",
                "best seller this month",
                "pinaka-mabenta", "pinakamabenta",
                "anong mabenta", "ano ang mabenta",
            ],
            "min_score": 5,
        },
        "transaction_history": {
            "keywords": {
                "transaction": 3, "receipt": 3, "order": 2,
                "history": 2, "recent": 2, "latest": 2,
                "last": 2, "show": 1,
                "resibo": 3, "huling": 2, "nakaraan": 2,
            },
            "phrases": [
                "transaction history", "recent transactions",
                "recent orders", "last order", "last orders",
                "latest orders", "latest transactions",
                "show orders", "show my orders",
                "show recent orders", "show transactions",
                "list orders", "list transactions",
                "huling order", "huling transaksyon",
                "ipakita ang mga order",
            ],
            "min_score": 4,
        },
        "sales_forecast": {
            "keywords": {
                "forecast": 3, "predict": 3, "projection": 3,
                "future": 2, "next": 1,
                "hulaan": 3, "hula": 3, "susunod": 2,
            },
            "phrases": [
                "predict sales", "sales forecast", "next week",
                "next month", "future sales", "project sales",
                "predict sales for next week",
                "hulaan ang benta", "susunod na linggo",
                "susunod na buwan", "hinaharap na benta",
            ],
            "min_score": 5,
        },
        "restock_recommendation": {
            "keywords": {
                "recommend": 3, "restock": 3, "reorder": 3,
                "suggest": 2, "should": 2, "order": 2, "buy": 2,
                "irekomenda": 3, "bilhin": 2, "dagdagan": 3,
            },
            "phrases": [
                "what should i restock", "recommend restock",
                "what to order", "restock recommendation",
                "should i buy", "recommend products to restock",
                "ano ang dapat i-restock",
                "anong dapat bilhin", "ano ang kailangan bilhin",
            ],
            "min_score": 5,
        },
    }
    def __init__(self, product_names: Optional[list] = None):
        self.update_products(product_names or [])

    # ------------------------------------------------------------
    # Product catalogue
    # ------------------------------------------------------------
    def update_products(self, product_names: list) -> None:
        self.product_names = [str(n).lower().strip() for n in product_names if n]

    # ------------------------------------------------------------
    # Normalisation
    # ------------------------------------------------------------
    @staticmethod
    def normalize(text: str) -> str:
        if not text:
            return ""
        text = text.strip()
        if len(text) > MAX_INPUT_CHARS:
            text = text[:MAX_INPUT_CHARS]
        text = text.lower()

        # Strip punctuation (keep apostrophes inside words).
        text = re.sub(r"[^\w\s']", " ", text)

        # Split compound words users frequently mash together so phrase
        # matching can see "next week" instead of "nextweek".
        for token in ("week", "month", "year", "day"):
            text = re.sub(rf"\bnext\s*{token}\b", f"next {token}", text)
            text = re.sub(rf"\blast\s*{token}\b", f"last {token}", text)
            text = re.sub(rf"\bthis\s*{token}\b", f"this {token}", text)
        for a, b in (
            ("ngayong", "linggo"), ("ngayong", "buwan"), ("ngayong", "taon"),
            ("nakaraang", "linggo"), ("nakaraang", "buwan"), ("nakaraang", "taon"),
        ):
            text = re.sub(rf"\b{a}\s*{b}\b", f"{a} {b}", text)

        text = re.sub(r"\s+", " ", text)
        return text.strip()

    # ------------------------------------------------------------
    # Intent classification
    # ------------------------------------------------------------
    def classify(self, text: str) -> dict:
        """
        Returns:
          {"intent": str, "confidence": float, "scores": dict}
        """
        normalized = self.normalize(text)
        if not normalized:
            return {"intent": "unknown", "confidence": 0.0, "scores": {}}

        tokens = set(normalized.split())
        scores = {}

        for intent, cfg in self.INTENTS.items():
            score = 0
            for kw, weight in cfg.get("keywords", {}).items():
                # Word-boundary match — "hi" must not match "this",
                # "out" must not match "about". Safe here because
                # normalize() strips punctuation, leaving only word
                # characters and apostrophes.
                if re.search(rf"\b{re.escape(kw)}\b", normalized):
                    score += weight
            for phrase in cfg.get("phrases", []):
                if phrase in normalized:
                    score += 5
            scores[intent] = score

        best_intent = max(scores, key=scores.get)
        best_score = scores[best_intent]
        min_score = self.INTENTS[best_intent].get("min_score", 3)

        if best_score < min_score:
            return {"intent": "unknown", "confidence": 0.0, "scores": scores}

        confidence = min(1.0, best_score / (min_score * 2.0))
        return {"intent": best_intent, "confidence": confidence, "scores": scores}

    # ------------------------------------------------------------
    # Product name extraction (fuzzy)
    # ------------------------------------------------------------
    def extract_product(self, text: str) -> Optional[str]:
        if not self.product_names:
            return None

        normalized = self.normalize(text)
        tokens = normalized.split()
        if not tokens:
            return None

        # Try longest n-grams first so multi-word product names win.
        for n in range(min(5, len(tokens)), 0, -1):
            for i in range(len(tokens) - n + 1):
                gram = " ".join(tokens[i:i + n])
                match = self._fuzzy_match(gram)
                if match:
                    return match
        return None

    def _fuzzy_match(self, candidate: str, threshold: float = 0.82):
        candidate = candidate.lower().strip()
        if len(candidate) < 3:
            return None

        best_name = None
        best_ratio = 0.0
        for name in self.product_names:
            if candidate == name or candidate in name or name in candidate:
                ratio = 1.0
            else:
                ratio = SequenceMatcher(None, candidate, name).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_name = name

        return best_name if best_ratio >= threshold else None

    # ------------------------------------------------------------
    # Period extraction
    # ------------------------------------------------------------
    PERIODS = {
        "today":     ["today", "today's", "ngayon", "ngayong araw"],
        "yesterday": ["yesterday", "yesterday's", "kahapon"],
        "this_week": ["this week", "current week", "ngayong linggo"],
        "last_week": ["last week", "previous week",
                      "nakaraang linggo", "nakalipas na linggo"],
        "this_month": ["this month", "current month", "ngayong buwan"],
        "last_month": ["last month", "previous month",
                       "nakaraang buwan", "nakalipas na buwan"],
        "this_year": ["this year", "current year", "ngayong taon"],
        "last_year": ["last year", "previous year",
                      "nakaraang taon", "nakalipas na taon"],
        "last_7_days": ["last 7 days", "past week", "last seven days",
                        "nakaraang 7 araw"],
        "last_30_days": ["last 30 days", "past month", "last thirty days",
                         "nakaraang 30 araw"],
    }

    def extract_period(self, text: str) -> Optional[str]:
        normalized = self.normalize(text)
        for period, phrases in self.PERIODS.items():
            for phrase in phrases:
                if phrase in normalized:
                    return period
        return None

    # ------------------------------------------------------------
    # Safe check: does this look like a POS-relevant question?
    # Used to decide whether to bother Gemini/Groq at all.
    # ------------------------------------------------------------
    POS_ANCHOR_WORDS = {
        "sales", "sale", "revenue", "stock", "inventory", "product",
        "products", "order", "orders", "transaction", "transactions",
        "customer", "customers", "receipt", "receipts", "forecast",
        "predict", "restock", "reorder", "profit", "earned", "sold",
        "best", "top", "seller", "selling", "popular", "low",
        "out", "category", "categories", "price", "prices", "cost",
        "report", "reports", "audit", "logs", "user", "users", "staff",
        "cashier", "admin", "day", "week", "month", "year", "today",
        "yesterday", "store", "shop", "business", "kirby",
    }

    def is_pos_relevant(self, text: str) -> bool:
        normalized = self.normalize(text)
        tokens = set()

        # Split on whitespace and take each token plus its apostrophe
        # base form. So "store's" contributes both "store's" AND "store",
        # which lets anchor words match even when the user writes
        # possessives ("my store's sales", "the customer's order").
        for raw in normalized.split():
            tokens.add(raw)
            # "store's" -> "store",  "customer's" -> "customer"
            base = raw.split("'", 1)[0]
            if base:
                tokens.add(base)

        return bool(tokens & self.POS_ANCHOR_WORDS)