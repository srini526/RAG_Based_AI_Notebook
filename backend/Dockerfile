FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app app
COPY wsgi.py gunicorn.conf.py ./

# uid 1000 is also what Hugging Face Spaces expects
# /app/data holds the SQLite file when DATABASE_URL is not set
RUN useradd -m -u 1000 appuser && mkdir -p /app/data && chown -R appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.getenv('PORT','8000'))" || exit 1

CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:app"]
