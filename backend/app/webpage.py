"""Fetch and extract readable text from a web page (SSRF-safe)."""
from __future__ import annotations

import io
from urllib.parse import urljoin, urlparse

import requests

from .errors import UserError
from .parsers import parse_pdf
from .security import assert_public_url

MAX_BYTES = 8 * 1024 * 1024
UA = "Mozilla/5.0 (compatible; RAGStudyAssistant/1.0)"


def fetch(url: str) -> tuple[bytes, str, str, str | None]:
    current = url
    for _ in range(5):
        assert_public_url(current)
        try:
            r = requests.get(current, headers={"User-Agent": UA}, timeout=15,
                             stream=True, allow_redirects=False)
        except requests.RequestException:
            raise UserError("Couldn't reach that link.")
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("Location")
            r.close()
            if not loc:
                raise UserError("The link redirected to nowhere.")
            current = urljoin(current, loc)
            continue
        if r.status_code >= 400:
            r.close()
            raise UserError(f"The site returned an error ({r.status_code}).")
        ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
        buf = bytearray()
        for part in r.iter_content(65536):
            buf.extend(part)
            if len(buf) > MAX_BYTES:
                r.close()
                raise UserError("That page is too large.")
        return bytes(buf), ctype, current, r.encoding
    raise UserError("Too many redirects.")


def extract(url: str) -> tuple[str, list[tuple[str, dict]]]:
    """Return (title, units)."""
    content, ctype, final_url, encoding = fetch(url)
    host = urlparse(final_url).hostname or "web page"
    if ctype == "application/pdf":
        return host, parse_pdf(io.BytesIO(content))
    if ctype and not (ctype.startswith("text/") or "html" in ctype or "xml" in ctype):
        raise UserError("That link isn't a web page or PDF.")
    import trafilatura

    html = content.decode(encoding or "utf-8", errors="replace")
    text = trafilatura.extract(html, include_tables=True, include_comments=False,
                               favor_recall=True, url=final_url)
    if not text or len(text.strip()) < 200:
        raise UserError("Couldn't find readable text on that page (it may need JavaScript or a login).")
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else host)[:150]
    return title, [(text, {"kind": "web"})]
