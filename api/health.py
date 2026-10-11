"""GET /api/health — quick readiness probe."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        checks = {
            "firebase_credentials": bool(
                os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
                or (os.environ.get("FIREBASE_PROJECT_ID")
                    and os.environ.get("FIREBASE_CLIENT_EMAIL")
                    and os.environ.get("FIREBASE_PRIVATE_KEY"))
            ),
            "gemini_key": bool(os.environ.get("GEMINI_API_KEY")),
            "groq_key": bool(os.environ.get("GROQ_API_KEY")),
        }
        ready = checks["firebase_credentials"]

        body = json.dumps({
            "ok": ready,
            "checks": checks,
            "services": ["chat", "forecast"],
        }).encode("utf-8")

        self.send_response(200 if ready else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return