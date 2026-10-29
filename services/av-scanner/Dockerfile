# The virus scanner container (linux/amd64): ClamAV (clamd + freshclam from Debian) and the small
# HTTP API in dist/server.mjs. Build context: services/av-scanner, after `pnpm bundle`.
# The signature database is downloaded at build time, so a fresh instance can scan as soon as
# clamd has loaded it; freshclam then refreshes it while the instance runs (entrypoint.sh).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-daemon clamav-freshclam ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY clamd.conf freshclam.conf /etc/clamav/
# Socket and pid live in /var/lib/clamav (see clamd.conf). /run is not used: a fresh tmpfs there
# would hide a directory created at build time, and the clamav user could not recreate it.
RUN mkdir -p /var/lib/clamav /var/log/clamav \
  && chown -R clamav:clamav /var/lib/clamav /var/log/clamav

# Everything runs as the unprivileged clamav user; nothing here needs root.
USER clamav
RUN freshclam --config-file=/etc/clamav/freshclam.conf --stdout

WORKDIR /app
COPY --chown=clamav:clamav dist/server.mjs ./server.mjs
COPY --chown=clamav:clamav entrypoint.sh ./entrypoint.sh

ENV NODE_ENV=production PORT=8080 CLAMD_SOCKET=/var/lib/clamav/clamd.ctl
EXPOSE 8080
# /ping, not /healthz. /healthz is 503 until clamd has loaded the signatures, which on half a
# vCPU is longer than a health check should wait. /ping is 200 as soon as the server is bound
# to 0.0.0.0:8080, which is what "the instance is up" means. Readiness of clamd is GET /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini is PID 1: it reaps clamd and freshclam, and forwards SIGTERM to the whole group when the instance sleeps.
ENTRYPOINT ["tini", "-g", "--"]
CMD ["sh", "/app/entrypoint.sh"]
