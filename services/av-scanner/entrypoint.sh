#!/bin/sh
# Start clamd with the signatures baked into the image, start freshclam in the background
# (it updates at once and then 12 times a day, and tells clamd to reload), then the HTTP API.
# If freshclam can't reach the mirror the image's signatures are used; the API keeps answering.
set -eu

clamd --config-file=/etc/clamav/clamd.conf &
freshclam --config-file=/etc/clamav/freshclam.conf --daemon || echo "freshclam: could not start; using the signatures in the image"
exec node /app/server.mjs
