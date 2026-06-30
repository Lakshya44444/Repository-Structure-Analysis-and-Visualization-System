from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Tuple

CACHE_DIR = Path(__file__).parent / ".ai_cache"
CACHE_DIR.mkdir(exist_ok=True)

PROMPT = (
    "You are a senior engineer onboarding a teammate. Explain what this "
    "{language} file does in 3 simple sentences. Be concrete about its "
    "purpose and main responsibilities. Do not include code.\n\n"
    "File: {name}\n{context}\n```{language}\n{content}\n```"
)

ARCH_PROMPT = (
    "You are a staff engineer writing an onboarding note for a new teammate. "
    "Based on the repository dependency map below, explain the project's "
    "overall architecture in 4-6 sentences: what it appears to do, its main "
    "modules/layers and how they relate, the most central files, and any "
    "architectural risks (circular dependencies or hotspots). Be concrete and "
    "do not invent details that aren't supported by the data.\n\n{digest}"
)

MAX_CHARS = 12_000  # cap content sent to the model


def _key(content: str, name: str, provider: str, model: str) -> str:
    h = hashlib.sha256()
    h.update(content.encode("utf-8", "ignore"))
    h.update(b"\x00")
    h.update(f"{name}|{provider}|{model}|v1".encode())
    return h.hexdigest()


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _read_cache(key: str) -> Optional[dict]:
    p = _cache_path(key)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _write_cache(key: str, data: dict) -> None:
    try:
        _cache_path(key).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def _resolve_provider() -> Tuple[str, str, Optional[str]]:
    """Return (provider, model, api_key)."""
    provider = os.environ.get("AI_PROVIDER", "auto").lower()
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    if provider == "auto":
        if gemini_key:
            provider = "gemini"
        elif openai_key:
            provider = "openai"
        else:
            provider = "offline"

    if provider == "gemini":
        return "gemini", os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"), gemini_key
    if provider == "openai":
        return "openai", os.environ.get("OPENAI_MODEL", "gpt-4o-mini"), openai_key
    return "offline", "heuristic", None


def _http_post_json(url: str, payload: dict, headers: dict, timeout: int = 45) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _call_gemini(prompt: str, model: str, key: str) -> str:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    out = _http_post_json(url, payload, {"Content-Type": "application/json"})
    return out["candidates"][0]["content"]["parts"][0]["text"].strip()


def _call_openai(prompt: str, model: str, key: str) -> str:
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    out = _http_post_json(url, payload, headers)
    return out["choices"][0]["message"]["content"].strip()


def _offline_summary(content: str, name: str, language: Optional[str]) -> str:
    """Deterministic fallback when no API key is available."""
    lines = content.splitlines()
    total = len(lines)
    defs = len(re.findall(r"^\s*(def|function|func|class|public|private)\b",
                          content, re.M))
    docstring = ""
    m = re.search(r'"""(.+?)"""', content, re.S) or re.search(r"'''(.+?)'''",
                                                              content, re.S)
    if m:
        docstring = " ".join(m.group(1).split())[:200]
    top_comment = ""
    for ln in lines[:5]:
        s = ln.strip().lstrip("#/").strip()
        if s:
            top_comment = s[:160]
            break
    parts = [
        f"`{name}` is a {language or 'text'} file with about {total} lines "
        f"and {defs} top-level definitions (functions/classes)."
    ]
    if docstring:
        parts.append(f"Its documentation suggests: {docstring}")
    elif top_comment:
        parts.append(f"Its leading comment reads: \"{top_comment}\".")
    else:
        parts.append("It contains implementation logic without a module docstring.")
    parts.append(
        "This is an offline heuristic summary - set GEMINI_API_KEY or "
        "OPENAI_API_KEY for an AI-generated explanation."
    )
    return " ".join(parts)


def _context_block(imports: list, imported_by: list) -> str:
    parts = []
    if imports:
        parts.append("This file imports: " + ", ".join(imports[:12]) + ".")
    if imported_by:
        parts.append("It is imported by: " + ", ".join(imported_by[:12]) + ".")
    return ("\nDependency context: " + " ".join(parts) + "\n") if parts else "\n"


def summarize(content: str, name: str, language: Optional[str],
              force: bool = False, imports: Optional[list] = None,
              imported_by: Optional[list] = None) -> dict:
    """Return {summary, provider, model, cached, generated_at}."""
    provider, model, key = _resolve_provider()
    snippet = content[:MAX_CHARS]
    context = _context_block(imports or [], imported_by or [])
    cache_key = _key(snippet + context, name, provider, model)

    if not force:
        cached = _read_cache(cache_key)
        if cached:
            cached["cached"] = True
            return cached

    prompt = PROMPT.format(language=language or "code", name=name,
                           content=snippet, context=context)

    error: Optional[str] = None
    try:
        if provider == "gemini" and key:
            summary = _call_gemini(prompt, model, key)
        elif provider == "openai" and key:
            summary = _call_openai(prompt, model, key)
        else:
            provider, model = "offline", "heuristic"
            summary = _offline_summary(snippet, name, language)
    except (urllib.error.URLError, KeyError, IndexError, TimeoutError) as e:
        error = str(e)
        provider, model = "offline", "heuristic"
        summary = _offline_summary(snippet, name, language)

    result = {
        "summary": summary,
        "provider": provider,
        "model": model,
        "cached": False,
        "generated_at": int(time.time()),
    }
    if error:
        result["fallback_reason"] = error
    _write_cache(cache_key, result)
    return result


def summarize_architecture(digest: str, force: bool = False) -> dict:
    """Whole-repo architecture overview from a client-built graph digest."""
    provider, model, key = _resolve_provider()
    digest = digest[:MAX_CHARS]
    cache_key = _key(digest, "__architecture__", provider, model)

    if not force:
        cached = _read_cache(cache_key)
        if cached:
            cached["cached"] = True
            return cached

    prompt = ARCH_PROMPT.format(digest=digest)
    error: Optional[str] = None
    try:
        if provider == "gemini" and key:
            summary = _call_gemini(prompt, model, key)
        elif provider == "openai" and key:
            summary = _call_openai(prompt, model, key)
        else:
            provider, model = "offline", "heuristic"
            summary = (
                "Offline mode: no AI key configured, so a generated architecture "
                "overview is unavailable. The dependency map, hotspot ranking and "
                "circular-dependency report on this page are computed locally and "
                "remain fully accurate. Set GEMINI_API_KEY or OPENAI_API_KEY for a "
                "narrative overview."
            )
    except (urllib.error.URLError, KeyError, IndexError, TimeoutError) as e:
        error = str(e)
        provider, model = "offline", "heuristic"
        summary = "Could not reach the AI provider; see the local metrics above."

    result = {
        "summary": summary, "provider": provider, "model": model,
        "cached": False, "generated_at": int(time.time()),
    }
    if error:
        result["fallback_reason"] = error
    _write_cache(cache_key, result)
    return result
