#!/bin/sh
set -e

# Le SCADA central est sur L3 (192.168.30.10) alors que les PLC sont sur L1 et
# L2 : sans route explicite, ses interrogations Modbus partent vers la
# passerelle Docker et n'atteignent jamais les routeurs. Les routes retour sont
# déjà posées côté PLC (station_a/plc_a/entrypoint.sh), et les routeurs ne font
# pas de NAT — c'est bien du routage de bout en bout.
#
# `|| true` : le conteneur doit démarrer même sans NET_ADMIN (build de secours,
# lancement hors du labo) ou si la route existe déjà.
echo "Configuration des routes SCADA central (L3 -> L1/L2)..."
ip route add 192.168.10.0/24 via "${ROUTE_L1_GATEWAY:-192.168.30.254}" || true
ip route add 192.168.20.0/24 via "${ROUTE_L2_GATEWAY:-192.168.30.253}" || true
ip route show

echo "Démarrage FUXA..."
exec "$@"
