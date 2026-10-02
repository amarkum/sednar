# Sednar, hosted: people sign up, log in and use it in their browser with their own API key.
# See "Host a public demo" in README.md. Accounts, user folders and chats live in /data: mount a persistent
# disk there. To try the image locally:
#   docker build -t sednar-public .
#   docker run --rm -p 9000:9000 -v sednar-data:/data -e SEDNAR_SECRET_KEY=change-me sednar-public
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SEDNAR_PUBLIC=1 \
    SEDNAR_HOST=0.0.0.0 \
    SEDNAR_PUBLIC_ROOT=/data/users \
    HOME=/data/home \
    PORT=9000

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep bubblewrap \
    && rm -rf /var/lib/apt/lists/*

# The package imports itself as `sednar`, so the code must sit in a folder of that name.
WORKDIR /app/sednar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The server runs as a user that cannot change its own code (docker-entrypoint.sh switches to it).
RUN useradd --no-create-home --uid 10001 sednar
COPY . .

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('PORT', '9000'))"
ENTRYPOINT ["/app/sednar/docker-entrypoint.sh"]
CMD ["gunicorn", "-c", "gunicorn.conf.py", "server:app"]
