"""Spot chat messages that ask for a Studio tool ("make me a quiz on closures").

A cheap, deterministic check, so the request goes straight to the Studio model without spending a
router call. Questions *about* a tool ("what is a mind map?") deliberately do not match.
"""
from __future__ import annotations

import re

_TOOLS = {
    "mindmap": r"mind[\s-]?maps?",
    "flashcards": r"flash[\s-]?cards?|flash[\s-]?card\s+deck",
    "quiz": r"quiz(?:zes)?|mcqs?|multiple[\s-]choice\s+(?:questions|test|quiz)",
    "study_guide": r"study[\s-]?guides?",
    "briefing": r"briefing(?:\s+doc(?:ument)?s?)?|briefing\s+note",
    "faq": r"faqs?",
    "timeline": r"timelines?",
}
_NOUN = {k: re.compile(rf"\b(?:{v})\b", re.I) for k, v in _TOOLS.items()}

_ASK = re.compile(
    r"\b(make|create|generate|build|prepare|produce|draw|design|compile|write|draft|give|show|turn|convert|"
    r"need|want|put together|set up|quiz me|test me)\b", re.I)
_CONCEPT_QUESTION = re.compile(r"^\s*(what|why|who|when|which|explain|define|describe|difference|how (does|do|is|are))\b", re.I)
_FOCUS = re.compile(r"\b(?:on|about|for|covering|regarding|from|of|around)\s+(.{3,160}?)\s*[.!?]*$", re.I)
_GENERIC_FOCUS = re.compile(
    r"^(?:this|that|these|those|it|them|here|everything)$|"
    r"^(?:my|the|these|those|this|that|all|every|our|your)?\s*(?:uploaded\s+)?"
    r"(?:sources?|documents?|docs?|files?|notes?|material|materials|content|notebook|library|pdfs?|everything|above|chat|conversation)$",
    re.I)


def detect_studio_request(text: str) -> tuple[str, str] | None:
    """Return (kind, focus) when the message asks to create a Studio tool, else None."""
    text = (text or "").strip()
    if not text or len(text) > 400 or _CONCEPT_QUESTION.match(text) or not _ASK.search(text):
        return None
    hits = [(m.start(), kind, m.end()) for kind, rx in _NOUN.items() if (m := rx.search(text))]
    if not hits:
        return None
    _, kind, end = min(hits)  # the first tool named wins
    focus = ""
    if m := _FOCUS.search(text[end:]):
        focus = m.group(1).strip(" \"'")
        if _GENERIC_FOCUS.match(focus):
            focus = ""
    return kind, focus
