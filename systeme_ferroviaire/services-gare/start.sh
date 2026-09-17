#!/bin/sh
set -eu

GARE_GATEWAY="${GARE_GATEWAY:-192.168.40.254}"

if command -v ip >/dev/null 2>&1; then
  ip route replace 192.168.20.0/24 via "$GARE_GATEWAY" 2>/dev/null || true
  ip route replace 192.168.30.0/24 via "$GARE_GATEWAY" 2>/dev/null || true
fi

exec python /app/service.py
