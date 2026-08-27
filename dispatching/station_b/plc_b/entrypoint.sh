#!/bin/bash
set -e

echo "Configuration des routes PLC Station B..."
ip route add 192.168.30.0/24 via 192.168.20.254 || true
ip route add 192.168.10.0/24 via 192.168.20.254 || true


echo "Démarrage OpenPLC..."
exec ./start_openplc.sh
