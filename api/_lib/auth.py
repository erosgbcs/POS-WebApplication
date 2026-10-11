"""Firebase ID-token verification for Vercel Python functions.

The frontend sends `Authorization: Bearer <firebase_id_token>`.
We verify it server-side with the Firebase Admin SDK. Never trust a
user id or role supplied in the request body.
"""

import os
from typing import Optional

from .errors import AuthError, ForbiddenError


def _verify_id_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims."""
    from firebase_admin import auth as fb_auth
    try:
        return fb_auth.verify_id_token(id_token, check_revoked=False)
    except Exception as exc:  # firebase_admin raises several subclasses
        raise AuthError("Invalid or expired authentication token.") from exc


def get_authenticated_user(authorization_header: Optional[str]) -> dict:
    """
    Extract and verify the caller's Firebase user from a header value.

    Returns a dict with at least `uid` and `email`.
    Raises AuthError on any failure.
    """
    if not authorization_header or not authorization_header.startswith("Bearer "):
        raise AuthError("Missing authentication token.")

    token = authorization_header.split(" ", 1)[1].strip()
    if not token:
        raise AuthError("Missing authentication token.")

    claims = _verify_id_token(token)
    uid = claims.get("uid") or claims.get("sub")
    if not uid:
        raise AuthError("Token is missing a user id.")

    return {
        "uid": uid,
        "email": claims.get("email", ""),
        "claims": claims,
    }


def get_user_profile(uid: str) -> dict:
    """Fetch the user's profile document (role/active) from Firestore."""
    from .firebase_client import get_db
    db = get_db()
    snap = db.collection("profiles").document(uid).get()
    if not snap.exists:
        raise ForbiddenError("No profile found for the authenticated user.")
    return snap.to_dict() or {}


def require_admin(uid: str) -> dict:
    """Verify the caller has role == 'admin'."""
    profile = get_user_profile(uid)
    if (profile.get("role") or "").lower() != "admin":
        raise ForbiddenError("This action requires an administrator role.")
    if profile.get("active") is False:
        raise ForbiddenError("This account has been deactivated.")
    return profile


def require_active_user(uid: str) -> dict:
    """Verify the account is not deactivated."""
    profile = get_user_profile(uid)
    if profile.get("active") is False:
        raise ForbiddenError("This account has been deactivated.")
    return profile