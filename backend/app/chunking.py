"""Turn parsed (text, locator) units into retrieval-sized chunks."""
from __future__ import annotations

import re

from langchain_text_splitters import RecursiveCharacterTextSplitter


def split_text(text: str, max_chars: int = 1000, overlap: int = 150) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=max_chars,
        chunk_overlap=min(overlap, max_chars // 2),
        separators=["\n\n", "\n", "। ", ". ", "? ", "! ", "; ", ", ", " ", ""],
        keep_separator="end",
    )
    return [c.strip() for c in splitter.split_text(text) if c.strip()]


def combine_locs(locs: list[dict]) -> dict:
    first = dict(locs[0])
    kind = first.get("kind")
    if kind == "time":
        first["start"] = min(loc.get("start", 0) for loc in locs)
        first["end"] = max(loc.get("end", 0) for loc in locs)
    elif kind in ("page", "slide"):
        key = kind
        last = locs[-1].get(key)
        if last is not None and last != first.get(key):
            first[f"{key}_end"] = last
    return first


def merge_units(
    units: list[tuple[str, dict]],
    max_chars: int = 1000,
    overlap: int = 150,
    sep: str = "\n",
) -> list[tuple[str, dict]]:
    """Pack small units together, split big ones. Locators are preserved."""
    out: list[tuple[str, dict]] = []
    buf: list[str] = []
    locs: list[dict] = []
    size = 0

    def flush() -> None:
        nonlocal buf, locs, size
        if buf:
            out.append((sep.join(buf), combine_locs(locs)))
        buf, locs, size = [], [], 0

    for text, loc in units:
        text = (text or "").strip()
        if not text:
            continue
        if len(text) > max_chars:
            flush()
            for part in split_text(text, max_chars, overlap):
                out.append((part, dict(loc)))
            continue
        if size + len(text) + 1 > max_chars:
            flush()
        buf.append(text)
        locs.append(loc)
        size += len(text) + 1
    flush()
    return out


def fmt_time(seconds: float) -> str:
    s = int(seconds)
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02}:{sec:02}" if h else f"{m}:{sec:02}"


def locator_label(loc: dict) -> str:
    kind = loc.get("kind")
    if kind == "time":
        return f"{fmt_time(loc.get('start', 0))} – {fmt_time(loc.get('end', 0))}"
    if kind in ("page", "slide"):
        word = "Page" if kind == "page" else "Slide"
        a, b = loc.get(kind), loc.get(f"{kind}_end")
        return f"{word}s {a}–{b}" if b else f"{word} {a}"
    if kind == "section":
        return loc.get("section") or ""
    return ""
