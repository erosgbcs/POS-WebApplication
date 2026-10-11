"""
AI provider abstraction: Gemini primary, Groq fallback.

Only consulted for open-ended conversational requests that the local
NLP engine cannot resolve. Both providers get the same system prompt
and the same user message; they never see raw Firestore dumps.

Every call is timeout-bounded and never leaks provider error text to
the client. Retryable failures (429, 5xx, timeouts) trigger a single
retry before moving to the next provider.
"""

import os
import time
from typing import Optional

import requests

from .errors import ProviderError

# Gemini model kept per product decision — do not change.
DEFAULT_GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
DEFAULT_GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")

# Provider budget — total must stay under the Vercel function timeout.
GEMINI_TIMEOUT_S = float(os.environ.get("GEMINI_TIMEOUT_S", "6.0"))
GROQ_TIMEOUT_S = float(os.environ.get("GROQ_TIMEOUT_S", "6.0"))

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


# ----------------------------------------------------------------
# Gemini
# ----------------------------------------------------------------
class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: Optional[str] = None):
        if not api_key:
            raise ProviderError("GEMINI_API_KEY is not set.", retryable=False)
        self.api_key = api_key
        self.model = model or DEFAULT_GEMINI_MODEL
        self.url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )

    def chat(self, system_prompt: str, user_message: str,
             timeout: float = GEMINI_TIMEOUT_S) -> str:
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [{"text": user_message}]}],
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": 512,
            },
        }
        try:
            resp = requests.post(
                f"{self.url}?key={self.api_key}",
                json=payload,
                timeout=timeout,
            )
        except requests.Timeout as exc:
            raise ProviderError("Gemini timed out.", retryable=True) from exc
        except requests.RequestException as exc:
            raise ProviderError("Gemini network error.", retryable=True) from exc

        if resp.status_code != 200:
            # 404 = model not found. Treated as non-retryable so we move
            # straight to Groq instead of wasting a retry on the same URL.
            retryable = resp.status_code in RETRYABLE_STATUS
            raise ProviderError(
                f"Gemini HTTP {resp.status_code}", retryable=retryable
            )

        try:
            data = resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts).strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("Gemini returned an unexpected response.",
                                retryable=False) from exc

        if not text:
            raise ProviderError("Gemini returned an empty response.",
                                retryable=False)
        return text


# ----------------------------------------------------------------
# Groq  (OpenAI-compatible chat completions)
# ----------------------------------------------------------------
class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: Optional[str] = None):
        if not api_key:
            raise ProviderError("GROQ_API_KEY is not set.", retryable=False)
        self.api_key = api_key
        self.model = model or DEFAULT_GROQ_MODEL
        self.url = "https://api.groq.com/openai/v1/chat/completions"

    def chat(self, system_prompt: str, user_message: str,
             timeout: float = GROQ_TIMEOUT_S) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.4,
            "max_tokens": 512,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = requests.post(
                self.url, json=payload, headers=headers, timeout=timeout,
            )
        except requests.Timeout as exc:
            raise ProviderError("Groq timed out.", retryable=True) from exc
        except requests.RequestException as exc:
            raise ProviderError("Groq network error.", retryable=True) from exc

        if resp.status_code != 200:
            retryable = resp.status_code in RETRYABLE_STATUS
            raise ProviderError(
                f"Groq HTTP {resp.status_code}", retryable=retryable
            )

        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError("Groq returned an unexpected response.",
                                retryable=False) from exc

        if not text:
            raise ProviderError("Groq returned an empty response.",
                                retryable=False)
        return text


# ----------------------------------------------------------------
# Fallback chain
# ----------------------------------------------------------------
def _one_retry(provider, system_prompt: str, user_message: str) -> str:
    """Call `provider.chat`, retry once on a retryable failure."""
    try:
        return provider.chat(system_prompt, user_message)
    except ProviderError as exc:
        if not exc.retryable:
            raise
        time.sleep(0.4)
        return provider.chat(system_prompt, user_message)


def ask_ai(system_prompt: str, user_message: str) -> dict:
    """
    Try Gemini, then Groq. Returns:
        {"text": str, "provider": "gemini"|"groq"|None, "errors": [str]}

    Never raises. Callers must decide what to do with `provider == None`.
    """
    errors = []

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        try:
            text = _one_retry(GeminiProvider(gemini_key), system_prompt, user_message)
            return {"text": text, "provider": "gemini", "errors": errors}
        except ProviderError as exc:
            errors.append(f"gemini: {exc}")
        except Exception as exc:  # defensive; never let provider crash the pipeline
            errors.append(f"gemini: unexpected {type(exc).__name__}")

    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            text = _one_retry(GroqProvider(groq_key), system_prompt, user_message)
            return {"text": text, "provider": "groq", "errors": errors}
        except ProviderError as exc:
            errors.append(f"groq: {exc}")
        except Exception as exc:
            errors.append(f"groq: unexpected {type(exc).__name__}")

    return {"text": None, "provider": None, "errors": errors}