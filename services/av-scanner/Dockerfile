# The virus scanner container (linux/amd64): ClamAV (clamd + freshclam from Debian) and the small
# HTTP API in dist/server.mjs. Build context: services/av-scanner, after `pnpm bundle`.
# The signature database is downloaded at build time, so a fresh instance can scan as soon as
# clamd has loaded it; freshclam then refreshes it while the instance runs (entrypoint.sh).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-daemon clamav-freshclam ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY clamd.conf freshclam.conf /etc/clamav/
RUN mkdir -p /run/clamav /var/lib/clamav /var/log/clamav \
  && chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav

# Everything runs as the unprivileged clamav user; nothing here needs root.
USER clamav
RUN freshclam --config-file=/etc/clamav/freshclam.conf --stdout

WORKDIR /app
COPY --chown=clamav:clamav dist/server.mjs ./server.mjs
COPY --chown=clamav:clamav entrypoint.sh ./entrypoint.sh

ENV NODE_ENV=production PORT=8080 CLAMD_SOCKET=/run/clamav/clamd.ctl
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "/app/entrypoint.sh"]
