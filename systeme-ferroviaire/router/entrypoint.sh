#!/bin/bash
set -e

echo "[router] Routeur inter-VLAN ferroviaire — L3 <-> L2 / L40"

# Le forwarding IP est activé par le compose (sysctls: net.ipv4.ip_forward=1).
# Aucune règle iptables n'est posée : dans le namespace réseau du conteneur, la
# politique FORWARD par défaut est ACCEPT, et le routeur est directement
# connecté aux trois sous-réseaux — il route donc nativement entre eux.
# (Aucun NAT : les cibles voient la vraie IP source .30/.20/.40 et répondent via
#  les routes de retour déjà configurées dans les autres conteneurs.)

if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" != "1" ]; then
  echo "[router] AVERTISSEMENT : ip_forward n'est pas à 1 — le routage ne fonctionnera pas."
else
  echo "[router] ip_forward = 1 (OK)"
fi

echo "[router] Interfaces :"
ip -br addr | sed 's/^/    /'
echo "[router] Table de routage (réseaux connectés) :"
ip route show | sed 's/^/    /'

# Rester au premier plan.
exec sleep infinity
