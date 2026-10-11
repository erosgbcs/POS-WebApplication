"""
POST /api/chat
Body: { "message": str, "history": [{role, text}, ...] }
Auth: Authorization: Bearer <Firebase ID token>

Pipeline:
  1. Validate input.
  2. Verify Firebase ID token, load profile.
  3. Load inventory names for NLP.
  4. Classify intent locally.
  5. If intent is known -> dispatch to a deterministic handler.
  6. If intent is unknown AND looks POS-relevant -> ask Gemini, then Groq.
  7. If both providers fail or message is unrelated -> honest fallback.
"""

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler

# Make ../api/_lib importable under Vercel's bundling.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib.auth import get_authenticated_user, get_user_profile  # noqa: E402
from _lib.errors import (  # noqa: E402
    AuthError, ChatError, DBError, ProviderError, ValidationError,
)
from _lib.firebase_client import get_all_inventory  # noqa: E402
from _lib.handlers import AI_SYSTEM_PROMPT, dispatch_intent  # noqa: E402
from _lib.nlp_engine import NLPEngine  # noqa: E402

MAX_MESSAGE_CHARS = 500
MAX_HISTORY_TURNS = 8


def _cors_headers(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Cache-Control", "no-store")


def _read_json(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0 or length > 64_000:
        raise ValidationError("Request body is missing or too large.")
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError("Request body must be valid JSON.") from exc


def _send_json(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    _cors_headers(handler)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _fallback_unknown(message: str) -> dict:
    return {
        "success": True,
        "intent": "unknown",
        "source": "local_fallback",
        "response": (
            "I'm not sure what you mean. I can help with inventory, "
            "sales, transactions, and sales forecasts."
        ),
        "data": {},
    }


def process_request(body: dict, authorization: str) -> dict:
    # ---- 1. Input validation ----
    message = body.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ValidationError("`message` is required and must be a non-empty string.")
    message = message.strip()
    if len(message) > MAX_MESSAGE_CHARS:
        raise ValidationError(f"Message is too long (max {MAX_MESSAGE_CHARS} characters).")

    raw_history = body.get("history") or []
    if not isinstance(raw_history, list):
        raw_history = []
    history = []
    for turn in raw_history[-MAX_HISTORY_TURNS:]:
        if not isinstance(turn, dict):
            continue
        role = "user" if turn.get("role") == "user" else "ai"
        text = str(turn.get("text") or "").strip()
        if text:
            history.append({"role": role, "text": text[:300]})

    # ---- 2. Auth ----
    user = get_authenticated_user(authorization)
    profile = get_user_profile(user["uid"])

    if profile.get("active") is False:
        raise AuthError("This account has been deactivated.")

    # ---- 3. Inventory for NLP ----
    inventory = get_all_inventory()
    product_names = [p.get("name", "") for p in inventory if p.get("name")]

    nlp = NLPEngine(product_names=product_names)
    classification = nlp.classify(message)
    intent = classification["intent"]
    confidence = classification["confidence"]

    # ---- 4. Local deterministic handler ----
    if intent != "unknown":
        ctx = {
            "user": user,
            "profile": profile,
            "intent": intent,
            "confidence": confidence,
            "message": message,
            "history": history,
            "inventory": inventory,
            "product": None,
            "period": nlp.extract_period(message),
        }

        # Attach a product entity when the intent needs one.
        if intent in ("inventory_check", "product_search"):
            matched = nlp.extract_product(message)
            if matched:
                for p in inventory:
                    if str(p.get("name", "")).lower() == matched:
                        ctx["product"] = p
                        break

        result = dispatch_intent(intent, ctx)
        if result is not None:
            return {
                "success": True,
                "intent": intent,
                "confidence": round(confidence, 3),
                "source": result.get("source", "local"),
                "response": result["response"],
                "data": result.get("data", {}),
            }

    # ---- 5. Unrelated / open-ended ----
    if not nlp.is_pos_relevant(message):
        return _fallback_unknown(message)

    # ---- 6. AI fallback for conversational POS questions ----
    from _lib.ai_providers import ask_ai

    ai = ask_ai(AI_SYSTEM_PROMPT, message)
    if ai.get("text"):
        return {
            "success": True,
            "intent": intent,
            "confidence": round(confidence, 3),
            "source": ai.get("provider") or "ai",
            "response": ai["text"],
            "data": {},
        }

    # ---- 7. Both providers down / unrelated ----
    return {
        "success": True,
        "intent": "unknown",
        "source": "local_fallback",
        "response": (
            "The AI assistant is temporarily unavailable, and I couldn't "
            "resolve that request locally. You can still ask about inventory, "
            "sales, transactions, and forecasts."
        ),
        "data": {},
    }


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        _cors_headers(self)
        self.end_headers()

    def do_GET(self):
        _send_json(self, 405, {"error": "Method not allowed. Use POST."})

    def do_POST(self):
        try:
            body = _read_json(self)
            authorization = self.headers.get("Authorization", "")
            payload = process_request(body, authorization)
            _send_json(self, 200, payload)
        except ValidationError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except AuthError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except DBError as exc:
            _send_json(self, exc.status, {
                "success": False,
                "error": "I couldn't retrieve your business data right now. "
                         "Please try again later.",
            })
            print(f"[chat] DBError: {exc}", file=sys.stderr)
        except ChatError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            _send_json(self, 500, {
                "success": False,
                "error": "An unexpected error occurred. Please try again.",
            })

    def log_message(self, format, *args):
        # Suppress default BaseHTTPRequestHandler logging.
        return