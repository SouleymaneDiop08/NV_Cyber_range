# ── Routeur inter-VLAN du jumeau ferroviaire ────────────────────────────────
#  Relie L3 (192.168.30.0/24) aux réseaux industriels/métier L2 (192.168.20.0/24)
#  et L40 (192.168.40.0/24). Routage IP pur (net.ipv4.ip_forward=1 + réseaux
#  directement connectés) : PAS d'iptables, PAS de NAT — conformément à la
#  consigne « pas de règles firewall ». Les conteneurs des trois réseaux ont
#  déjà, dans leurs entrypoints, les routes qui pointent vers ce routeur
#  (kali → .20/.40 via .30.253 ; plc → .30/.40 via .20.254 ; gare → .20/.30 via
#  .40.254). Image volontairement minimale (inspirée des routeurs du projet
#  dispatching, sans la pile Suricata/IDS superflue ici).
FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      iproute2 iputils-ping tcpdump procps && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
