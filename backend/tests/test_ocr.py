from io import BytesIO
from shutil import which

import pytest
from conftest import H, upload, wait_ready
from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFont

from app.parsers import parse_pdf


@pytest.fixture
def scan(tmp_path):
    image = Image.new("RGB", (1200, 350), "white")
    draw = ImageDraw.Draw(image)
    draw.text((45, 55), "Mitochondria produce ATP.\nCells use ATP for energy.",
              font=ImageFont.load_default(size=65), fill="black")
    path = tmp_path / "notes.png"
    image.save(path)
    return path


@pytest.mark.skipif(not which("tesseract"), reason="Tesseract is required")
def test_image_upload_indexes_ocr_text(client, sid, scan):
    config = client.get("/api/config").get_json()
    assert {"jpg", "jpeg", "png", "webp"} <= set(config["allowed_extensions"])
    response = upload(client, sid, "notes.png", scan.read_bytes())
    assert response.status_code == 202
    doc = wait_ready(client, sid, response.get_json()["document"]["id"])
    assert doc["status"] == "ready" and doc["kind"] == "image", doc

    response = client.post("/api/chat", headers=H(sid), json={"question": "What produces ATP?"})
    source = response.get_json()["sources"][0]
    assert source["kind"] == "image" and "Mitochondria produce ATP" in source["snippet"]


@pytest.mark.skipif(not (which("tesseract") and which("pdftoppm")), reason="Tesseract and Poppler are required")
def test_mixed_pdf_retains_page_numbers_for_native_and_scanned_text(scan, tmp_path):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.cell(text="This page has embedded text.")
    pdf.add_page()
    pdf.image(str(scan), x=12, y=35, w=186)
    pdf.add_page()
    pdf.cell(text="The final page also has embedded text.")
    path = tmp_path / "mixed.pdf"
    pdf.output(str(path))

    for src in (str(path), BytesIO(path.read_bytes())):
        units = parse_pdf(src)
        assert [loc["page"] for _, loc in units] == [1, 2, 3]
        assert "Mitochondria produce ATP" in units[1][0]
        assert units[0][0] == "This page has embedded text."
        assert units[2][0] == "The final page also has embedded text."


def test_corrupted_image_reports_upload_error(client, sid):
    response = upload(client, sid, "broken.webp", b"not an image")
    assert response.status_code == 202
    doc = wait_ready(client, sid, response.get_json()["document"]["id"])
    assert doc["status"] == "error" and "valid JPG, PNG, or WebP" in doc["message"]
