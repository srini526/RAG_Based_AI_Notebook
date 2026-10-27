import hashlib
import io
import re
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from langchain_core.embeddings import Embeddings
from langchain_core.runnables import RunnableGenerator, RunnableLambda

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.chains import (
    Analysis,
    Branch,
    Chains,
    Flashcard,
    Flashcards,
    Grades,
    GroundingCheck,
    MindMap,
    Quiz,
    QuizQuestion,
    SourceGuide,
    SuggestedQuestions,
)
from app.config import Settings  # noqa: E402
from app.db import Repo  # noqa: E402
from app.factory import create_app  # noqa: E402

OWNER = "a1" * 16   # a device key (32 hex chars)
OTHER_OWNER = "b2" * 16


def H(nid, owner=OWNER):
    return {"X-Owner-Key": owner, "X-Notebook-Id": nid}


def new_notebook(client, owner=OWNER, title="Test notebook"):
    r = client.post("/api/notebooks", headers={"X-Owner-Key": owner}, json={"title": title})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["notebook"]["id"]


class FakeEmbeddings(Embeddings):
    """Bag-of-words hashing embeddings: deterministic, similar text -> similar vectors."""
    DIM = 128

    def _vec(self, text):
        v = np.zeros(self.DIM, dtype=np.float32)
        for w in re.findall(r"\w+", text.lower()):
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % self.DIM] += 1
        n = np.linalg.norm(v)
        return (v / n if n else v).tolist()

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


class FakeWeb:
    def __init__(self, available=False, results=None):
        self.available = available
        self.results = results if results is not None else []
        self.queries = []

    def search(self, query):
        self.queries.append(query)
        return self.results


class FakeTranscriber:
    def transcribe_media(self, src, workdir, progress=None):
        return [(0.0, 5.0, "Closures capture variables from their outer scope."),
                (5.0, 11.0, "A closure remembers the environment where it was created.")]


class Script:
    """Scripted LLM behaviour + a log of every chain call."""

    def __init__(self):
        self.calls = []
        self.grade_plan = None        # e.g. [[], [1]] -> one list of relevant indices per call
        self.check_plan = None        # e.g. [False, True]
        self.generate_texts = ["Answer from docs [S1]."]
        self.direct_prefixes = ("hi", "hello", "thanks")
        self.fail = set()             # chain names that should raise

    def _log(self, name, inp):
        self.calls.append((name, inp))
        if name in self.fail:
            raise RuntimeError(f"{name} down")

    def calls_of(self, name):
        return [i for n, i in self.calls if n == name]

    def chains(self, settings):
        def analyze(inp):
            self._log("analyze", inp)
            q = inp["question"]
            route = "direct" if q.lower().startswith(self.direct_prefixes) else "library"
            return Analysis(route=route, query=q)

        def grade(inp):
            self._log("grade", inp)
            n = len(re.findall(r"^\[\d+\]", inp["passages"], flags=re.M))
            if self.grade_plan:
                return Grades(relevant=self.grade_plan.pop(0))
            return Grades(relevant=list(range(1, n + 1)))

        def rewrite(inp):
            self._log("rewrite", inp)
            return f"rewritten {len(self.calls_of('rewrite'))}"

        def check(inp):
            self._log("check", inp)
            ok = self.check_plan.pop(0) if self.check_plan else True
            return GroundingCheck(grounded=ok, issues="" if ok else "claim X is unsupported")

        def streaming(name, texts):
            def transform(it):
                inp = None
                for chunk in it:
                    inp = chunk
                self._log(name, inp)
                text = texts() if callable(texts) else texts
                for tok in re.findall(r"\S+\s*", text):
                    yield tok
            return RunnableGenerator(transform)

        def gen_text():
            i = len(self.calls_of("generate")) - 1
            return self.generate_texts[min(i, len(self.generate_texts) - 1)]

        return Chains(
            settings,
            analyze=RunnableLambda(analyze), grade=RunnableLambda(grade),
            rewrite=RunnableLambda(rewrite), check=RunnableLambda(check),
            generate=streaming("generate", gen_text), chat=streaming("chat", "Hello! Ask me anything."),
            briefing=streaming("briefing", "Briefing of the material [S1]."),
            study_guide=streaming("study_guide", "Study guide for the material [S1]."),
            faq=streaming("faq", "**What is a closure?** A function with memory [S1]."),
            timeline=streaming("timeline", "- **Step 1** - closures are created [S1]"),
            quiz=RunnableLambda(lambda inp: self._structured("quiz", inp, Quiz(questions=[
                QuizQuestion(question="What do closures capture?", options=["Scope", "Nothing"],
                             answer_index=0, explanation="They keep their outer scope."),
                QuizQuestion(question="Broken", options=["only one"], answer_index=0)]))),
            flashcards=RunnableLambda(lambda inp: self._structured("flashcards", inp, Flashcards(cards=[
                Flashcard(front="Closure", back="A function plus its outer scope."),
                Flashcard(front="  ", back="dropped")]))),
            mindmap=RunnableLambda(lambda inp: self._structured("mindmap", inp, MindMap(
                title="Closures", branches=[Branch(label="Scope", children=["lexical", "outer"]),
                                            Branch(label=" ", children=[])]))),
            suggest=RunnableLambda(lambda inp: self._structured(
                "suggest", inp, SuggestedQuestions(questions=["What is a closure?", " ", "Why use recursion?"]))),
            guide=RunnableLambda(lambda inp: self._structured("guide", inp, SourceGuide(
                summary="A short guide.", topics=["closures", "scope"], questions=["What is a closure?"]))),
        )

    def _structured(self, name, inp, value):
        self._log(name, inp)
        return value


@pytest.fixture
def script():
    return Script()


@pytest.fixture
def settings():
    return Settings(rate_limit_enabled=False, max_docs_per_session=4, ingest_workers=2,
                    database_url="sqlite://")


@pytest.fixture
def web():
    return FakeWeb()


@pytest.fixture
def repo():
    return Repo("sqlite://")


@pytest.fixture
def client(settings, script, web, repo):
    app = create_app(settings, embeddings=FakeEmbeddings(), chains=script.chains(settings),
                     web=web, transcriber=FakeTranscriber(), repo=repo)
    return app.test_client()


@pytest.fixture
def sid(client):
    """Id of a fresh notebook owned by OWNER."""
    return new_notebook(client)


def wait_ready(client, sid, doc_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        docs = client.get("/api/library", headers=H(sid)).get_json()["documents"]
        d = next(x for x in docs if x["id"] == doc_id)
        if d["status"] in ("ready", "error"):
            return d
        time.sleep(0.05)
    raise AssertionError("ingest timed out")


def upload(client, sid, name, data: bytes):
    return client.post("/api/library/file", headers=H(sid),
                       data={"file": (io.BytesIO(data), name)},
                       content_type="multipart/form-data")
