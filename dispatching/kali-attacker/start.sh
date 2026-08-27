#!/bin/bash
set -e

VNC_PASS="${VNC_PASSWORD:-changeme}"
VNC_PASS_FILE="/etc/x11vnc.pass"

# Always overwrite with the proper format
x11vnc -storepasswd "${VNC_PASS}" "${VNC_PASS_FILE}" >/dev/null 2>&1
chmod 600 "${VNC_PASS_FILE}"

# ensure /opt/noVNC/utils/novnc_proxy exists; otherwise use websockify
if [ ! -x /opt/noVNC/utils/novnc_proxy ]; then
  # try to install websockify script entry point
  if [ -f /opt/noVNC/utils/websockify/run ]; then
    ln -s /opt/noVNC/utils/websockify/run /opt/noVNC/utils/novnc_proxy || true
  fi
fi

# Export display and resolution
export DISPLAY=${DISPLAY:-:1}
export RESOLUTION=${RESOLUTION:-1280x720}

# Routes réseau (votre config existante)
route add -net 192.168.10.0/24 gw 192.168.30.254 || true
route add -net 192.168.20.0/24 gw 192.168.30.253 || true

# --- GÉNÉRATION DU CERTIFICAT SSL (HTTPS) ---
CERT_DIR="/etc/ssl/novnc"
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/novnc.pem" ]; then
    echo "Creation du certificat HTTPS auto-signe..."
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$CERT_DIR/novnc.key" \
        -out "$CERT_DIR/novnc.crt" \
        -days 365 \
        -subj "/C=FR/ST=Paris/L=Paris/O=CyberRange/CN=kali-attacker"
    
    # Combiner clé et certificat pour websockify
    cat "$CERT_DIR/novnc.crt" "$CERT_DIR/novnc.key" > "$CERT_DIR/novnc.pem"
    chmod 644 "$CERT_DIR/novnc.pem"
fi
# --- FIN DE LA CONFIG HTTPS ---

# --- Route vers SOC (192.168.40.0/24) via Router R4 ---
# Essai avec 'ip' (iproute2) puis fallback 'route' (net-tools)
if command -v ip >/dev/null 2>&1; then
    ip route add 192.168.40.0/24 via 192.168.30.251 dev eth0 2>/dev/null || true
else
    route add -net 192.168.40.0 netmask 255.255.255.0 gw 192.168.30.251 dev eth0 2>/dev/null || true
fi
echo "[Kali] Route SOC ajoutée : 192.168.40.0/24 via 192.168.30.251"

# Start supervisord
exec "$@"