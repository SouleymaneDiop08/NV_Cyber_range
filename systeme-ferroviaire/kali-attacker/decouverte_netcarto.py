#!/usr/bin/env python3
"""
NetCarto — Cartographie Réseau Dynamique
=========================================
Outil de reconnaissance réseau temps réel.
- Lit la table de routage pour découvrir les sous-réseaux accessibles
- Lance nmap sur chaque sous-réseau
- Déduit le type de chaque hôte UNIQUEMENT depuis les ports/services détectés
- Construit la hiérarchie depuis la topologie réseau (table de routage)
- Aucune connaissance préalable du réseau n'est utilisée

Usage : python3 netcarto.py  →  http://0.0.0.0:5000
"""

import os, sys, subprocess

AUTO_INSTALL_DEPS = os.environ.get("NETCARTO_AUTO_INSTALL_DEPS", "0").lower() in {"1", "true", "yes", "on"}
IGNORE_DOCKER_GATEWAY_DOT1 = os.environ.get("NETCARTO_IGNORE_DOCKER_GATEWAY_DOT1", "1").lower() in {"1", "true", "yes", "on"}

# Auto-install des dépendances manquantes.
# Désactivé par défaut : en conteneur/prod, les dépendances doivent être fournies par l'image.
for mod, pkg in {"flask": "flask", "flask_socketio": "flask-socketio", "nmap": "python-nmap"}.items():
    try:
        __import__(mod)
    except ImportError:
        if not AUTO_INSTALL_DEPS:
            raise RuntimeError(
                f"Dépendance Python manquante: {mod}. "
                f"Installez le paquet correspondant ({pkg}) ou activez NETCARTO_AUTO_INSTALL_DEPS=1."
            )
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg,
                        "--break-system-packages"], check=True)

from flask import Flask, Response
from flask_socketio import SocketIO, emit
import threading, time, ipaddress, json
from datetime import datetime
import nmap as nmap_lib

app = Flask(__name__)
app.config["SECRET_KEY"] = "netcarto"
sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── État global ────────────────────────────────────────────────────────────────
hosts      = {}          # ip → {label, type, level, subnet, gateway, ports, alive, services}
edges_set  = set()
state_lock = threading.Lock()
is_scanning = False
scan_start_time = None
scan_end_time   = None

# Découverts depuis la table de routage — pas hardcodés
SUBNET_TO_GW  = {}   # "192.168.10.0/24" → "192.168.30.254"
GATEWAY_IPS   = set()
DIRECT_SUBNETS = []  # sous-réseaux directement attachés à l'interface

# ── Base de connaissances services (ports → rôle) ─────────────────────────────
# Cette table est universelle — basée sur les numéros de ports standards IANA/ICS
SERVICE_DB = {
    "502":   ("Modbus TCP",       "plc",    "CRITIQUE", "Protocole industriel sans authentification"),
    "102":   ("Siemens S7",       "plc",    "CRITIQUE", "Accès direct automate Siemens"),
    "44818": ("EtherNet/IP",      "plc",    "ÉLEVÉ",    "Protocole Allen-Bradley/Rockwell"),
    "20000": ("DNP3",             "plc",    "CRITIQUE", "Protocole SCADA sans auth"),
    "1962":  ("PCWorx",           "plc",    "CRITIQUE", "Protocole Phoenix Contact"),
    "789":   ("Red Lion",         "plc",    "CRITIQUE", "Interface automate Red Lion"),
    "1881":  ("FUXA SCADA",       "scada",  "ÉLEVÉ",    "Supervision sans auth forte"),
    "1882":  ("FUXA SCADA",       "scada",  "ÉLEVÉ",    "Supervision sans auth forte"),
    "1883":  ("MQTT",             "scada",  "ÉLEVÉ",    "Broker IoT/SCADA non chiffré"),
    "1884":  ("FUXA SCADA",       "scada",  "ÉLEVÉ",    "Supervision sans auth forte"),
    "4840":  ("OPC-UA",           "scada",  "ÉLEVÉ",    "Serveur OPC-UA"),
    "8080":  ("HTTP alternatif",  "server", "ÉLEVÉ",    "Interface web non standard"),
    "8086":  ("InfluxDB",         "server", "ÉLEVÉ",    "Base de données série temporelle"),
    "8888":  ("HTTP web",         "server", "MOYEN",    "Interface web"),
    "5443":  ("HTTPS alternatif", "server", "MOYEN",    "Interface web sécurisée"),
    "6080":  ("noVNC HTTP",       "server", "MOYEN",    "Bureau distant via navigateur"),
    "6081":  ("noVNC HTTP",       "server", "MOYEN",    "Bureau distant via navigateur"),
    "5900":  ("VNC",              "server", "ÉLEVÉ",    "Bureau distant sans TLS"),
    "22":    ("SSH",              "server", "MOYEN",    "Administration système"),
    "23":    ("Telnet",           "server", "CRITIQUE", "Administration non chiffrée"),
    "80":    ("HTTP",             "server", "INFO",     "Service web"),
    "443":   ("HTTPS",            "server", "INFO",     "Service web sécurisé"),
    "3389":  ("RDP",              "server", "ÉLEVÉ",    "Bureau distant Windows"),
    "445":   ("SMB",              "server", "ÉLEVÉ",    "Partage fichiers Windows"),
    "3306":  ("MySQL",            "server", "ÉLEVÉ",    "Base de données"),
    "5432":  ("PostgreSQL",       "server", "ÉLEVÉ",    "Base de données"),
    "21":    ("FTP",              "server", "CRITIQUE", "Transfert fichiers non chiffré"),
}

SEV_ORDER = {"CRITIQUE": 0, "ÉLEVÉ": 1, "MOYEN": 2, "INFO": 3}

NODE_STYLE = {
    "plc":     {"bg": "#dc2626", "border": "#7f1d1d", "shape": "box",      "size": 28},
    "scada":   {"bg": "#ea580c", "border": "#7c2d12", "shape": "ellipse",  "size": 30},
    "router":  {"bg": "#7c3aed", "border": "#4c1d95", "shape": "diamond",  "size": 32},
    "server":  {"bg": "#2563eb", "border": "#1e3a8a", "shape": "ellipse",  "size": 26},
    "unknown": {"bg": "#4b5563", "border": "#1f2937", "shape": "dot",      "size": 20},
}

# ── Lecture de la table de routage ────────────────────────────────────────────

