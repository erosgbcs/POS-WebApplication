"""Firebase Admin SDK bootstrap + read-only Firestore helpers.

Credentials are read from environment variables, never from disk.

Preferred (single JSON blob):
    FIREBASE_SERVICE_ACCOUNT_JSON   -> the raw JSON string

Alternative (split fields):
    FIREBASE_PROJECT_ID
    FIREBASE_CLIENT_EMAIL
    FIREBASE_PRIVATE_KEY            -> with \n escapes preserved
"""

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import firebase_admin
from firebase_admin import credentials, firestore

from .errors import ConfigError, DBError

_INIT_LOCK = threading.Lock()

# Store timezone. The store is in Bulacan, Philippines.
STORE_TZ = timezone(timedelta(hours=8), name="Asia/Manila")


def _build_credentials() -> credentials.Certificate:
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ConfigError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.") from exc
        return credentials.Certificate(data)

    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    client_email = os.environ.get("FIREBASE_CLIENT_EMAIL")
    private_key = os.environ.get("FIREBASE_PRIVATE_KEY")

    if not (project_id and client_email and private_key):
        raise ConfigError(
            "Firebase credentials are not configured. "
            "Set FIREBASE_SERVICE_ACCOUNT_JSON or the three split variables."
        )

    # Vercel sometimes escapes newlines in env vars; normalise them.
    private_key = private_key.replace("\\n", "\n")

    return credentials.Certificate({
        "type": "service_account",
        "project_id": project_id,
        "client_email": client_email,
        "private_key": private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    })


def _ensure_app() -> None:
    if firebase_admin._apps:
        return
    with _INIT_LOCK:
        if firebase_admin._apps:
            return
        cred = _build_credentials()
        firebase_admin.initialize_app(cred)


def get_db():
    """Return a Firestore client. Initialises the Admin app on first call."""
    _ensure_app()
    return firestore.client()


def get_app():
    """Return the initialized Firebase app (used by auth module)."""
    _ensure_app()
    return firebase_admin.get_app()


# ----------------------------------------------------------------
# Date helpers (Asia/Manila)
# ----------------------------------------------------------------

def now_manila() -> datetime:
    return datetime.now(STORE_TZ)


def today_key() -> str:
    return now_manila().strftime("%Y-%m-%d")


def day_key(dt: datetime) -> str:
    return dt.astimezone(STORE_TZ).strftime("%Y-%m-%d")


def parse_iso(ts: str) -> Optional[datetime]:
    """Parse an ISO8601 string into an aware datetime. Returns None on failure."""
    if not ts:
        return None
    try:
        value = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


# ----------------------------------------------------------------
# Read-only data access
# ----------------------------------------------------------------

def get_all_inventory() -> list:
    """Return every inventory document as a list of dicts."""
    try:
        db = get_db()
        return [{"id": d.id, **(d.to_dict() or {})}
                for d in db.collection("inventory").stream()]
    except Exception as exc:
        raise DBError("Could not read inventory from Firestore.") from exc


def get_orders_since(since: datetime, limit: int = 2000) -> list:
    """
    Return orders created on or after `since` (aware datetime), newest first.

    Firestore stores `createdAt` as an ISO 8601 string, so we filter
    client-side. The collection is bounded to `limit` to keep the
    serverless function within memory/time limits.
    """
    try:
        db = get_db()
        since_iso = since.astimezone(timezone.utc).isoformat()
        # Firestore can order by the createdAt string lexicographically
        # because all values are ISO 8601 UTC ("...Z" / "+00:00").
        query = (db.collection("orders")
                   .order_by("createdAt", direction=firestore.Query.DESCENDING)
                   .limit(limit))
        out = []
        for d in query.stream():
            data = d.to_dict() or {}
            created = data.get("createdAt", "")
            if isinstance(created, str) and created >= since_iso[:19]:
                out.append({"id": d.id, **data})
        return out
    except Exception as exc:
        raise DBError("Could not read orders from Firestore.") from exc


def get_orders_today() -> list:
    start = now_manila().replace(hour=0, minute=0, second=0, microsecond=0)
    return get_orders_since(start)


def get_orders_in_range(start: datetime, end: datetime) -> list:
    try:
        db = get_db()
        start_iso = start.astimezone(timezone.utc).isoformat()[:19]
        end_iso = end.astimezone(timezone.utc).isoformat()[:19]
        # DESCENDING — with ASCENDING, a store with >4000 lifetime orders
        # only ever fetches the oldest 4000 (all outside any recent window)
        # and every period query silently returns [].
        query = (db.collection("orders")
                   .order_by("createdAt", direction=firestore.Query.DESCENDING)
                   .limit(4000))
        out = []
        for d in query.stream():
            data = d.to_dict() or {}
            created = data.get("createdAt", "")
            if not isinstance(created, str):
                continue
            key = created[:19]
            if start_iso <= key <= end_iso:
                out.append({"id": d.id, **data})
        return out
    except Exception as exc:
        raise DBError("Could not read orders from Firestore.") from exc


def get_recent_orders(limit: int = 10) -> list:
    try:
        db = get_db()
        query = (db.collection("orders")
                   .order_by("createdAt", direction=firestore.Query.DESCENDING)
                   .limit(limit))
        return [{"id": d.id, **(d.to_dict() or {})} for d in query.stream()]
    except Exception as exc:
        raise DBError("Could not read orders from Firestore.") from exc


def get_setting(name: str, default=None):
    """Read a field from config/settings."""
    try:
        db = get_db()
        snap = db.collection("config").document("settings").get()
        if not snap.exists:
            return default
        return (snap.to_dict() or {}).get(name, default)
    except Exception:
        return default