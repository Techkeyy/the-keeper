import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

# Optional dependency: if unavailable, caller should continue with legacy logic.
try:
    import google.generativeai as genai
except Exception:
    genai = None


DEFAULT_DECISION: dict[str, Any] = {
    "decision": "buy",
    "target_id": None,
    "reasoning": "Fallback to first viable drop because AI is unavailable.",
    "confidence": 0.0,
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _fallback_from_available(available_drops: list[dict], reason: str) -> dict[str, Any]:
    if not available_drops:
        return {
            "decision": "skip",
            "target_id": None,
            "reasoning": reason,
            "confidence": 0.0,
        }

    first_id = available_drops[0].get("id")
    return {
        "decision": "buy",
        "target_id": first_id,
        "reasoning": reason,
        "confidence": 0.0,
    }


def _normalize_decision(raw: dict[str, Any], available_drops: list[dict]) -> dict[str, Any]:
    available_ids = {drop.get("id") for drop in available_drops if drop.get("id")}

    decision_value = str(raw.get("decision", "skip")).strip().lower()
    decision_value = "buy" if decision_value == "buy" else "skip"

    target_id = raw.get("target_id")
    if decision_value == "buy" and target_id not in available_ids:
        return _fallback_from_available(
            available_drops,
            "AI selected an unavailable drop. Falling back to first viable drop.",
        )

    confidence = _safe_float(raw.get("confidence", 0.0), 0.0)
    confidence = max(0.0, min(1.0, confidence))

    reasoning = str(raw.get("reasoning", "No reasoning provided.")).strip()
    if not reasoning:
        reasoning = "No reasoning provided."

    return {
        "decision": decision_value,
        "target_id": target_id if decision_value == "buy" else None,
        "reasoning": reasoning,
        "confidence": confidence,
    }


def _build_prompt(available_drops: list[dict], acquired_history: list[dict]) -> str:
    instructions = {
        "role": "You are an execution-ranking assistant for an autonomous signal buyer.",
        "objective": "Choose exactly one drop to buy or skip this cycle.",
        "preferences": [
            "Prioritize severity in this order: CRITICAL > HIGH > MEDIUM > LOW.",
            "Avoid duplicate tags already acquired in this session when alternatives exist.",
            "Consider value: better severity at lower price is preferred.",
            "If no option is compelling, return skip.",
        ],
        "output_contract": {
            "decision": "buy or skip",
            "target_id": "drop id if buy, otherwise null",
            "reasoning": "one sentence",
            "confidence": "0.0 to 1.0",
        },
        "strict_rules": [
            "Return JSON only.",
            "No markdown.",
            "No extra keys.",
        ],
        "available_drops": available_drops,
        "acquired_history": acquired_history,
        "timestamp_context": {
            "now_utc": datetime.now(timezone.utc).isoformat(),
            "note": "Prioritize near-expiry opportunities if quality is similar.",
        },
    }
    return json.dumps(instructions, ensure_ascii=True)


def _call_gemini(prompt: str, api_key: str) -> str:
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")
    response = model.generate_content(prompt)
    return getattr(response, "text", "") or ""


async def decide_which_drop(available_drops, acquired_history) -> dict:
    if not isinstance(available_drops, list):
        return _fallback_from_available([], "No available drops passed to AI.")

    if not available_drops:
        return {
            "decision": "skip",
            "target_id": None,
            "reasoning": "No viable drops available this cycle.",
            "confidence": 0.0,
        }

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or genai is None:
        return _fallback_from_available(
            available_drops,
            "Gemini unavailable or API key missing. Falling back to first viable drop.",
        )

    try:
        prompt = _build_prompt(available_drops, acquired_history if isinstance(acquired_history, list) else [])
        raw_text = await asyncio.to_thread(_call_gemini, prompt, api_key)

        # Gemini may wrap JSON in text. Pull the first JSON object from output safely.
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return _fallback_from_available(
                available_drops,
                "Gemini returned non-JSON output. Falling back to first viable drop.",
            )

        parsed = json.loads(raw_text[start : end + 1])
        if not isinstance(parsed, dict):
            return _fallback_from_available(
                available_drops,
                "Gemini response JSON is invalid. Falling back to first viable drop.",
            )

        return _normalize_decision(parsed, available_drops)
    except Exception:
        return _fallback_from_available(
            available_drops,
            "Gemini request failed. Falling back to first viable drop.",
        )