def load_routing_table():
    """
    Lit la table de routage système pour découvrir :
    - DIRECT_SUBNETS : sous-réseaux directement attachés (pas de gateway)
    - SUBNET_TO_GW   : sous-réseaux routés et leur passerelle
    - GATEWAY_IPS    : IPs des passerelles découvertes
    Aucun réseau n'est codé en dur.
    """
    global SUBNET_TO_GW, GATEWAY_IPS, DIRECT_SUBNETS
    SUBNET_TO_GW.clear()
    GATEWAY_IPS.clear()
    DIRECT_SUBNETS.clear()

    try:
        out = subprocess.run(["ip", "route"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                if parts[0] == "default":
                    # Route par défaut — passerelle vers Internet, on ignore
                    continue
                dest = parts[0]
                net  = ipaddress.IPv4Network(dest, strict=False)
                net_str = str(net)

                if "via" in parts:
                    gw_idx = parts.index("via") + 1
                    gw = parts[gw_idx]
                    SUBNET_TO_GW[net_str] = gw
                    GATEWAY_IPS.add(gw)
                else:
                    DIRECT_SUBNETS.append(net_str)
            except Exception:
                pass
    except FileNotFoundError:
        pass

    # Fallback : netstat si ip route absent
    if not DIRECT_SUBNETS and not SUBNET_TO_GW:
        try:
            out = subprocess.run(["netstat", "-rn"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) < 3 or not parts[0][0:1].isdigit():
                    continue
                dest, gw, mask = parts[0], parts[1], parts[2]
                if dest == "0.0.0.0":
                    continue
                try:
                    net = str(ipaddress.IPv4Network(f"{dest}/{mask}", strict=False))
                    if gw == "0.0.0.0":
                        DIRECT_SUBNETS.append(net)
                    else:
                        SUBNET_TO_GW[net] = gw
                        GATEWAY_IPS.add(gw)
                except Exception:
                    pass
        except Exception:
            pass


def get_all_subnets():
    """Retourne tous les sous-réseaux à scanner (directs + routés)."""
    seen = set()
    result = []

    def add(n):
        if n not in seen and "169.254" not in n and "127." not in n:
            seen.add(n)
            result.append(n)

    for s in DIRECT_SUBNETS:
        add(s)
    for s in SUBNET_TO_GW:
        add(s)

    # Fallback ifconfig si rien trouvé
    if not result:
        try:
            out = subprocess.run(["ifconfig"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("inet ") and "127." not in line:
                    parts = line.split()
                    try:
                        add(str(ipaddress.IPv4Interface(f"{parts[1]}/{parts[3]}").network))
                    except Exception:
                        pass
        except Exception:
            pass

    return result

# ── Hiérarchie depuis la topologie ────────────────────────────────────────────

def get_level(ip, subnet):
    """
    Détermine le niveau hiérarchique d'un hôte depuis la table de routage.
    0 = réseau direct (même interface que l'attaquant)
    1 = passerelle découverte dans la table de routage
    2 = hôte dans un réseau routé (1 saut)
    N = hôte à N sauts (si on découvre des routes imbriquées)
    """
    if subnet in DIRECT_SUBNETS:
        if ip in GATEWAY_IPS:
            # IP de passerelle mais dans le réseau direct → niveau intermédiaire 1
            return 1
        return 0

    if ip in GATEWAY_IPS:
        return 1

    # Réseau routé → niveau 2 (ou plus si imbriqué)
    gw = SUBNET_TO_GW.get(subnet)
    if gw:
        # Vérifier si la gateway est elle-même derrière une autre gateway (routes imbriquées)
        for gw_subnet, gw2 in SUBNET_TO_GW.items():
            if ipaddress.ip_address(gw) in ipaddress.ip_network(gw_subnet, strict=False):
                return 3  # 2 sauts
        return 2

    return 0  # Défaut

# ── Type et label déduits du scan ─────────────────────────────────────────────

def detect_type(ip, ports):
    """
    Type déduit UNIQUEMENT des ports ouverts détectés par nmap.
    Aucune déduction par IP, subnet ou connaissance préalable.
    """
    if ip in GATEWAY_IPS:
        return "router"
    for p in ports:
        if p in ("502", "102", "44818", "20000", "1962", "789"):
            return "plc"
        if p in ("1881", "1882", "1883", "1884", "4840"):
            return "scada"
    return "server" if ports else "unknown"


def build_label(ip, ports):
    """
    Label déduit UNIQUEMENT des services détectés.
    Si aucun service reconnu : affiche juste l'IP.
    """
    if ip in GATEWAY_IPS:
        routed = [s for s, g in SUBNET_TO_GW.items() if g == ip]
        if routed:
            return ip + "\nRouteur → " + " | ".join(routed)
        return ip + "\nPasserelle"

    svcs = []
    for p in ports:
        if p in SERVICE_DB:
            svcs.append(SERVICE_DB[p][0])
        if len(svcs) >= 2:
            break

    if svcs:
        return ip + "\n" + svcs[0]

    return ip  # Aucune déduction — uniquement ce que le scan a trouvé

# ── Payload nœud ──────────────────────────────────────────────────────────────

def node_payload(ip, info, action="update"):
    t    = info.get("type", "unknown")
    st   = NODE_STYLE.get(t, NODE_STYLE["unknown"])
    alive = info.get("alive", True)
    level = info.get("level", 0)

    bg     = "#1a0000" if not alive else st["bg"]
    border = "#dc2626" if not alive else st["border"]

    # Sévérité maximale parmi les services
    max_sev = "INFO"
    for p in info.get("ports", []):
        if p in SERVICE_DB:
            s = SERVICE_DB[p][2]
            if SEV_ORDER.get(s, 9) < SEV_ORDER.get(max_sev, 9):
                max_sev = s

    services = [
        {"port": p, "name": SERVICE_DB[p][0], "sev": SERVICE_DB[p][2], "desc": SERVICE_DB[p][3]}
        for p in info.get("ports", []) if p in SERVICE_DB
    ]

    return {
        "action":   action,
        "id":       ip,
        "label":    info.get("label", ip),
        "type":     t,
        "shape":    st["shape"],
        "size":     st["size"],
        "subnet":   info.get("subnet", ""),
        "gateway":  info.get("gateway", ""),
        "level":    level,
        "alive":    alive,
        "severity": max_sev,
        "services": services,
        "color":    {"background": bg, "border": border,
                     "highlight": {"background": bg, "border": "#f8fafc"}},
    }

# ── Liaisons topologiques ─────────────────────────────────────────────────────

def maybe_add_edge(a, b):
    key = frozenset({a, b})
    with state_lock:
        if key in edges_set:
            return
        edges_set.add(key)
    sio.emit("edge_add", {"from": a, "to": b})


def connect_node(ip, info):
    """
    Crée les arêtes selon la topologie réseau découverte.
    Logique : chaque hôte est relié à sa passerelle naturelle.
    """
    subnet  = info["subnet"]
    level   = info.get("level", 0)
    gateway = info.get("gateway", "")

    with state_lock:
        snap = dict(hosts)

    if level == 0:
        # Réseau direct : relier aux passerelles L3 présentes sur ce réseau
        for peer, pinfo in snap.items():
            if peer != ip and pinfo.get("level") == 1:
                # La passerelle sert le réseau direct → liaison
                if pinfo.get("subnet") == subnet or pinfo.get("gateway") == "":
                    maybe_add_edge(ip, peer)

    elif level == 1:
        # Passerelle : relier aux hôtes du réseau direct ET aux hôtes routés derrière elle
        for peer, pinfo in snap.items():
            if peer == ip:
                continue
            if pinfo.get("level") == 0:
                maybe_add_edge(ip, peer)
            if pinfo.get("gateway") == ip:
                maybe_add_edge(ip, peer)

    elif level >= 2:
        # Hôte routé : relier uniquement à sa passerelle
        if gateway and gateway in snap:
            maybe_add_edge(ip, gateway)
        else:
            # Fallback : relier à n'importe quelle passerelle connue pour ce subnet
            for peer, pinfo in snap.items():
                if peer != ip and pinfo.get("level") == 1:
                    if pinfo.get("id") == gateway or ip in SUBNET_TO_GW.get(pinfo.get("subnet", ""), ""):
                        maybe_add_edge(ip, peer)
                        break

# ── Scanner ───────────────────────────────────────────────────────────────────

SCAN_PORTS = (
    "21,22,23,80,102,443,445,502,789,1881,1882,1883,1884,"
    "1962,3306,3389,4840,5432,5443,5900,6080,6081,"
    "8080,8086,8888,20000,44818"
)

# IPs à ignorer : adresses réseau/broadcast ou passerelles bridge non pertinentes.
# Le filtrage du .x.1 est utile dans ce lab Docker, mais peut masquer un vrai hôte
# sur un autre réseau. Il reste donc configurable par variable d'environnement.
def is_bridge_gateway(ip):
    """Retourne True si l'IP ressemble à une adresse réseau/broadcast/bridge à ignorer."""
    last = ip.split(".")[-1]
    ignored = {"0", "255"}
    if IGNORE_DOCKER_GATEWAY_DOT1:
        ignored.add("1")
    return last in ignored


def scan_subnet(subnet):
    sio.emit("log", {"msg": f"⟳  Scan {subnet}…", "level": "info"})
    nm = nmap_lib.PortScanner()
    try:
        nm.scan(
            hosts=subnet,
            ports=SCAN_PORTS,
            # Pas de -sV : on identifie les services par numéro de port (SERVICE_DB)
            # Sans -sV le scan est 5-10x plus rapide et évite les host-timeout
            arguments="-sT --open -T4 --host-timeout 60s"
        )
    except Exception as e:
        sio.emit("log", {"msg": f"✗  {subnet} : {e}", "level": "error"})
        return

    for host in nm.all_hosts():
        if nm[host].state() != "up":
            continue

        # Filtrer les passerelles bridge réseau (artefacts Docker/réseau, pas des équipements)
        if is_bridge_gateway(host):
            sio.emit("log", {"msg": f"  (ignoré : {host} — adresse réseau/bridge)", "level": "info"})
            continue

        ports_open = []
        try:
            for proto in nm[host].all_protocols():
                for port in sorted(nm[host][proto].keys()):
                    if nm[host][proto][port]["state"] == "open":
                        ports_open.append(str(port))
        except Exception:
            pass

        t       = detect_type(host, ports_open)
        level   = get_level(host, subnet)
        gateway = SUBNET_TO_GW.get(subnet, "")
        label   = build_label(host, ports_open)

        with state_lock:
            hosts[host] = {
                "label":   label,
                "type":    t,
                "ports":   ports_open,
                "alive":   True,
                "subnet":  subnet,
                "gateway": gateway,
                "level":   level,
            }

        log_lvl = "critical" if t == "plc" else "warn" if t in ("scada", "router") else "ok"
        sio.emit("node_update", node_payload(host, hosts[host], action="add"))
        sio.emit("log", {
            "msg":   f"✓  {host:16s}  [{t.upper():7s}]  niv.{level}  {len(ports_open)} port(s)",
            "level": log_lvl
        })
        sio.emit("stats_update", {"hosts": len(hosts)})
        connect_node(host, hosts[host])
        time.sleep(0.05)

    sio.emit("log", {"msg": f"✓  {subnet} terminé", "level": "info"})


def run_full_scan():
    global is_scanning, scan_start_time, scan_end_time
    is_scanning = True
    scan_start_time = datetime.now()
    load_routing_table()

    sio.emit("scan_started", {})
    sio.emit("log", {"msg": "═══ Démarrage du scan ═══", "level": "title"})

    subnets = get_all_subnets()
    if not subnets:
        sio.emit("log", {"msg": "✗  Aucun réseau détecté dans la table de routage", "level": "error"})
        is_scanning = False
        sio.emit("scan_done", {"total": 0})
        return

    gw_info = [f"{n} via {g}" for n, g in SUBNET_TO_GW.items()]
    sio.emit("log", {"msg": f"Réseaux : {' · '.join(subnets)}", "level": "info"})
    if gw_info:
        sio.emit("log", {"msg": "Passerelles : " + " | ".join(gw_info), "level": "info"})

    for subnet in subnets:
        scan_subnet(subnet)

    is_scanning = False
    scan_end_time = datetime.now()
    total = len(hosts)
    sio.emit("scan_done", {"total": total})
    sio.emit("log", {"msg": f"═══ {total} équipement(s) découvert(s) ═══", "level": "title"})
    sio.emit("report_ready", {})

# ── Monitoring continu ────────────────────────────────────────────────────────

def monitor_loop():
    while True:
        time.sleep(20)
        with state_lock:
            ips = list(hosts.keys())
        for ip in ips:
            alive = subprocess.run(
                ["ping", "-c", "1", "-W", "1", ip], capture_output=True
            ).returncode == 0
            with state_lock:
                if ip not in hosts:
                    continue
                prev = hosts[ip].get("alive", True)
                hosts[ip]["alive"] = alive
                info = hosts[ip].copy()
            if prev != alive:
                sio.emit("node_update", node_payload(ip, info, action="update"))
                state = "en ligne" if alive else "HORS LIGNE"
                sio.emit("log", {
                    "msg":   f"{'↑' if alive else '↓'}  {ip} → {state}",
                    "level": "ok" if alive else "error"
                })

# ── Génération du rapport ──────────────────────────────────────────────────────

def _recommendations(snap):
    """Génère des recommandations dynamiques depuis les services détectés."""
    recs = []
    ports_found = set()
    for info in snap.values():
        for p in info.get("ports", []):
            ports_found.add(p)

    RECO_DB = {
        "502":   ("CRITIQUE", "Modbus TCP exposé sans authentification",
                  "Isoler les automates sur un VLAN dédié. Déployer un pare-feu applicatif "
                  "bloquant Modbus depuis les réseaux non-ICS. Envisager un proxy Modbus "
                  "avec liste blanche de fonctions autorisées."),
        "102":   ("CRITIQUE", "Siemens S7 exposé (port 102)",
                  "Restreindre l'accès au port 102 aux seules stations d'ingénierie "
                  "autorisées via ACL ou pare-feu. Activer le contrôle d'accès S7+ si supporté."),
        "44818": ("ÉLEVÉ",    "EtherNet/IP exposé sans segmentation",
                  "Segmenter le réseau OT avec des VLAN. Restreindre les requêtes CIP "
                  "aux équipements légitimes uniquement."),
        "20000": ("CRITIQUE", "DNP3 exposé sans authentification (port 20000)",
                  "Activer DNP3 Secure Authentication v5. Isoler les équipements DNP3 "
                  "sur un segment réseau dédié."),
        "23":    ("CRITIQUE", "Telnet détecté — protocole non chiffré",
                  "Remplacer Telnet par SSH immédiatement. Bloquer le port 23 au niveau "
                  "firewall. Auditer qui accède à ces équipements."),
        "21":    ("CRITIQUE", "FTP détecté — transfert non chiffré",
                  "Remplacer FTP par SFTP ou FTPS. Si FTP est requis, le restreindre "
                  "à un réseau de gestion isolé avec authentification forte."),
        "5900":  ("ÉLEVÉ",    "VNC exposé — bureau distant sans TLS",
                  "Chiffrer les sessions VNC via un tunnel SSH ou VPN. "
                  "Restreindre l'accès VNC aux IPs de gestion uniquement."),
        "3389":  ("ÉLEVÉ",    "RDP exposé",
                  "Restreindre RDP au réseau de management. Activer NLA (Network Level "
                  "Authentication). Auditer les tentatives de connexion."),
        "445":   ("ÉLEVÉ",    "SMB exposé",
                  "Désactiver SMBv1. Restreindre SMB aux échanges internes strictement "
                  "nécessaires. Surveiller les accès anormaux."),
        "1883":  ("ÉLEVÉ",    "MQTT non authentifié détecté",
                  "Activer l'authentification MQTT (user/password + TLS). "
                  "Restreindre le broker aux clients ICS légitimes."),
        "4840":  ("ÉLEVÉ",    "OPC-UA détecté",
                  "Vérifier le niveau de sécurité OPC-UA (SignAndEncrypt recommandé). "
                  "Restreindre les connexions aux clients autorisés."),
        "8086":  ("ÉLEVÉ",    "InfluxDB exposé sans authentification probable",
                  "Activer l'authentification InfluxDB. Restreindre l'accès au port 8086 "
                  "aux seuls serveurs de supervision."),
        "6080":  ("MOYEN",    "noVNC accessible via navigateur",
                  "Protéger noVNC par un mot de passe fort. Envisager de passer par un "
                  "VPN plutôt qu'une exposition directe."),
        "6081":  ("MOYEN",    "noVNC accessible via navigateur",
                  "Protéger noVNC par un mot de passe fort. Restreindre l'accès réseau."),
        "8080":  ("ÉLEVÉ",    "Interface web non standard exposée (port 8080)",
                  "Vérifier si cette interface nécessite une authentification. "
                  "Restreindre l'accès aux administrateurs uniquement."),
    }

    PRIO = {"CRITIQUE": 0, "ÉLEVÉ": 1, "MOYEN": 2, "INFO": 3}
    found_recs = []
    for port, (sev, titre, detail) in RECO_DB.items():
        if port in ports_found:
            found_recs.append((PRIO.get(sev, 9), sev, titre, detail))
    found_recs.sort(key=lambda x: x[0])
    return [(sev, titre, detail) for _, sev, titre, detail in found_recs]


def generate_report_html():
    with state_lock:
        snap  = {ip: dict(info) for ip, info in hosts.items()}
        subnets_direct = list(DIRECT_SUBNETS)
        subnets_routed = dict(SUBNET_TO_GW)
        gw_ips         = set(GATEWAY_IPS)

    now       = datetime.now()
    scan_date = scan_start_time.strftime("%d/%m/%Y à %H:%M:%S") if scan_start_time else now.strftime("%d/%m/%Y à %H:%M:%S")
    duration  = ""
    if scan_start_time and scan_end_time:
        delta = scan_end_time - scan_start_time
        m, s  = divmod(int(delta.total_seconds()), 60)
        duration = f"{m}m {s}s"

    SEV_COL = {"CRITIQUE": "#dc2626", "ÉLEVÉ": "#ea580c", "MOYEN": "#ca8a04", "INFO": "#3b82f6"}
    TYPE_LABEL = {"plc": "PLC / Automate", "scada": "SCADA / HMI", "router": "Routeur",
                  "server": "Serveur", "unknown": "Inconnu"}

    # ── Compteurs ──────────────────────────────────────────────────────────────
    total     = len(snap)
    critiques = sum(1 for i in snap.values() if _host_severity(i) == "CRITIQUE")
    eleves    = sum(1 for i in snap.values() if _host_severity(i) == "ÉLEVÉ")
    moyens    = sum(1 for i in snap.values() if _host_severity(i) == "MOYEN")
    infos     = sum(1 for i in snap.values() if _host_severity(i) == "INFO")
    hors_ligne = sum(1 for i in snap.values() if not i.get("alive", True))
    nb_plc    = sum(1 for i in snap.values() if i.get("type") == "plc")
    nb_scada  = sum(1 for i in snap.values() if i.get("type") == "scada")
    nb_router = sum(1 for i in snap.values() if i.get("type") == "router")

    recs = _recommendations(snap)

    # ── Trier les hôtes par niveau puis IP ────────────────────────────────────
    sorted_hosts = sorted(snap.items(), key=lambda x: (x[1].get("level", 0),
                          [int(o) for o in x[0].split(".")]))

    # ── Trouver tous les services à risque ────────────────────────────────────
    risk_rows = []
    for ip, info in sorted_hosts:
        for p in info.get("ports", []):
            if p in SERVICE_DB:
                name, _, sev, desc = SERVICE_DB[p]
                if sev in ("CRITIQUE", "ÉLEVÉ"):
                    risk_rows.append((sev, ip, p, name, desc,
                                      info.get("type","unknown"), info.get("subnet","")))
    risk_rows.sort(key=lambda x: SEV_ORDER.get(x[0], 9))

    # ── Tableau inventaire ────────────────────────────────────────────────────
    rows_inv = ""
    for ip, info in sorted_hosts:
        sev  = _host_severity(info)
        col  = SEV_COL.get(sev, "#6b7280")
        typ  = info.get("type", "unknown")
        svcs = [SERVICE_DB[p][0] for p in info.get("ports", []) if p in SERVICE_DB]
        ports_str = ", ".join(info.get("ports", [])) or "—"
        alive_str = ("✔ En ligne" if info.get("alive", True) else "✘ Hors ligne")
        alive_col = "#16a34a" if info.get("alive", True) else "#dc2626"
        rows_inv += f"""
        <tr>
          <td style="font-family:monospace;font-weight:700">{ip}</td>
          <td>{TYPE_LABEL.get(typ, typ)}</td>
          <td>Niveau {info.get('level', 0)}</td>
          <td style="font-family:monospace;font-size:11px">{info.get('subnet','—')}</td>
          <td style="font-family:monospace;font-size:11px">{ports_str}</td>
          <td style="font-size:11px;color:#94a3b8">{', '.join(svcs[:3]) or '—'}</td>
          <td><span style="background:{col}22;color:{col};border:1px solid {col};
            border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">{sev}</span></td>
          <td style="color:{alive_col};font-weight:600;font-size:12px">{alive_str}</td>
        </tr>"""

    # ── Tableau réseau ────────────────────────────────────────────────────────
    rows_net = ""
    for subnet in subnets_direct:
        hosts_in = [ip for ip, i in snap.items() if i.get("subnet") == subnet]
        rows_net += f"""
        <tr>
          <td style="font-family:monospace">{subnet}</td>
          <td><span style="color:#38bdf8;font-weight:600">Direct</span></td>
          <td>—</td>
          <td>{len(hosts_in)} hôte(s)</td>
        </tr>"""
    for subnet, gw in subnets_routed.items():
        hosts_in = [ip for ip, i in snap.items() if i.get("subnet") == subnet]
        rows_net += f"""
        <tr>
          <td style="font-family:monospace">{subnet}</td>
          <td><span style="color:#a78bfa;font-weight:600">Routé</span></td>
          <td style="font-family:monospace">{gw}</td>
          <td>{len(hosts_in)} hôte(s)</td>
        </tr>"""

    # ── Tableau risques ───────────────────────────────────────────────────────
    rows_risk = ""
    for sev, ip, port, name, desc, typ, subnet in risk_rows:
        col = SEV_COL.get(sev, "#6b7280")
        rows_risk += f"""
        <tr>
          <td><span style="background:{col}22;color:{col};border:1px solid {col};
            border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">{sev}</span></td>
          <td style="font-family:monospace;font-weight:700">{ip}</td>
          <td style="font-family:monospace">{port}/tcp</td>
          <td>{name}</td>
          <td style="font-size:11px;color:#94a3b8">{desc}</td>
        </tr>"""

    # ── Recommandations ───────────────────────────────────────────────────────
    recs_html = ""
    for idx, (sev, titre, detail) in enumerate(recs, 1):
        col = SEV_COL.get(sev, "#6b7280")
        recs_html += f"""
        <div style="border-left:3px solid {col};background:{col}11;border-radius:0 8px 8px 0;
                    padding:12px 16px;margin:10px 0">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="background:{col}22;color:{col};border:1px solid {col};
              border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700">{sev}</span>
            <span style="font-weight:700;font-size:14px">{idx}. {titre}</span>
          </div>
          <div style="font-size:13px;color:#94a3b8;line-height:1.6">{detail}</div>
        </div>"""

    if not recs_html:
        recs_html = '<div style="color:#16a34a;padding:12px">✔ Aucun service à haut risque détecté.</div>'

    # ── Score de risque global ────────────────────────────────────────────────
    score = min(100, critiques * 30 + eleves * 10 + moyens * 3 + infos)
    score_col = "#dc2626" if score >= 60 else "#ea580c" if score >= 30 else "#ca8a04" if score >= 10 else "#16a34a"
    score_label = "CRITIQUE" if score >= 60 else "ÉLEVÉ" if score >= 30 else "MOYEN" if score >= 10 else "BAS"

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>NetCarto — Rapport de cartographie réseau</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
     line-height:1.6;padding:0}}
.page{{max-width:1100px;margin:0 auto;padding:32px 24px}}
h1{{font-size:26px;font-weight:900;color:#f8fafc;margin-bottom:4px}}
h2{{font-size:16px;font-weight:700;color:#f1f5f9;margin:32px 0 14px;
    padding-bottom:6px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:8px}}
h3{{font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;
    letter-spacing:.06em;margin:20px 0 8px}}
p{{color:#94a3b8;font-size:13px}}
.badge-row{{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}}
.badge{{border-radius:12px;padding:16px 24px;min-width:120px;text-align:center;border:1px solid}}
.badge .n{{font-size:32px;font-weight:900;display:block}}
.badge .l{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-top:2px}}
table{{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}}
th{{background:#1e293b;color:#64748b;font-size:11px;text-transform:uppercase;
    letter-spacing:.06em;padding:8px 12px;text-align:left;border-bottom:2px solid #334155}}
td{{padding:8px 12px;border-bottom:1px solid #1e293b;vertical-align:top}}
tr:hover td{{background:#1e293b44}}
.header-bar{{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);
             border-bottom:1px solid #334155;padding:24px 24px 20px;margin-bottom:0}}
.meta{{font-size:12px;color:#475569;margin-top:4px}}
.score-box{{display:inline-flex;align-items:center;gap:16px;background:#1e293b;
            border-radius:12px;padding:16px 24px;border:1px solid #334155;margin:16px 0}}
.score-n{{font-size:42px;font-weight:900}}
.score-info{{display:flex;flex-direction:column}}
.section{{background:#1e293b22;border:1px solid #1e293b;border-radius:12px;
           padding:20px;margin:16px 0}}
@media print{{
  body{{background:#fff;color:#000}}
  .header-bar{{background:#f8fafc;border-color:#e2e8f0}}
  h2{{border-color:#e2e8f0;color:#1e293b}}
  table{{font-size:12px}}
  th{{background:#f1f5f9;color:#475569}}
  .section{{border-color:#e2e8f0}}
  .badge{{border-width:1px}}
  .no-print{{display:none}}
}}
</style>
</head>
<body>

<div class="header-bar">
  <div style="max-width:1100px;margin:0 auto">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <h1>NetCarto — Rapport de cartographie réseau</h1>
        <div class="meta">Généré le {now.strftime('%d/%m/%Y à %H:%M:%S')} &nbsp;·&nbsp;
          Scan réalisé le {scan_date}
          {f'&nbsp;·&nbsp; Durée : {duration}' if duration else ''}
        </div>
      </div>
      <div class="no-print" style="display:flex;gap:8px;align-items:center">
        <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;
          border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer">
          🖨 Imprimer / PDF
        </button>
        <a href="/" style="background:#334155;color:#e2e8f0;border:none;
          border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;
          text-decoration:none;display:inline-block">← Retour</a>
      </div>
    </div>
  </div>
</div>

<div class="page">

<!-- ── Score global ── -->
<h2>🛡 Score de risque global</h2>
<div class="score-box">
  <div class="score-n" style="color:{score_col}">{score}/100</div>
  <div class="score-info">
    <span style="font-size:18px;font-weight:800;color:{score_col}">{score_label}</span>
    <span style="font-size:12px;color:#64748b;margin-top:2px">
      {total} équipement(s) · {critiques} critique(s) · {eleves} élevé(s)
    </span>
  </div>
</div>

<!-- ── Résumé exécutif ── -->
<h2>📊 Résumé exécutif</h2>
<div class="badge-row">
  <div class="badge" style="border-color:#334155;background:#1e293b">
    <span class="n" style="color:#38bdf8">{total}</span>
    <span class="l">Équipements</span>
  </div>
  <div class="badge" style="border-color:#7f1d1d;background:#1a0000">
    <span class="n" style="color:#dc2626">{critiques}</span>
    <span class="l">Critique</span>
  </div>
  <div class="badge" style="border-color:#7c2d12;background:#1c0f00">
    <span class="n" style="color:#ea580c">{eleves}</span>
    <span class="l">Élevé</span>
  </div>
  <div class="badge" style="border-color:#713f12;background:#1a1200">
    <span class="n" style="color:#ca8a04">{moyens}</span>
    <span class="l">Moyen</span>
  </div>
  <div class="badge" style="border-color:#1e3a8a;background:#0a1628">
    <span class="n" style="color:#3b82f6">{infos}</span>
    <span class="l">Info</span>
  </div>
  <div class="badge" style="border-color:#334155;background:#1e293b">
    <span class="n" style="color:#dc2626">{hors_ligne}</span>
    <span class="l">Hors ligne</span>
  </div>
</div>
<div class="badge-row" style="margin-top:0">
  <div class="badge" style="border-color:#7f1d1d;background:#1a0000">
    <span class="n" style="color:#dc2626">{nb_plc}</span>
    <span class="l">PLC / Automates</span>
  </div>
  <div class="badge" style="border-color:#7c2d12;background:#1c0f00">
    <span class="n" style="color:#ea580c">{nb_scada}</span>
    <span class="l">SCADA / HMI</span>
  </div>
  <div class="badge" style="border-color:#4c1d95;background:#12082a">
    <span class="n" style="color:#7c3aed">{nb_router}</span>
    <span class="l">Routeurs</span>
  </div>
  <div class="badge" style="border-color:#1e3a8a;background:#0a1628">
    <span class="n" style="color:#2563eb">{len(subnets_direct) + len(subnets_routed)}</span>
    <span class="l">Sous-réseaux</span>
  </div>
</div>

<!-- ── Topologie réseau ── -->
<h2>🌐 Topologie réseau découverte</h2>
<p style="margin-bottom:12px">Subnets identifiés depuis la table de routage — aucun réseau configuré manuellement.</p>
<div class="section">
  <table>
    <thead><tr><th>Sous-réseau</th><th>Type</th><th>Via (passerelle)</th><th>Hôtes découverts</th></tr></thead>
    <tbody>{rows_net or '<tr><td colspan="4" style="color:#475569">Aucun réseau détecté</td></tr>'}</tbody>
  </table>
</div>

<!-- ── Inventaire ── -->
<h2>🖥 Inventaire des équipements</h2>
<div class="section">
  <table>
    <thead><tr>
      <th>IP</th><th>Type</th><th>Niveau</th><th>Subnet</th>
      <th>Ports ouverts</th><th>Services</th><th>Risque</th><th>État</th>
    </tr></thead>
    <tbody>{rows_inv or '<tr><td colspan="8" style="color:#475569">Aucun équipement découvert</td></tr>'}</tbody>
  </table>
</div>

<!-- ── Analyse des risques ── -->
<h2>⚠ Analyse des risques</h2>
<p style="margin-bottom:12px">Services à risque détectés par nmap, triés par sévérité.</p>
<div class="section">
  <table>
    <thead><tr><th>Sévérité</th><th>IP</th><th>Port</th><th>Service</th><th>Description</th></tr></thead>
    <tbody>{rows_risk or '<tr><td colspan="5" style="color:#16a34a">✔ Aucun service à haut risque détecté</td></tr>'}</tbody>
  </table>
</div>

<!-- ── Recommandations ── -->
<h2>📋 Recommandations</h2>
<p style="margin-bottom:12px">Générées automatiquement depuis les services identifiés.</p>
{recs_html}

<!-- ── Détail par hôte ── -->
<h2>🔍 Détail par équipement</h2>"""

    for ip, info in sorted_hosts:
        sev     = _host_severity(info)
        col     = SEV_COL.get(sev, "#6b7280")
        typ     = info.get("type", "unknown")
        ports   = info.get("ports", [])
        alive   = info.get("alive", True)
        svcs_html = ""
        for p in ports:
            if p in SERVICE_DB:
                n, _, sv, desc = SERVICE_DB[p]
                sc = SEV_COL.get(sv, "#6b7280")
                svcs_html += (f'<tr><td style="font-family:monospace;color:#38bdf8">{p}/tcp</td>'
                              f'<td>{n}</td>'
                              f'<td style="color:#94a3b8;font-size:12px">{desc}</td>'
                              f'<td><span style="background:{sc}22;color:{sc};border:1px solid {sc};'
                              f'border-radius:3px;padding:1px 6px;font-size:11px;font-weight:700">{sv}</span></td></tr>')
        if not svcs_html and ports:
            for p in ports:
                svcs_html += (f'<tr><td style="font-family:monospace;color:#38bdf8">{p}/tcp</td>'
                              f'<td colspan="3" style="color:#475569">Non identifié dans la base de services</td></tr>')

        html += f"""
<div style="border:1px solid {col}44;border-radius:10px;padding:16px;margin:10px 0;
            background:{col}08">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-family:monospace;font-size:18px;font-weight:900;color:#f8fafc">{ip}</span>
    <span style="background:{col}22;color:{col};border:1px solid {col};border-radius:4px;
      padding:2px 10px;font-size:11px;font-weight:700">{sev}</span>
    <span style="color:#64748b;font-size:12px">{TYPE_LABEL.get(typ, typ)}</span>
    <span style="color:#64748b;font-size:12px">Niveau {info.get('level', 0)}</span>
    <span style="font-family:monospace;font-size:12px;color:#475569">{info.get('subnet','')}</span>
    {f'<span style="color:#475569;font-size:12px">via {info.get("gateway")}</span>' if info.get('gateway') else ''}
    <span style="color:{'#16a34a' if alive else '#dc2626'};font-weight:700;font-size:12px;margin-left:auto">
      {'✔ En ligne' if alive else '✘ Hors ligne'}
    </span>
  </div>
  {'<table style="margin:0"><thead><tr><th>Port</th><th>Service</th><th>Description</th><th>Risque</th></tr></thead><tbody>' + svcs_html + '</tbody></table>' if svcs_html else '<div style="color:#475569;font-size:12px;padding:4px 0">Aucun service identifié</div>'}
</div>"""

    html += """
<div style="margin-top:40px;padding-top:16px;border-top:1px solid #1e293b;
     font-size:11px;color:#334155;text-align:center">
  Rapport généré par NetCarto — Outil de cartographie réseau ICS/OT
</div>
</div>
</body>
</html>"""
    return html


def _host_severity(info):
    """Sévérité maximale d'un hôte parmi ses services."""
    max_sev = "INFO"
    for p in info.get("ports", []):
        if p in SERVICE_DB:
            s = SERVICE_DB[p][2]
            if SEV_ORDER.get(s, 9) < SEV_ORDER.get(max_sev, 9):
                max_sev = s
    return max_sev


# ── Routes Flask ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return HTML_PAGE


@app.route("/report")
def report():
    with state_lock:
        if not hosts:
            return "<h2 style='font-family:sans-serif;color:#dc2626;padding:40px'>Aucun scan disponible — lancez d'abord un scan.</h2>", 404
    return Response(generate_report_html(), content_type="text/html; charset=utf-8")


@app.route("/api/report.json")
def report_json():
    with state_lock:
        snap = {ip: dict(info) for ip, info in hosts.items()}
    payload = {
        "scan_date":    scan_start_time.isoformat() if scan_start_time else None,
        "generated_at": datetime.now().isoformat(),
        "subnets_direct": list(DIRECT_SUBNETS),
        "subnets_routed": SUBNET_TO_GW,
        "hosts": [
            {
                "ip":       ip,
                "type":     info.get("type"),
                "level":    info.get("level"),
                "subnet":   info.get("subnet"),
                "gateway":  info.get("gateway"),
                "ports":    info.get("ports", []),
                "alive":    info.get("alive", True),
                "severity": _host_severity(info),
                "services": [
                    {"port": p, "name": SERVICE_DB[p][0],
                     "severity": SERVICE_DB[p][2], "description": SERVICE_DB[p][3]}
                    for p in info.get("ports", []) if p in SERVICE_DB
                ],
            }
            for ip, info in sorted(snap.items(),
                key=lambda x: (x[1].get("level",0), x[0]))
        ]
    }
    return Response(json.dumps(payload, ensure_ascii=False, indent=2),
                    content_type="application/json; charset=utf-8")


@sio.on("start_scan")
def on_scan():
    if not is_scanning:
        threading.Thread(target=run_full_scan, daemon=True).start()


@sio.on("connect")
def on_connect():
    with state_lock:
        snap  = dict(hosts)
        esnap = set(edges_set)
    for ip, info in snap.items():
        emit("node_update", node_payload(ip, info, action="add"))
    for pair in esnap:
        lst = list(pair)
        emit("edge_add", {"from": lst[0], "to": lst[1]})
    emit("stats_update", {"hosts": len(snap)})
    if snap:
        emit("scan_done", {"total": len(snap)})

# ── Interface HTML ────────────────────────────────────────────────────────────

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>NetCarto — Cartographie Réseau</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.6.1/socket.io.min.js"></script>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0f172a;color:#e2e8f0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
#app{display:grid;grid-template-rows:52px 1fr;
     grid-template-columns:270px 1fr 260px;height:100vh}

/* Topbar */
#topbar{grid-column:1/4;background:#1e293b;border-bottom:1px solid #334155;
  display:flex;align-items:center;padding:0 16px;gap:10px}
.logo{font-size:15px;font-weight:800;color:#f1f5f9;white-space:nowrap}
.logo span{font-size:10px;color:#64748b;display:block;font-weight:400}
.statbar{display:flex;gap:5px;margin-left:8px}
.sbox{background:#0f172a;border-radius:6px;padding:4px 10px;text-align:center;min-width:72px}
.sbox .n{font-size:18px;font-weight:800}
.sbox .l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
#btn{margin-left:auto;background:#2563eb;color:#fff;border:none;border-radius:8px;
  padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}
#btn:hover{background:#1d4ed8}
#btn:disabled{background:#334155;color:#64748b;cursor:not-allowed}
#btn.scanning{background:#7c3aed;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Panel gauche — journal */
#left{background:#1e293b;border-right:1px solid #334155;display:flex;flex-direction:column;overflow:hidden}
.ptitle{padding:9px 14px;font-size:10px;font-weight:700;color:#64748b;
  text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #334155;flex-shrink:0}
#log{flex:1;overflow-y:auto;padding:4px;font-family:monospace;font-size:11px;line-height:1.55}
.le{padding:1px 5px;border-radius:2px;word-break:break-all}
.lt{color:#a78bfa;font-weight:700}.li{color:#475569}.lok{color:#16a34a}
.lw{color:#d97706}.lcritical{color:#dc2626;font-weight:700}.lerror{color:#ef4444}
#legend{padding:10px 14px;border-top:1px solid #334155;display:none;flex-shrink:0}
#legend h4{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px}
.lr{display:flex;align-items:center;gap:7px;font-size:11px;color:#94a3b8;margin:4px 0}
.ls{width:11px;height:11px;flex-shrink:0;border-radius:2px}
.ls.ci{border-radius:50%}.ls.di{transform:rotate(45deg)}

/* Graphe */
#gwrap{position:relative}
#net{width:100%;height:100%}
#overlay{position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;pointer-events:none;gap:6px}
#overlay.hidden{display:none}
.ov-i{font-size:38px;opacity:.12}
.ov-t{font-size:13px;color:#334155}
.ov-s{font-size:11px;color:#1e293b}

/* Panel droit — détails */
#right{background:#1e293b;border-left:1px solid #334155;overflow-y:auto}
#dw{padding:14px}
.de{color:#475569;font-size:12px;text-align:center;margin-top:40px;line-height:2}
#dc{display:none}
.dip{font-size:17px;font-weight:800;color:#f1f5f9;margin-bottom:2px;font-family:monospace}
.dmeta{font-size:11px;color:#64748b;margin-bottom:8px}
.dsev{display:inline-block;padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700;margin-bottom:10px}
.svc{background:#0f172a;border-radius:5px;padding:7px 10px;margin:3px 0}
.sp{font-family:monospace;font-size:12px;color:#38bdf8;font-weight:700}
.sn{font-size:12px;color:#e2e8f0;margin-top:1px}
.sd{font-size:11px;color:#64748b;margin-top:2px}
.ss{font-size:10px;font-weight:600;margin-top:2px}
.dstat{font-size:12px;margin-top:10px}
.on{color:#22c55e}.off{color:#ef4444;animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.1}}

#log::-webkit-scrollbar,#right::-webkit-scrollbar{width:3px}
#log::-webkit-scrollbar-thumb,#right::-webkit-scrollbar-thumb{background:#334155}
</style>
</head>
<body>
<div id="app">

<div id="topbar">
  <div class="logo">NetCarto <span>Cartographie Réseau — Temps Réel</span></div>
  <div class="statbar">
    <div class="sbox"><div class="n" id="sh" style="color:#38bdf8">0</div><div class="l">Équipements</div></div>
    <div class="sbox"><div class="n" id="sc" style="color:#dc2626">0</div><div class="l">Critiques</div></div>
    <div class="sbox"><div class="n" id="sd" style="color:#f97316">0</div><div class="l">Hors ligne</div></div>
  </div>
  <button id="btn" onclick="startScan()">▶ Lancer le scan</button>
  <a id="rptbtn" href="/report" target="_blank" style="display:none;background:#16a34a;color:#fff;
    border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;
    text-decoration:none;white-space:nowrap">📄 Rapport</a>
</div>

<div id="left">
  <div class="ptitle">Journal de découverte</div>
  <div id="log"></div>
  <div id="legend">
    <h4>Légende</h4>
    <div class="lr"><div class="ls" style="background:#dc2626"></div> PLC / Automate (ports ICS)</div>
    <div class="lr"><div class="ls ci" style="background:#ea580c"></div> SCADA / HMI (FUXA, OPC-UA…)</div>
    <div class="lr"><div class="ls di" style="background:#7c3aed"></div> Routeur / Passerelle</div>
    <div class="lr"><div class="ls ci" style="background:#2563eb"></div> Serveur</div>
    <div class="lr"><div class="ls ci" style="background:#4b5563"></div> Hôte inconnu (aucun port détecté)</div>
    <div style="border-top:1px solid #1e293b;margin:8px 0;padding-top:6px;font-size:10px;color:#475569">
      Niveaux hiérarchiques déduits de la table de routage
    </div>
  </div>
</div>

<div id="gwrap" style="height:calc(100vh - 52px);position:relative">
  <div id="net"></div>
  <div id="overlay">
    <div class="ov-i">🔍</div>
    <div class="ov-t">Aucun équipement découvert</div>
    <div class="ov-s">Cliquez sur "Lancer le scan"</div>
  </div>
</div>

<div id="right">
  <div class="ptitle">Détails du nœud</div>
  <div id="dw">
    <div class="de">Cliquez sur un nœud<br>pour afficher ses détails</div>
    <div id="dc"></div>
  </div>
</div>

</div>

<script>
const socket = io();
const SC = {"CRITIQUE":"#dc2626","ÉLEVÉ":"#ea580c","MOYEN":"#ca8a04","INFO":"#3b82f6"};

// ─────────────────────────────────────────────────────────────────────────────
//  LAYOUT DYNAMIQUE
//  Principe : chaque nœud reçoit un niveau (level) déduit de la table de
//  routage. Le niveau détermine sa position Y. La position X est calculée
//  en répartissant les nœuds de même niveau par groupe de sous-réseau.
//  Aucune position n'est codée en dur — tout est calculé depuis les données.
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_H    = 240;   // hauteur en pixels entre deux niveaux
const NODE_GAP   = 170;   // espacement horizontal entre nœuds d'un même subnet
const SUBNET_GAP = 80;    // marge supplémentaire entre groupes de subnets

// Tables de suivi — remplies dynamiquement
const nodeData    = {};   // id → payload complet reçu du serveur
const levelIndex  = {};   // level → [id, ...]          (ordre d'arrivée)
const subnetNodes = {};   // subnet → [id, ...]
let   edgeSeq     = 0;
const blinkSet    = new Set();

// vis-network — layout manuel (physics off, pas de hiérarchie forcée)
const nodes   = new vis.DataSet();
const edges   = new vis.DataSet();
const netEl   = document.getElementById("net");
const network = new vis.Network(netEl, {nodes, edges}, {
  physics:     {enabled: false},
  interaction: {hover: true, tooltipDelay: 80, hideEdgesOnDrag: true, navigationButtons: false},
  edges: {
    color:  {color: "#334155", highlight: "#60a5fa", hover: "#64748b"},
    width:  2,
    smooth: {type: "curvedCW", roundness: 0.15},
    arrows: {to: {enabled: false}},
  },
  nodes: {borderWidth: 2},
});

// ── Calcul des positions ───────────────────────────────────────────────────────
function recomputePositions() {
  // Pour chaque niveau, répartir les nœuds groupés par subnet
  const levels = Object.keys(levelIndex).map(Number).sort((a,b)=>a-b);

  levels.forEach(level => {
    const ids = levelIndex[level];
    if (!ids || !ids.length) return;

    const y = level * LEVEL_H;

    // Grouper les nœuds de ce niveau par subnet
    const subnetOrder = [];
    const subnetGroups = {};
    ids.forEach(id => {
      const d = nodeData[id];
      if (!d) return;
      const sn = d.subnet || "__direct__";
      if (!subnetGroups[sn]) { subnetGroups[sn] = []; subnetOrder.push(sn); }
      if (!subnetGroups[sn].includes(id)) subnetGroups[sn].push(id);
    });

    // Calculer la largeur totale de ce niveau
    const groupWidths = subnetOrder.map(sn => {
      const n = subnetGroups[sn].length;
      return Math.max((n - 1) * NODE_GAP, 0);
    });
    const totalW = groupWidths.reduce((a,b) => a+b, 0)
                 + Math.max(subnetOrder.length - 1, 0) * SUBNET_GAP;

    // Distribuer les groupes et les nœuds
    let curX = -totalW / 2;
    subnetOrder.forEach((sn, gi) => {
      const ids_sn = subnetGroups[sn];
      const gw = groupWidths[gi];
      const startX = curX;

      ids_sn.forEach((id, ni) => {
        const x = ids_sn.length === 1 ? startX : startX + ni * NODE_GAP;
        nodes.update({id, x, y});
      });

      curX += gw + SUBNET_GAP;
    });
  });

  network.redraw();
}

// ── Bandes de zone (dessinées en temps réel sur le canvas) ────────────────────
// Couleurs par niveau — dynamiques, pas spécifiques à un réseau
const LEVEL_COLORS = [
  {fill: "rgba(37,99,235,0.07)",  stroke: "rgba(37,99,235,0.25)",  lc: "rgba(37,99,235,0.7)"},  // 0 bleu
  {fill: "rgba(124,58,237,0.06)", stroke: "rgba(124,58,237,0.22)", lc: "rgba(124,58,237,0.65)"},  // 1 violet
  {fill: "rgba(220,38,38,0.07)",  stroke: "rgba(220,38,38,0.25)",  lc: "rgba(220,38,38,0.7)"},   // 2 rouge
  {fill: "rgba(5,150,105,0.07)",  stroke: "rgba(5,150,105,0.25)",  lc: "rgba(5,150,105,0.7)"},   // 3 vert
  {fill: "rgba(234,88,12,0.07)",  stroke: "rgba(234,88,12,0.25)",  lc: "rgba(234,88,12,0.7)"},   // 4 orange
];

function getLevelLabel(level) {
  if (level === 0) return "Niveau 0 — Réseau direct";
  if (level === 1) return "Niveau 1 — Passerelles / Routeurs";
  return `Niveau ${level} — Réseau distant (${level - 1} saut${level > 2 ? "s" : ""})`;
}

network.on("beforeDrawing", ctx => {
  const levels = Object.keys(levelIndex).map(Number).sort((a,b)=>a-b);
  if (!levels.length) return;

  const BAND_PAD  = 95;   // demi-hauteur de la bande autour du centre Y du niveau
  const BAND_W    = 2200; // largeur totale de la bande (suffisamment large)
  const BAND_X    = -BAND_W / 2;

  levels.forEach(level => {
    const ids = levelIndex[level] || [];
    if (!ids.length) return;

    const y     = level * LEVEL_H;
    const bandY = y - BAND_PAD;
    const bandH = BAND_PAD * 2;
    const col   = LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];

    // Subnets présents à ce niveau
    const subnets = [...new Set(ids.map(id => nodeData[id]?.subnet).filter(Boolean))];
    const label   = getLevelLabel(level) + (subnets.length ? " — " + subnets.join(" · ") : "");

    ctx.save();
    ctx.fillStyle   = col.fill;
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(BAND_X, bandY, BAND_W, bandH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.font      = "bold 11px -apple-system,BlinkMacSystemFont,sans-serif";
    ctx.fillStyle = col.lc;
    ctx.fillText(label, BAND_X + 16, bandY + 17);
    ctx.restore();

    // Séparateurs verticaux entre groupes de subnets au sein d'un même niveau
    if (subnets.length > 1) {
      // Trouver la frontière entre les groupes
      // (simplification : ligne verticale à x=0 entre groupes gauche/droite)
      const ids2 = levelIndex[level] || [];
      const positions = {};
      ids2.forEach(id => { const p = network.getPositions([id])[id]; if(p) positions[id]=p; });

      subnets.forEach((sn, si) => {
        if (si === 0) return;
        const snIds = ids2.filter(id => nodeData[id]?.subnet === sn);
        if (!snIds.length) return;
        const ps = snIds.map(id => positions[id]).filter(Boolean);
        if (!ps.length) return;
        const minX = Math.min(...ps.map(p=>p.x)) - SUBNET_GAP/2;
        ctx.save();
        ctx.strokeStyle = col.stroke;
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(minX, bandY + 20);
        ctx.lineTo(minX, bandY + bandH - 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });
    }
  });
});

// ── Blink nœuds hors ligne ────────────────────────────────────────────────────
let blinkOn = false;
setInterval(() => {
  blinkOn = !blinkOn;
  blinkSet.forEach(ip => nodes.update({
    id: ip,
    color: {background: blinkOn ? "#dc2626" : "#1a0000", border: "#dc2626",
            highlight: {background: blinkOn ? "#dc2626" : "#1a0000", border: "#dc2626"}}
  }));
}, 700);

// ── Tooltip ───────────────────────────────────────────────────────────────────
function makeTooltip(d) {
  const div = document.createElement("div");
  div.style.cssText = "background:#1e293b;border:1px solid #334155;border-radius:10px;"+
    "padding:11px 13px;font-size:12px;max-width:240px;color:#e2e8f0;"+
    "pointer-events:none;box-shadow:0 4px 16px #0008";
  div.innerHTML =
    `<div style="font-size:14px;font-weight:800;color:#38bdf8;font-family:monospace">${d.id}</div>`+
    `<div style="font-size:10px;color:#64748b;margin-bottom:8px">`+
      `${d.type.toUpperCase()} · niv.${d.level} · ${d.subnet}</div>`+
    (d.services||[]).map(s =>
      `<div style="background:#0f172a;border-radius:4px;padding:4px 8px;margin:2px 0">`+
        `<span style="font-family:monospace;color:#38bdf8;font-weight:700">${s.port}/tcp</span>`+
        `<span style="color:#e2e8f0;margin-left:6px">${s.name}</span>`+
        `<div style="color:${SC[s.sev]||"#6b7280"};font-size:10px;font-weight:600">⚠ ${s.sev}</div>`+
      `</div>`
    ).join("")+
    (!d.services?.length ? `<div style="color:#475569;font-size:11px">Aucun service détecté</div>` : "");
  return div;
}

// ── Réception des nœuds ───────────────────────────────────────────────────────
socket.on("node_update", d => {
  const isNew = !nodeData[d.id];
  nodeData[d.id] = d;

  // Enregistrement dans les tables de suivi
  const level  = d.level ?? 0;
  const subnet = d.subnet || "__direct__";

  if (!levelIndex[level]) levelIndex[level] = [];
  if (!levelIndex[level].includes(d.id)) levelIndex[level].push(d.id);

  if (!subnetNodes[subnet]) subnetNodes[subnet] = [];
  if (!subnetNodes[subnet].includes(d.id)) subnetNodes[subnet].push(d.id);

  // Position initiale provisoire au centre du niveau (sera mise à jour par recomputePositions)
  const y = level * LEVEL_H;

  const vn = {
    id:    d.id,
    label: d.label || d.id,
    shape: d.shape,
    size:  d.size || 22,
    color: d.color,
    font:  {color: "white", size: 11, face: "-apple-system,sans-serif"},
    title: makeTooltip(d),
    x:     0,
    y,
  };

  if (isNew) nodes.add(vn);
  else       nodes.update({...vn, x: undefined, y: undefined});  // garder la position si mise à jour

  // Recalcul des positions pour tous les nœuds du niveau concerné
  recomputePositions();

  if (!d.alive) blinkSet.add(d.id); else blinkSet.delete(d.id);

  if (isNew) {
    document.getElementById("overlay").classList.add("hidden");
  }

  // Mise à jour des stats
  const all = Object.values(nodeData);
  document.getElementById("sh").textContent = all.length;
  document.getElementById("sc").textContent = all.filter(n => n.severity === "CRITIQUE").length;
  document.getElementById("sd").textContent = all.filter(n => !n.alive).length;
});

// ── Arêtes ────────────────────────────────────────────────────────────────────
socket.on("edge_add", d => {
  const dup = edges.get().some(e =>
    (e.from === d.from && e.to === d.to) || (e.from === d.to && e.to === d.from));
  if (!dup) edges.add({id: ++edgeSeq, from: d.from, to: d.to});
});

// ── Journal ───────────────────────────────────────────────────────────────────
socket.on("log", d => {
  const el  = document.getElementById("log");
  const div = document.createElement("div");
  div.className   = "le l" + (d.level || "i");
  div.textContent = d.msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
});

socket.on("scan_started", () => {
  const b = document.getElementById("btn");
  b.disabled = true; b.textContent = "⟳ Scan en cours…"; b.classList.add("scanning");
});

socket.on("scan_done", () => {
  const b = document.getElementById("btn");
  b.disabled = false; b.textContent = "↻ Relancer"; b.classList.remove("scanning");
  document.getElementById("legend").style.display = "block";
  setTimeout(() => network.fit({animation: {duration: 700, easingFunction: "easeInOutQuad"}}), 300);
});

socket.on("report_ready", () => {
  const r = document.getElementById("rptbtn");
  r.style.display = "inline-block";
  r.style.animation = "pulse 1s 3";
});

socket.on("stats_update", d => {
  document.getElementById("sh").textContent = d.hosts;
});

// ── Clic sur un nœud → panneau détail ─────────────────────────────────────────
network.on("click", p => {
  if (!p.nodes.length) return;
  const d = nodeData[p.nodes[0]];
  if (!d) return;

  const col = SC[d.severity] || "#6b7280";
  const svcs = (d.services || []).map(s =>
    `<div class="svc">
      <div class="sp">${s.port}/tcp</div>
      <div class="sn">${s.name}</div>
      <div class="sd">${s.desc || ""}</div>
      <div class="ss" style="color:${SC[s.sev]||"#6b7280"}">⚠ ${s.sev}</div>
    </div>`
  ).join("");

  document.querySelector(".de").style.display = "none";
  const card = document.getElementById("dc");
  card.style.display = "block";
  card.innerHTML = `
    <div class="dip">${d.id}</div>
    <div class="dmeta">${d.type.toUpperCase()} · Niveau ${d.level} · ${d.subnet}</div>
    ${d.gateway ? `<div class="dmeta">Via ${d.gateway}</div>` : ""}
    <span class="dsev" style="background:${col}22;color:${col};border:1px solid ${col}">⚠ ${d.severity}</span>
    <div class="ptitle" style="margin:10px -14px 6px;padding:6px 14px">Services détectés</div>
    ${svcs || '<div style="color:#475569;font-size:12px;padding:6px 0">Aucun service identifié par nmap</div>'}
    <div class="dstat" style="margin-top:10px">
      ${d.alive
        ? '<span class="on">● En ligne</span>'
        : '<span class="off">● HORS LIGNE</span>'}
    </div>`;
});

window.addEventListener("resize", () => {
  network.setSize("100%", "100%");
  network.redraw();
});

function startScan() { socket.emit("start_scan"); }
</script>
</body>
</html>"""

if __name__ == "__main__":
    load_routing_table()
    threading.Thread(target=monitor_loop, daemon=True).start()
    try:
        import socket as _s
        _x = _s.socket(_s.AF_INET, _s.SOCK_DGRAM)
        _x.connect(("8.8.8.8", 80))
        local_ip = _x.getsockname()[0]
        _x.close()
    except Exception:
        local_ip = "0.0.0.0"
    print(f"\n{'='*50}")
    print(f"  NetCarto — Cartographie Réseau")
    print(f"  http://{local_ip}:5000")
    print(f"{'='*50}\n")
    sio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
