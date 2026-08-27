#!/bin/bash
set -e

# --- Routes réseau ---
# EWS — L3 (192.168.30.20)
# L1 via R1-R3 (30.254), L2 via R2-R3 (30.253)
route add -net 192.168.10.0/24 gw 192.168.30.254 || true
route add -net 192.168.20.0/24 gw 192.168.30.253 || true

# --- SSH setup ---
mkdir -p /run/sshd
ssh-keygen -A 2>/dev/null || true

# --- Mot de passe VNC ---
x11vnc -storepasswd "${VNC_PASSWORD:-changeme}" /etc/x11vnc.pass
chmod 600 /etc/x11vnc.pass

# --- Certificat HTTPS auto-signé pour noVNC ---
CERT_DIR="/etc/ssl/novnc"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/novnc.pem" ]; then
    echo "[SSL] Génération du certificat HTTPS EWS..."
    openssl req -x509 -nodes -newkey rsa:2048 \
        -keyout "$CERT_DIR/novnc.key" \
        -out    "$CERT_DIR/novnc.crt" \
        -days 365 \
        -subj "/C=FR/O=ICSHUB/CN=ews.icshub.local"
    cat "$CERT_DIR/novnc.crt" "$CERT_DIR/novnc.key" > "$CERT_DIR/novnc.pem"
    chmod 644 "$CERT_DIR/novnc.pem"
fi

# --- Activation de SSSD dans PAM (pam-auth-update) ---
DEBIAN_FRONTEND=noninteractive pam-auth-update --enable sss 2>/dev/null || true

# --- Route vers SOC (192.168.40.0/24) via Router R4 ---
route add -net 192.168.40.0 netmask 255.255.255.0 gw 192.168.30.251 dev eth0 2>/dev/null || true
echo "[EWS] Route SOC ajoutée : 192.168.40.0/24 via 192.168.30.251"

# --- Démarrage Wazuh Agent ---
/var/ossec/bin/wazuh-control start 2>/dev/null || true
echo "[EWS] Wazuh Agent démarré"

exec "$@"
