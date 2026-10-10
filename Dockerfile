# MyServices : collecteur, veille, santé, sauvegardes et page, en un conteneur (server.py).
# Outils système : ssh, ping, ip ; Node pour Archify.

# Nouveau front (front/, React + Vite) : tests, contrôle des types, puis compilation ; seul dist/ passe dans l'image
FROM node:22-trixie-slim AS front
WORKDIR /front
COPY front/package.json front/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY front/ ./
RUN npm test && npm run build

FROM python:3.14-slim-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client iputils-ping iproute2 ca-certificates tzdata nodejs \
 && rm -rf /var/lib/apt/lists/*

# Archify (carte de l'infra en HTML, archify_map.py) : version figée, empreinte vérifiée
ARG ARCHIFY_VERSION=3.0.1
ARG ARCHIFY_SHA256=b0b23bd28db314f04ca8ab9620fe20f8c1ac6474a3546bd8fe4679508aa1b7f5
COPY deploy/fetch_archify.py /tmp/fetch_archify.py
RUN python3 /tmp/fetch_archify.py "$ARCHIFY_VERSION" "$ARCHIFY_SHA256" && rm /tmp/fetch_archify.py

# Serveur (api.py : FastAPI, uvicorn) : versions figées, chaque paquet vérifié par son empreinte
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Compte sans droits ; ~/.ssh pointe sur le volume /config (clé, alias, known_hosts gérés par l'app)
RUN useradd --uid 10001 --create-home --home-dir /home/myservices --shell /usr/sbin/nologin myservices \
 && ln -s /config/ssh /home/myservices/.ssh \
 && mkdir -p /config /data && chown myservices:myservices /config /data

WORKDIR /app
COPY --chown=root:root *.py /app/
COPY --chown=root:root connectors/ /app/connectors/
COPY --chown=root:root web/ /app/web/
COPY --from=front --chown=root:root /front/dist/ /app/web/v2/

# Fichiers du volume /config et /data ; chaque clé reste surchargeable (MYSERVICES_<CLÉ>)
ENV MYSERVICES_CONFIG=/config/config.json \
    MYSERVICES_META=/config/services-meta.json \
    MYSERVICES_BACKUPS_META=/config/backups-meta.json \
    MYSERVICES_WEB_DIR=/data/web \
    MYSERVICES_CACHE_DIR=/data/cache \
    MYSERVICES_STATE_DIR=/data/state \
    MYSERVICES_DOCKER=1 \
    MYSERVICES_PORT=8090 \
    MYSERVICES_ARCHIFY=/opt/archify/bin/archify.mjs \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Version affichée dans Réglages → Système (CI : étiquette ou branche + commit)
ARG VERSION=dev
ENV MYSERVICES_VERSION=$VERSION

USER myservices
VOLUME ["/config", "/data"]
EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"MYSERVICES_PORT\"]}/healthz', timeout=4)"
CMD ["python3", "/app/server.py"]
