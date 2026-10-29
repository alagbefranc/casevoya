#!/bin/sh
# Cloudflare's Container class (@cloudflare/containers) marks an instance healthy only after
# defaultPort answers its startup request, and it stops waiting after 20 seconds
# (TIMEOUT_TO_GET_PORTS_MS). This script used to run freshclam to completion before the HTTP
# server bound that port. freshclam's first run checks the mirror and downloads signatures
# before it daemonizes (and ReceiveTimeout defaults to waiting forever), so on Cloudflare the
# port stayed closed, the dashboard stayed at "active, 0 healthy", and the app cancelled the
# scan at 50 seconds. A just-built local image has nothing to download, which is why the same
# image answered on Docker.
#
# The HTTP server is exec'd immediately and listens on 0.0.0.0:8080. clamd loads the baked
# signatures beside it. freshclam starts only after clamd answers PING, so a slow mirror
# cannot block the health check and does not compete for memory while the engine loads.
set -eu

SOCKET="${CLAMD_SOCKET:-/var/lib/clamav/clamd.ctl}"
mkdir -p "$(dirname "$SOCKET")" /var/lib/clamav

clamd --config-file=/etc/clamav/clamd.conf &

# Stay in the foreground of this background job. A short-lived shell here is reparented onto
# node (the script execs it) and stays a zombie, because node does not reap children it did not spawn.
(
  i=0
  while [ "$i" -lt 90 ]; do
    if CLAMD_SOCKET="$SOCKET" node --input-type=commonjs -e 'const net=require("net");const s=net.connect(process.env.CLAMD_SOCKET);const finish=(code)=>{s.destroy();process.exit(code);};s.setTimeout(2000);s.on("timeout",()=>finish(1));s.on("error",()=>finish(1));s.on("connect",()=>s.write("zPING\0"));s.on("data",(buf)=>finish(String(buf).includes("PONG")?0:1));'; then
      break
    fi
    i=$((i + 1))
    sleep 2
  done
  # --daemon checks 12 times a day (freshclam.conf) and returns after it forks.
  # This shell then waits, so it is not a zombie under node.
  freshclam --config-file=/etc/clamav/freshclam.conf --daemon || echo "freshclam: could not start; using the signatures in the image"
  while true; do sleep 3600; done
) &

exec node /app/server.mjs
