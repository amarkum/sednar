"""gunicorn settings for hosted Sednar (see the Dockerfile).

One process, because logins and unlocked keys live in its memory, with many threads: agent turns are
long requests, and each open Socket.IO connection holds a thread.
"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '9000')}"
workers = 1
worker_class = "gthread"
threads = int(os.environ.get("SEDNAR_THREADS") or 64)
# A worker that stops answering for this long is restarted. Long agent turns are fine: the worker's main
# thread keeps answering while request threads work.
timeout = 120
graceful_timeout = 30
keepalive = 5
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("SEDNAR_LOG_LEVEL", "info").lower()
