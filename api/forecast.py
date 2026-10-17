"""
POST /api/forecast
Body: { "type": "sales" | "restock", "horizon": 7 | 30 | 365 }
Auth: Authorization: Bearer <Firebase ID token>
"""

import json
import os
import sys
import traceback
from datetime import timedelta
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _lib.auth import get_authenticated_user, get_user_profile  # noqa: E402
from _lib.errors import AuthError, ChatError, ValidationError  # noqa: E402
from _lib.firebase_client import (  # noqa: E402
    get_all_inventory, get_orders_in_range, now_manila,
)
from _lib.forecasting import forecast_next_7_days  # noqa: E402
from _lib.handlers import handle_restock_recommendation  # noqa: E402


def _cors_headers(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Cache-Control", "no-store")


def _read_json(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0 or length > 8_000:
        raise ValidationError("Request body is missing or too large.")
    try:
        return json.loads(handler.rfile.read(length).decode("utf-8"))
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


def _do_sales(horizon=7):
    today = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=max(60, horizon + 45))
    orders = get_orders_in_range(start, today + timedelta(days=1))
    result = forecast_next_7_days(orders, horizon=horizon)
    return {"success": True, "type": "sales", "data": result}


def _do_restock():
    result = handle_restock_recommendation({})
    return {
        "success": True,
        "type": "restock",
        "data": result.get("data", {}),
        "response": result.get("response", ""),
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
            user = get_authenticated_user(authorization)
            profile = get_user_profile(user["uid"])
            if profile.get("active") is False:
                raise AuthError("This account has been deactivated.")

            kind = (body.get("type") or "sales").lower()
            if kind == "sales":
                try:
                    horizon = int(body.get("horizon", 7))
                except (TypeError, ValueError):
                    raise ValidationError("`horizon` must be 7, 30, or 365.")
                if horizon not in (7, 30, 365):
                    raise ValidationError("`horizon` must be 7, 30, or 365.")
                _send_json(self, 200, _do_sales(horizon))
            elif kind == "restock":
                _send_json(self, 200, _do_restock())
            else:
                raise ValidationError("`type` must be 'sales' or 'restock'.")
        except ValidationError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except AuthError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except ChatError as exc:
            _send_json(self, exc.status, {"success": False, "error": str(exc)})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            _send_json(self, 500, {
                "success": False,
                "error": "An unexpected error occurred. Please try again.",
            })

    def log_message(self, format, *args):
        return