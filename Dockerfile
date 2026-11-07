# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 escritorio \
    && useradd --system --uid 10001 --gid 10001 --home-dir /var/lib/escritorio --no-create-home --shell /usr/sbin/nologin escritorio \
    && mkdir -p /app /var/lib/escritorio \
    && chown 10001:10001 /var/lib/escritorio \
    && chmod 0700 /var/lib/escritorio

WORKDIR /app
COPY --chown=10001:10001 escritorio.py acesso.py social.py planta.py ./
COPY --chown=10001:10001 static/ ./static/
COPY --chown=10001:10001 times.exemplo.json /var/lib/escritorio/times.json
RUN chmod 0600 /var/lib/escritorio/times.json

ENV ESCRITORIO_BIND=0.0.0.0 \
    ESCRITORIO_PORTA=737 \
    ESCRITORIO_DADOS=/var/lib/escritorio \
    ESCRITORIO_TIMES=/var/lib/escritorio/times.json

USER 10001:10001
EXPOSE 737
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD python3 -B -I -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:737/entrar', timeout=2).read(1)"
ENTRYPOINT ["python3", "-B", "-I", "/app/escritorio.py"]
