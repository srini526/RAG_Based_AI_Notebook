"""YouTube: captions first, audio download + Whisper as fallback."""
from __future__ import annotations

import logging
import os
import re
from urllib.parse import parse_qs, urlparse

import requests

from .errors import UserError

log = logging.getLogger(__name__)

_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
          "youtu.be", "www.youtu.be"}
_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> str | None:
    p = urlparse((url or "").strip())
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in _HOSTS:
        return None
    host = p.hostname.lower()
    if host.endswith("youtu.be"):
        vid = p.path.lstrip("/").split("/")[0]
    elif p.path == "/watch":
        vid = (parse_qs(p.query).get("v") or [""])[0]
    else:
        m = re.match(r"^/(shorts|embed|live|v)/([^/?#]+)", p.path)
        vid = m.group(2) if m else ""
    return vid if _ID.match(vid or "") else None


def watch_url(video_id: str, start: float | None = None) -> str:
    base = f"https://www.youtube.com/watch?v={video_id}"
    return f"{base}&t={int(start)}s" if start else base


def fetch_title(video_id: str, proxy: str = "") -> str:
    try:
        r = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": watch_url(video_id), "format": "json"},
            timeout=10,
            proxies={"https": proxy} if proxy else None,
        )
        if r.status_code == 200:
            return (r.json().get("title") or "")[:150] or f"YouTube {video_id}"
    except Exception:
        log.info("oembed failed", exc_info=True)
    return f"YouTube {video_id}"


def fetch_captions(video_id: str, proxy: str = "") -> list[tuple[float, float, str]] | None:
    """Return [(start, end, text)] or None when no captions are available."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api.proxies import GenericProxyConfig

        api = (
            YouTubeTranscriptApi(proxy_config=GenericProxyConfig(http_url=proxy, https_url=proxy))
            if proxy else YouTubeTranscriptApi()
        )
        listing = api.list(video_id)
        try:
            transcript = listing.find_transcript(["en", "en-US", "en-GB", "hi"])
        except Exception:
            transcript = next(iter(listing))
        fetched = transcript.fetch()
    except Exception:
        log.info("no captions for %s", video_id, exc_info=True)
        return None
    segs = []
    for s in fetched:
        text = re.sub(r"\s+", " ", s.text or "").strip()
        if not text or re.fullmatch(r"\[[^\]]*\]", text):  # [Music], [Applause]
            continue
        segs.append((float(s.start), float(s.start) + float(s.duration), text))
    return segs or None


def download_audio(video_id: str, workdir: str, settings) -> str:
    try:
        import yt_dlp
    except ImportError:
        raise UserError("YouTube audio download isn't available on the server.")
    url = watch_url(video_id)
    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(workdir, "yt.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
        "retries": 3,
        "max_filesize": 300 * 1024 * 1024,
    }
    if settings.youtube_proxy_url:
        opts["proxy"] = settings.youtube_proxy_url
    if settings.ytdlp_cookies_file and os.path.exists(settings.ytdlp_cookies_file):
        opts["cookiefile"] = settings.ytdlp_cookies_file
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            duration = info.get("duration") or 0
            if duration > settings.max_media_minutes * 60:
                raise UserError(f"Video is too long (limit {settings.max_media_minutes} minutes).")
            if info.get("is_live"):
                raise UserError("Live streams aren't supported.")
            ydl.download([url])
    except UserError:
        raise
    except Exception as e:
        log.exception("yt-dlp failed for video %s", video_id)
        raise UserError(
            "YouTube audio download failed on the server. "
            "Something went wrong"
            "Try uploading the video file instead."
        ) from e
    files = [f for f in os.listdir(workdir) if f.startswith("yt.")]
    if not files:
        raise UserError("Couldn't download the audio for this video.")
    return os.path.join(workdir, files[0])
