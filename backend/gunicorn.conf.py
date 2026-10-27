import os

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
# IMPORTANT: sessions live in process memory, so run exactly ONE worker and scale with threads.
workers = 1
worker_class = "gthread"
threads = int(os.getenv("WEB_THREADS", "16"))
timeout = 300  # long uploads / SSE streams
graceful_timeout = 30
keepalive = 30
accesslog = None  # the app logs requests itself
errorlog = "-"
