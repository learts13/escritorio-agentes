# Escritório dos agentes em container (Coolify ou outro proxy HTTPS na frente). Só a biblioteca padrão: sem pip.
# Os dados (token, usuários, sessões, marca, planta) ficam no volume /dados; o código fica só para leitura.
FROM python:3.12.16-slim-trixie@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54

RUN groupadd --system --gid 10001 escritorio \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin escritorio \
 && mkdir -m 0700 /dados && chown escritorio:escritorio /dados

WORKDIR /app
COPY escritorio.py acesso.py andares.py presenca.py social.py planta.py ajustes.py jornal.py avisos.py vapid.py novidades.py visitas_sala.py ./
COPY CHANGELOG.pt-BR.md ./
COPY static/ static/

# 0.0.0.0: o proxy chega pela rede do Docker. ESCRITORIO_BASE e AGENTES_ORG vêm de quem sobe (docker-compose.yml)
ENV ESCRITORIO_BIND=0.0.0.0 ESCRITORIO_PORTA=7371 ESCRITORIO_DADOS=/dados ESCRITORIO_TIMES=/dados/times.json

USER escritorio
VOLUME /dados
EXPOSE 7371
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python3", "-I", "-B", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['ESCRITORIO_PORTA'] + '/entrar', timeout=4)"]
# -B escrito: o -I ignora o PYTHONDONTWRITEBYTECODE
CMD ["python3", "-I", "-B", "escritorio.py"]
