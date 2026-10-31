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
    """Separate model bundles for RAG and Studio."""

    def __init__(
        self,
        settings,
        llm=None,
        studio_llm=None,
        **overrides: Runnable,
    ) -> None:
        self._s = settings

        # --------------------------------------------------
        # RAG MODEL: Groq
        # --------------------------------------------------
        if llm is None and settings.groq_api_key:
            from langchain_groq import ChatGroq

            llm = ChatGroq(
                model=settings.llm_model,
                temperature=0.1,
                api_key=settings.groq_api_key,
                max_retries=3,
                timeout=60,
            )

        self.llm = llm

        # --------------------------------------------------
        # STUDIO MODEL: Cloudflare Workers AI
        # --------------------------------------------------
        if (
            studio_llm is None
            and settings.cf_account_id
            and settings.cf_api_token
        ):
            from langchain_cloudflare.chat_models import (
                ChatCloudflareWorkersAI,
            )

            studio_llm = ChatCloudflareWorkersAI(
                account_id=settings.cf_account_id,
                api_token=settings.cf_api_token,
                model=settings.studio_llm_model,
                temperature=0.1,
            )

        self.studio_llm = studio_llm

        off = RunnableLambda(_unconfigured)

        # RAG chain builder
        def build(name: str, make) -> Runnable:
            if name in overrides:
                return overrides[name]
            return make() if self.llm is not None else off

        # Studio chain builder
        def build_studio(name: str, make) -> Runnable:
            if name in overrides:
                return overrides[name]
            return make() if self.studio_llm is not None else off

        # --------------------------------------------------
        # RAG CHAINS - GROQ ONLY
        # --------------------------------------------------
        self.analyze = build(
            "analyze",
            lambda: prompts.ANALYZE
            | self.llm.with_structured_output(Analysis),
        )

        self.grade = build(
            "grade",
            lambda: prompts.GRADE
            | self.llm.with_structured_output(Grades),
        )

        self.rewrite = build(
            "rewrite",
            lambda: prompts.REWRITE
            | self.llm
            | StrOutputParser(),
        )

        self.generate = build(
            "generate",
            lambda: prompts.GENERATE
            | self.llm
            | StrOutputParser(),
        )

        self.check = build(
            "check",
            lambda: prompts.CHECK
            | self.llm.with_structured_output(GroundingCheck),
        )

        self.chat = build(
            "chat",
            lambda: prompts.CHAT
            | self.llm
            | StrOutputParser(),
        )

        # --------------------------------------------------
        # STUDIO CHAINS - CLOUDFLARE ONLY
        # --------------------------------------------------

        for kind, prompt in prompts.STUDIO.items():
            setattr(
                self,
                kind,
                build_studio(
                    kind,
                    lambda p=prompt: p
                    | self.studio_llm
                    | StrOutputParser(),
                ),
            )

        # Structured output uses JSON Schema, not function calling.
        self.mindmap = build_studio(
            "mindmap",
            lambda: prompts.MINDMAP
            | self.studio_llm.with_structured_output(
                MindMap,
                method="json_schema",
            ),
        )

        self.flashcards = build_studio(
            "flashcards",
            lambda: prompts.FLASHCARDS
            | self.studio_llm.with_structured_output(
                Flashcards,
                method="json_schema",
            ),
        )

        self.quiz = build_studio(
            "quiz",
            lambda: prompts.QUIZ
            | self.studio_llm.with_structured_output(
                Quiz,
                method="json_schema",
            ),
        )

        self.suggest = build_studio(
            "suggest",
            lambda: prompts.SUGGEST
            | self.studio_llm.with_structured_output(
                SuggestedQuestions,
                method="json_schema",
            ),
        )

        self.guide = build_studio(
            "guide",
            lambda: prompts.GUIDE
            | self.studio_llm.with_structured_output(
                SourceGuide,
                method="json_schema",
            ),
        )

    def safe(self, chain: Runnable, inputs: dict, default):
        """Run a structured chain and return default on failure."""
        try:
            out = chain.invoke(inputs)
            return default if out is None else out
        except UserError:
            raise
        except Exception:
            log.warning(
                "chain call failed; using default",
                exc_info=True,
            )
            return default

