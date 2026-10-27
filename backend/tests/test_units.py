import numpy as np
import pytest
from conftest import FakeEmbeddings
from langchain_core.documents import Document

from app.chunking import locator_label, merge_units, split_text
from app.db import Repo
from app.errors import UserError
from app.faiss_store import FaissStore
from app.security import assert_public_url
from app.store import Library, NotebookStore
from app.youtube import extract_video_id


def test_split_text_respects_limit_and_overlaps():
    text = " ".join(f"Sentence number {i} is here." for i in range(200))
    parts = split_text(text, max_chars=300, overlap=60)
    assert len(parts) > 5
    assert all(len(p) <= 380 for p in parts)
    assert "Sentence number 0" in parts[0]
    # overlap: the end of one chunk reappears at the start of the next
    last_sentence = parts[0].split(". ")[-1][:15]
    assert last_sentence.split()[0] in parts[1]


def test_split_text_handles_giant_word_runs():
    parts = split_text("a" * 5000, max_chars=1000)
    assert all(len(p) <= 1000 for p in parts) and len(parts) >= 5


def test_merge_units_keeps_time_ranges():
    units = [(f"seg {i}", {"kind": "time", "start": i * 5.0, "end": i * 5.0 + 5}) for i in range(10)]
    out = merge_units(units, max_chars=1000, sep=" ")
    assert len(out) == 1
    assert out[0][1]["start"] == 0 and out[0][1]["end"] == 50


def test_merge_units_pages_range_label():
    units = [("x" * 400, {"kind": "page", "page": p}) for p in (1, 2, 3)]
    out = merge_units(units, max_chars=1000)
    assert [locator_label(l) for _, l in out] == ["Pages 1–2", "Page 3"]


def test_locator_labels():
    assert locator_label({"kind": "time", "start": 65, "end": 3725}) == "1:05 – 1:02:05"
    assert locator_label({"kind": "slide", "slide": 4}) == "Slide 4"
    assert locator_label({"kind": "web"}) == ""


@pytest.mark.parametrize("url", [
    "ftp://example.com", "file:///etc/passwd", "http://127.0.0.1/", "http://localhost/",
    "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data",
    "http://[::1]/", "http://user:pw@8.8.8.8/", "http://8.8.8.8:22/", "not a url",
])
def test_ssrf_blocked(url):
    with pytest.raises(UserError):
        assert_public_url(url)


def test_ssrf_allows_public_ip():
    assert assert_public_url("https://8.8.8.8/x").startswith("https://8.8.8.8")


@pytest.mark.parametrize("url,vid", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=10", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "dQw4w9WgXcQ"),
    ("https://evil.com/watch?v=dQw4w9WgXcQ", None),
    ("https://www.youtube.com/playlist?list=PL1", None),
])
def test_youtube_ids(url, vid):
    assert extract_video_id(url) == vid


def _vec(*xs):
    v = np.array(xs, dtype=np.float32)
    return v / np.linalg.norm(v)


def _docs(*texts, doc_id="d"):
    return [Document(page_content=t, metadata={"doc_id": doc_id}) for t in texts]


def test_faiss_store_add_search_filter_delete():
    store = FaissStore(FakeEmbeddings())
    ids1 = store.add_embedded(_docs("alpha", "beta", doc_id="a"), np.vstack([_vec(1, 0, 0), _vec(0, 1, 0)]))
    ids2 = store.add_embedded(_docs("gamma", doc_id="b"), np.vstack([_vec(0, 0, 1)]))
    assert len(store) == 3
    top = store.search_by_vector(_vec(0, 1, 0.1), 2)
    assert top[0][0].page_content == "beta" and top[0][1] > top[1][1]
    only_b = store.search_by_vector(_vec(0, 1, 0), 3, filter=lambda m: m["doc_id"] == "b")
    assert [d.page_content for d, _ in only_b] == ["gamma"]
    assert store.delete(ids1)
    assert [d.page_content for d, _ in store.search_by_vector(_vec(1, 0, 0), 5)] == ["gamma"]
    assert store.delete(ids2) and store.search_by_vector(_vec(1, 0, 0), 5) == []
    assert store.delete(["nope"]) is False


def test_faiss_store_is_a_langchain_vectorstore():
    store = FaissStore.from_texts(["closures remember scope", "mitochondria make ATP"], FakeEmbeddings(),
                                  metadatas=[{"n": 1}, {"n": 2}])
    hits = store.as_retriever(search_kwargs={"k": 1}).invoke("what do closures remember")
    assert hits[0].metadata["n"] == 1


def test_library_search_remove_and_filter():
    lib = Library(FakeEmbeddings())
    emb = FakeEmbeddings()
    a, b = lib.new_doc("a", "pdf"), lib.new_doc("b", "pdf")
    ta, tb = ["photosynthesis converts light", "mitochondria produce ATP"], ["closures capture scope"]
    lib.add_chunks(a.id, [Document(page_content=t, metadata={"loc": {}}) for t in ta],
                   np.asarray(emb.embed_documents(ta)))
    lib.add_chunks(b.id, [Document(page_content=t, metadata={"loc": {}}) for t in tb],
                   np.asarray(emb.embed_documents(tb)))
    assert lib.search("what produces ATP", 1)[0][0].page_content == "mitochondria produce ATP"
    assert [d.page_content for d, _ in lib.search("closures", 3, {b.id})] == ["closures capture scope"]
    assert lib.remove_doc(a.id) and lib.chunk_total() == 1
    assert lib.search("ATP", 5)[0][0].page_content == "closures capture scope"
    lib.clear()
    assert lib.search("anything", 5) == []


def test_notebook_store_idle_and_lru_eviction():
    evicted = []
    repo = Repo("sqlite://")
    s = NotebookStore(FakeEmbeddings(), repo, idle_minutes=1, max_loaded=2, on_evict=evicted.append)
    a, b, c = (repo.create_notebook("o", t)["id"] for t in "abc")
    la, _ = s.get(a), s.get(b)
    assert s.get(a) is la                       # cached
    s.get(c)                                     # over capacity: least recently used (b) goes
    assert evicted == [b] and len(s) == 2
    s._items[a].last_access -= 3600              # idle notebooks are unloaded on the next load
    s.get(b)
    assert a in evicted
    s.drop(c)
    assert c in evicted
