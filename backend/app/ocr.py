"""Extract text with Tesseract and render scanned PDF pages with Poppler."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

from PIL import Image, ImageOps

from .errors import UserError

IMAGE_EXTENSIONS = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}
MAX_IMAGE_PIXELS = 16_000_000
RASTER_SIDE = 2400
OCR_SECONDS = 120


def _run(command: list[str], deadline: float) -> bytes:
    try:
        result = subprocess.run(command, check=True, capture_output=True,
                                timeout=max(0, deadline - monotonic()),
                                env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    except FileNotFoundError as exc:
        raise UserError("OCR isn't available on this server.") from exc
    except subprocess.TimeoutExpired as exc:
        raise UserError("OCR took too long. Try a smaller image or split the PDF into shorter files.") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise UserError("OCR couldn't read this file. Try a clearer scan or re-export the file.") from exc
    return result.stdout


def _read_text(image: Path, deadline: float) -> str:
    return _run(["tesseract", str(image), "stdout", "-l", "eng"], deadline).decode("utf-8", errors="replace")


def image_text(path: str, extension: str) -> str:
    with TemporaryDirectory(prefix="image-ocr-") as tmp:
        normalized = Path(tmp) / "image.png"
        try:
            with Image.open(path, formats=[IMAGE_EXTENSIONS[extension]]) as original:
                if original.width * original.height > MAX_IMAGE_PIXELS:
                    raise UserError("Image is too large for OCR (limit 16 megapixels).")
                if getattr(original, "is_animated", False):
                    raise UserError("Upload a still image for OCR.")
                image = ImageOps.exif_transpose(original)
                image.thumbnail((RASTER_SIDE, RASTER_SIDE))
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                background.save(normalized)
        except Image.DecompressionBombError as exc:
            raise UserError("Image is too large for OCR (limit 16 megapixels).") from exc
        except (OSError, SyntaxError, ValueError) as exc:
            raise UserError("Couldn't read this image. Check that it is a valid JPG, PNG, or WebP file.") from exc
        return _read_text(normalized, monotonic() + OCR_SECONDS)


def pdf_ocr_available() -> bool:
    return bool(shutil.which("pdftoppm") and shutil.which("tesseract"))


def pdf_page_texts(src, pages: list[int], progress=None):
    """Yield (page number, text) one page at a time within a shared OCR budget."""
    with TemporaryDirectory(prefix="pdf-ocr-") as tmp:
        if isinstance(src, (str, os.PathLike)):
            pdf = Path(src).resolve()
        else:
            pdf = Path(tmp) / "source.pdf"
            src.seek(0)
            with pdf.open("wb") as destination:
                shutil.copyfileobj(src, destination)

        prefix = Path(tmp) / "page"
        image = prefix.with_suffix(".png")
        deadline = monotonic() + OCR_SECONDS
        for index, page in enumerate(pages, 1):
            if progress:
                progress(f"Reading scanned pages ({index}/{len(pages)})…")
            _run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-cropbox",
                  "-scale-to", str(RASTER_SIDE), "-png", str(pdf), str(prefix)], deadline)
            yield page, _read_text(image, deadline)
            image.unlink()
