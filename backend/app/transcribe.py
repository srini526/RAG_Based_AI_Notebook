"""Audio/video -> timestamped transcript using ffmpeg + Groq Whisper."""
from __future__ import annotations

import glob
import logging
import os
import subprocess
import time

from .errors import UserError

log = logging.getLogger(__name__)

SEGMENT_SECONDS = 600  # 10 min @ 48 kbps ~= 3.6 MB, far below Groq's 25 MB limit


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError:
        raise UserError("Media processing isn't available on the server (ffmpeg missing).")
    except subprocess.TimeoutExpired:
        raise UserError("Processing this file took too long.")


def probe_duration(path: str) -> float:
    r = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        timeout=60,
    )
    try:
        return float(r.stdout.decode().strip())
    except ValueError:
        return 0.0


def split_audio(src: str, workdir: str, seg_seconds: int = SEGMENT_SECONDS) -> list[str]:
    pattern = os.path.join(workdir, "part_%03d.mp3")
    r = _run(
        ["ffmpeg", "-nostdin", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
         "-c:a", "libmp3lame", "-b:a", "48k", "-f", "segment",
         "-segment_time", str(seg_seconds), "-reset_timestamps", "1", pattern],
        timeout=1800,
    )
    parts = sorted(glob.glob(os.path.join(workdir, "part_*.mp3")))
    if r.returncode != 0 or not parts:
        err = r.stderr.decode(errors="replace")
        log.warning("ffmpeg failed: %s", err[-400:])
        if "does not contain any stream" in err or "Stream map" in err:
            raise UserError("This file has no audio track to transcribe.")
        raise UserError("Couldn't read audio from this file. Is it a valid media file with sound?")
    return parts


def _get(obj, key, default=None):
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


class Transcriber:
    def __init__(self, settings, client=None) -> None:
        self._s = settings
        self._client = client

    @property
    def client(self):
        if self._client is None:
            if not self._s.groq_api_key:
                raise UserError("The AI service is not configured on the server.")
            from groq import Groq

            self._client = Groq(api_key=self._s.groq_api_key, timeout=180, max_retries=4)
        return self._client

    def _transcribe_part(self, path: str):
        with open(path, "rb") as f:
            data = f.read()
        kwargs = dict(
            file=(os.path.basename(path), data),
            model=self._s.whisper_model,
            response_format="verbose_json",
            temperature=0.0,
        )
        if self._s.whisper_language:
            kwargs["language"] = self._s.whisper_language
        for attempt in range(3):
            try:
                return self.client.audio.transcriptions.create(**kwargs)
            except UserError:
                raise
            except Exception as e:  # rate limits etc.
                if attempt == 2:
                    log.exception("whisper failed")
                    raise UserError("Transcription service error. Try again in a minute.") from e
                time.sleep(5 * (attempt + 1))

    def transcribe_media(self, src: str, workdir: str, progress=None) -> list[tuple[float, float, str]]:
        duration = probe_duration(src)
        if duration and duration > self._s.max_media_minutes * 60:
            raise UserError(f"Media is too long (limit {self._s.max_media_minutes} minutes).")
        if progress:
            progress("Extracting audio…")
        parts = split_audio(src, workdir)
        segments: list[tuple[float, float, str]] = []
        offset = 0.0
        for i, part in enumerate(parts, 1):
            if progress:
                progress(f"Transcribing {i}/{len(parts)}…")
            part_dur = probe_duration(part) or SEGMENT_SECONDS
            resp = self._transcribe_part(part)
            segs = _get(resp, "segments") or []
            for s in segs:
                text = (_get(s, "text") or "").strip()
                if text:
                    segments.append((offset + float(_get(s, "start", 0)),
                                     offset + float(_get(s, "end", 0)), text))
            if not segs:
                text = (_get(resp, "text") or "").strip()
                if text:
                    segments.append((offset, offset + part_dur, text))
            offset += part_dur
            os.remove(part)
        if not segments:
            raise UserError("No speech was detected in this file.")
        return segments
