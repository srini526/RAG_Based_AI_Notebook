"""LCEL chains (prompt | model | parser) used by the chat graph."""
from __future__ import annotations

import logging
from typing import Literal

from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import Runnable, RunnableLambda
from pydantic import BaseModel, Field

from . import prompts
from .errors import UserError

log = logging.getLogger(__name__)


class Analysis(BaseModel):
    route: Literal["library", "direct"] = Field(description="Where to answer from")
    query: str = Field(default="", description="Standalone search query")


class Grades(BaseModel):
    relevant: list[int] = Field(default_factory=list, description="1-based numbers of useful passages")


class GroundingCheck(BaseModel):
    grounded: bool = Field(description="True if all claims are supported by the sources")
    issues: str = Field(default="", description="Unsupported claims or wrong citations")


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(description="4 answer choices")
    answer_index: int = Field(description="0-based index of the correct option")
    explanation: str = Field(default="", description="One sentence explaining the answer")


class Quiz(BaseModel):
    questions: list[QuizQuestion]


class SuggestedQuestions(BaseModel):
    questions: list[str]


class Flashcard(BaseModel):
    front: str
    back: str


class Flashcards(BaseModel):
    cards: list[Flashcard]


class Branch(BaseModel):
    label: str
    children: list[str] = Field(default_factory=list)


class MindMap(BaseModel):
    title: str
    branches: list[Branch]


class SourceGuide(BaseModel):
    summary: str
    topics: list[str]
    questions: list[str]


def _unconfigured(_input):
    raise UserError("The AI service is not configured on the server.")


class Chains:
    """Bundle of runnables. Any of them can be overridden (used by tests)."""

    def __init__(self, settings, llm=None, **overrides: Runnable) -> None:
        self._s = settings
        if llm is None and settings.groq_api_key:
            from langchain_groq import ChatGroq

            llm = ChatGroq(model=settings.llm_model, temperature=0.1,
                           api_key=settings.groq_api_key, max_retries=3, timeout=60)
        self.llm = llm
        off = RunnableLambda(_unconfigured)

        def build(name: str, make) -> Runnable:
            if name in overrides:
                return overrides[name]
            return make() if llm is not None else off

        self.analyze = build("analyze", lambda: prompts.ANALYZE | llm.with_structured_output(Analysis))
        self.grade = build("grade", lambda: prompts.GRADE | llm.with_structured_output(Grades))
        self.rewrite = build("rewrite", lambda: prompts.REWRITE | llm | StrOutputParser())
        self.generate = build("generate", lambda: prompts.GENERATE | llm | StrOutputParser())
        self.check = build("check", lambda: prompts.CHECK | llm.with_structured_output(GroundingCheck))
        self.chat = build("chat", lambda: prompts.CHAT | llm | StrOutputParser())
        # Studio tools
        for kind, prompt in prompts.STUDIO.items():
            setattr(self, kind, build(kind, lambda p=prompt: p | llm | StrOutputParser()))
        self.mindmap = build("mindmap", lambda: prompts.MINDMAP | llm.with_structured_output(MindMap))
        self.flashcards = build("flashcards", lambda: prompts.FLASHCARDS | llm.with_structured_output(Flashcards))
        self.quiz = build("quiz", lambda: prompts.QUIZ | llm.with_structured_output(Quiz))
        self.suggest = build("suggest", lambda: prompts.SUGGEST | llm.with_structured_output(SuggestedQuestions))
        self.guide = build("guide", lambda: prompts.GUIDE | llm.with_structured_output(SourceGuide))

    def safe(self, chain: Runnable, inputs: dict, default):
        """Run a structured chain; on any failure log and return `default` so the graph keeps going."""
        try:
            out = chain.invoke(inputs)
            return default if out is None else out
        except UserError:
            raise
        except Exception:
            log.warning("chain call failed; using default", exc_info=True)
            return default
