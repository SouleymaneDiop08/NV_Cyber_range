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


# --- Outils reseau utilisables par l'utilisateur du bureau -------------------
# Le build Docker ne preserve pas les capacites de fichier : /usr/bin/ping perd
# son cap_net_raw et devient inutilisable pour l'utilisateur `kali` (le compte
# de la session graphique), alors qu'il fonctionne encore en root. C'est le
# symptome classique « ping: socket: Operation not permitted ».
if command -v setcap >/dev/null 2>&1; then
    setcap cap_net_raw+ep /usr/bin/ping 2>/dev/null || chmod u+s /usr/bin/ping 2>/dev/null || true
else
    chmod u+s /usr/bin/ping 2>/dev/null || true
fi
# Meme traitement pour les scanners qui ouvrent des sockets bruts.
for b in /usr/bin/nmap /usr/bin/hping3 /usr/bin/traceroute; do
    [ -x "$b" ] && setcap cap_net_raw,cap_net_admin+ep "$b" 2>/dev/null || true
done
echo "[Kali] Capacites reseau restaurees pour l'utilisateur du bureau"

# --- Routes vers les zones industrielles -------------------------------------
# Kali est sur L3 (192.168.30.30) alors que les automates sont sur L1 et L2 :
# sans route explicite, ses scans partent vers la passerelle Docker et
# n'atteignent jamais les routeurs. Les routes retour existent deja cote
# automates (station_a/plc_a/entrypoint.sh).
#
# L'ancienne route vers un reseau SOC 192.168.40.0/24 via 192.168.30.251 a ete
# retiree : ni ce reseau ni ce routeur n'existent dans la topologie actuelle.
ROUTE_L1_GATEWAY="${ROUTE_L1_GATEWAY:-192.168.30.254}"   # router_r1_r3
ROUTE_L2_GATEWAY="${ROUTE_L2_GATEWAY:-192.168.30.253}"   # router_r2_r3

if command -v ip >/dev/null 2>&1; then
    ip route add 192.168.10.0/24 via "$ROUTE_L1_GATEWAY" dev eth0 2>/dev/null || true
    ip route add 192.168.20.0/24 via "$ROUTE_L2_GATEWAY" dev eth0 2>/dev/null || true
else
    route add -net 192.168.10.0 netmask 255.255.255.0 gw "$ROUTE_L1_GATEWAY" dev eth0 2>/dev/null || true
    route add -net 192.168.20.0 netmask 255.255.255.0 gw "$ROUTE_L2_GATEWAY" dev eth0 2>/dev/null || true
fi
echo "[Kali] Routes ajoutees : L1 via $ROUTE_L1_GATEWAY, L2 via $ROUTE_L2_GATEWAY"

# Start supervisord
exec "$@"