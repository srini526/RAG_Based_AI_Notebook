"""Studio tools and source guides, built from a notebook's sources.

Plain LangChain chains (no graph needed: the flow is linear). To stay inside free-tier token
limits, long material is sampled evenly across its whole length.
"""
from __future__ import annotations

import logging
from typing import Iterator

from langchain_core.documents import Document

from .answer import build_sources, cited_only, format_context
from .chains import Chains, Flashcards, MindMap, Quiz, SourceGuide, SuggestedQuestions
from .errors import UserError
from .store import Library

log = logging.getLogger(__name__)

MARKDOWN_KINDS = ("briefing", "study_guide", "faq", "timeline")
KINDS = (*MARKDOWN_KINDS, "mindmap", "flashcards", "quiz", "questions")
TITLES = {
    "briefing": "Briefing doc", "study_guide": "Study guide", "faq": "FAQ", "timeline": "Timeline",
    "mindmap": "Mind map", "flashcards": "Flashcards", "quiz": "Quiz",
}
STEP_LABELS = {
    "briefing": "Writing the briefing", "study_guide": "Writing the study guide", "faq": "Writing the FAQ",
    "timeline": "Building the timeline", "mindmap": "Mapping the ideas", "flashcards": "Writing flashcards",
    "quiz": "Building the quiz", "questions": "Thinking of questions",
}


def sample_evenly(passages: list[Document], budget_chars: int) -> list[Document]:
    """Keep reading order; if the text is too long, keep evenly spaced passages so the whole
    document stays represented."""
    total = sum(len(p.page_content) for p in passages)
    if total <= budget_chars or not passages:
        return passages
    keep = max(1, int(len(passages) * budget_chars / total))
    step = len(passages) / keep
    return [passages[int(i * step)] for i in range(keep)]


def _clean_quiz(quiz: Quiz) -> list[dict]:
    out = []
    for q in quiz.questions[:8]:
        options = [o.strip() for o in q.options if o and o.strip()][:6]
        if len(options) >= 2 and 0 <= q.answer_index < len(options) and q.question.strip():
            out.append({"question": q.question.strip(), "options": options,
                        "answer_index": q.answer_index, "explanation": q.explanation.strip()})
    return out


def _clean_mindmap(m: MindMap) -> dict | None:
    branches = [{"label": b.label.strip()[:60], "children": [c.strip()[:60] for c in b.children if c.strip()][:5]}
                for b in m.branches[:8] if b.label.strip()]
    return {"title": m.title.strip()[:80] or "Mind map", "branches": branches} if branches else None


def _clean_cards(c: Flashcards) -> list[dict]:
    return [{"front": x.front.strip()[:300], "back": x.back.strip()[:600]}
            for x in c.cards[:20] if x.front.strip() and x.back.strip()]


class Generator:
    def __init__(self, settings, chains: Chains) -> None:
        self._s = settings
        self._chains = chains

    # ----------------------------------------------------------------- Studio
    def stream(self, lib: Library, kind: str, doc_ids: set[str] | None = None) -> Iterator[dict]:
        if kind not in KINDS:
            raise UserError("Unknown tool.")
        lib_docs = dict(lib.docs)
        passages = [p for p in lib.chunks(doc_ids) if p.metadata.get("doc_id") in lib_docs]
        if not passages:
            raise UserError("Add a source first.")
        passages = sample_evenly(passages, self._s.gen_context_chars)
        sources = build_sources(passages, lib_docs)
        inputs = {
            "sources": format_context(passages, sources),
            "titles": ", ".join(dict.fromkeys(s["title"] for s in sources))[:600],
        }

        yield {"step": {"id": "read", "label": "Reading your sources"}}
        yield {"step": {"id": kind, "label": STEP_LABELS[kind]}}
        meta = {"kind": kind}

        if kind in MARKDOWN_KINDS:
            parts: list[str] = []
            for token in getattr(self._chains, kind).stream(inputs):
                if token:
                    parts.append(token)
                    yield {"token": token}
            yield {"done": True, "sources": cited_only("".join(parts), sources), "meta": meta}
        elif kind == "quiz":
            questions = _clean_quiz(self._structured(self._chains.quiz, inputs, Quiz))
            if not questions:
                raise UserError("Couldn't build a quiz this time. Please try again.")
            yield {"quiz": {"questions": questions}}
            yield {"done": True, "sources": [], "meta": meta}
        elif kind == "flashcards":
            cards = _clean_cards(self._structured(self._chains.flashcards, inputs, Flashcards))
            if not cards:
                raise UserError("Couldn't write flashcards this time. Please try again.")
            yield {"flashcards": cards}
            yield {"done": True, "sources": [], "meta": meta}
        elif kind == "mindmap":
            tree = _clean_mindmap(self._structured(self._chains.mindmap, inputs, MindMap))
            if tree is None:
                raise UserError("Couldn't build a mind map this time. Please try again.")
            yield {"mindmap": tree}
            yield {"done": True, "sources": [], "meta": meta}
        else:
            result = self._structured(self._chains.suggest, inputs, SuggestedQuestions)
            questions = [q.strip()[:160] for q in result.questions if q and q.strip()][:5]
            if not questions:
                raise UserError("Couldn't think of questions this time. Please try again.")
            yield {"questions": questions}
            yield {"done": True, "sources": [], "meta": meta}

    # ----------------------------------------------------------- source guide
    def make_guide(self, name: str, passages: list[Document]) -> dict | None:
        """Short guide for one source (summary, key topics, starter questions). Never raises."""
        if not self._s.source_guides or not passages:
            return None
        try:
            picked = sample_evenly(passages, min(self._s.gen_context_chars, 6000))
            guide = self._structured(self._chains.guide, {
                "titles": name, "sources": "\n\n".join(p.page_content for p in picked)}, SourceGuide)
            out = {"summary": guide.summary.strip()[:700],
                   "topics": [t.strip()[:40] for t in guide.topics if t.strip()][:6],
                   "questions": [q.strip()[:140] for q in guide.questions if q.strip()][:3]}
            return out if out["summary"] else None
        except Exception:
            log.warning("source guide failed for %s", name, exc_info=True)
            return None

    @staticmethod
    def _structured(chain, inputs: dict, model):
        try:
            result = chain.invoke(inputs)
            return model(**result) if isinstance(result, dict) else result
        except UserError:
            raise
        except Exception:
            log.warning("structured generation failed", exc_info=True)
            raise UserError("The AI service had a problem. Please try again.")
