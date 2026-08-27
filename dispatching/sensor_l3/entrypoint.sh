#!/bin/bash
set -e

SENSOR_BRIDGE="${SENSOR_BRIDGE:-br-mirror}"
SENSOR_L3_IP="${SENSOR_L3_IP:-192.168.30.50}"

L1_REMOTE_IP="${L1_REMOTE_IP:-192.168.30.254}"
L1_TUNNEL_KEY="${L1_TUNNEL_KEY:-101}"
L1_TUNNEL_IFACE="${L1_TUNNEL_IFACE:-mirror_l1}"

L2_REMOTE_IP="${L2_REMOTE_IP:-192.168.30.253}"
L2_TUNNEL_KEY="${L2_TUNNEL_KEY:-102}"
L2_TUNNEL_IFACE="${L2_TUNNEL_IFACE:-mirror_l2}"

echo "Demarrage du capteur OT L3..."

ip link del "${L1_TUNNEL_IFACE}" 2>/dev/null || true
ip link del "${L2_TUNNEL_IFACE}" 2>/dev/null || true
ip link del "${SENSOR_BRIDGE}" type bridge 2>/dev/null || true

ip link add name "${SENSOR_BRIDGE}" type bridge
ip link set "${SENSOR_BRIDGE}" up promisc on

ip link add "${L1_TUNNEL_IFACE}" type gretap \
  local "${SENSOR_L3_IP}" \
  remote "${L1_REMOTE_IP}" \
  key "${L1_TUNNEL_KEY}" \
  ttl 64

ip link add "${L2_TUNNEL_IFACE}" type gretap \
  local "${SENSOR_L3_IP}" \
  remote "${L2_REMOTE_IP}" \
  key "${L2_TUNNEL_KEY}" \
  ttl 64

ip link set "${L1_TUNNEL_IFACE}" master "${SENSOR_BRIDGE}"
ip link set "${L2_TUNNEL_IFACE}" master "${SENSOR_BRIDGE}"
ip link set "${L1_TUNNEL_IFACE}" up promisc on
ip link set "${L2_TUNNEL_IFACE}" up promisc on

mkdir -p /sensor-logs/suricata /sensor-logs/zeek /sensor-pcap

ip -br addr
ip -d link show "${L1_TUNNEL_IFACE}"
ip -d link show "${L2_TUNNEL_IFACE}"
ip -d link show "${SENSOR_BRIDGE}"
bridge link show

exec "$@"
