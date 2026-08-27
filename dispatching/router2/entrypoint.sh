#!/bin/bash
set -e

echo "Demarrage du routeur R2-R3 (deploiement OT_RANGE_V2)..."

# Le compose active deja net.ipv4.ip_forward=1 via sysctls.
# Ne pas ecrire dans /proc ici, car certaines plateformes montent ce chemin en lecture seule.
iptables -P FORWARD ACCEPT

sleep 2

ip route add 192.168.10.0/24 via 192.168.30.254 2>/dev/null || true

HEDGEHOG_ENABLE="${HEDGEHOG_ENABLE:-true}"
HEDGEHOG_LOCAL_IP="${HEDGEHOG_LOCAL_IP:-192.168.30.253}"
HEDGEHOG_REMOTE_IP="${HEDGEHOG_REMOTE_IP:-192.168.30.50}"
HEDGEHOG_TUNNEL_KEY="${HEDGEHOG_TUNNEL_KEY:-102}"
HEDGEHOG_TUNNEL_IFACE="${HEDGEHOG_TUNNEL_IFACE:-gretap_l2}"
HEDGEHOG_SENSOR_IP="${HEDGEHOG_REMOTE_IP}"

if [ "${HEDGEHOG_ENABLE}" = "true" ]; then
  echo "Configuration du port mirroring R2 -> ${HEDGEHOG_REMOTE_IP}..."
  tc qdisc del dev eth0 ingress 2>/dev/null || true
  tc qdisc del dev eth1 ingress 2>/dev/null || true
  ip link del "${HEDGEHOG_TUNNEL_IFACE}" 2>/dev/null || true

  ip link add "${HEDGEHOG_TUNNEL_IFACE}" type gretap \
    local "${HEDGEHOG_LOCAL_IP}" \
    remote "${HEDGEHOG_REMOTE_IP}" \
    key "${HEDGEHOG_TUNNEL_KEY}" \
    ttl 64

  ip link set "${HEDGEHOG_TUNNEL_IFACE}" up promisc on
  tc qdisc add dev eth0 ingress 2>/dev/null || true
  tc qdisc add dev eth1 ingress 2>/dev/null || true
  tc filter add dev eth0 parent ffff: matchall action mirred egress mirror dev "${HEDGEHOG_TUNNEL_IFACE}" 2>/dev/null || true
  # Exclure le trafic capteur sur L3 pour eviter la recopie recursive du GRE.
  tc filter add dev eth1 parent ffff: protocol ip pref 10 flower src_ip "${HEDGEHOG_SENSOR_IP}" action pass 2>/dev/null || true
  tc filter add dev eth1 parent ffff: protocol ip pref 11 flower dst_ip "${HEDGEHOG_SENSOR_IP}" action pass 2>/dev/null || true
  tc filter add dev eth1 parent ffff: matchall action mirred egress mirror dev "${HEDGEHOG_TUNNEL_IFACE}" 2>/dev/null || true
fi

ip -br addr
ip route show
ip -d link show "${HEDGEHOG_TUNNEL_IFACE}" 2>/dev/null || true
tc filter show dev eth0 ingress 2>/dev/null || true
tc filter show dev eth1 ingress 2>/dev/null || true

exec "$@"
