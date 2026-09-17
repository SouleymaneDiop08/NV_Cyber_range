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

Usage : python3 netcarto.py  →  http://0.0.0.0:5090
"""

import os, sys, subprocess

AUTO_INSTALL_DEPS = os.environ.get("NETCARTO_AUTO_INSTALL_DEPS", "0").lower() in {"1", "true", "yes", "on"}
IGNORE_DOCKER_GATEWAY_DOT1 = os.environ.get("NETCARTO_IGNORE_DOCKER_GATEWAY_DOT1", "1").lower() in {"1", "true", "yes", "on"}

for mod, pkg in {"flask": "flask", "flask_socketio": "flask-socketio", "nmap": "python-nmap"}.items():
    try:
        __import__(mod)
    except ImportError:
        if not AUTO_INSTALL_DEPS:
            raise RuntimeError(f"Dépendance manquante: {mod}. Installez {pkg} ou activez NETCARTO_AUTO_INSTALL_DEPS=1.")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg, "--break-system-packages"], check=True)

from flask import Flask, Response
from flask_socketio import SocketIO, emit
import threading, time, ipaddress, json
from datetime import datetime
import nmap as nmap_lib

app = Flask(__name__)
app.config["SECRET_KEY"] = "netcarto"
sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

hosts      = {}
edges_set  = set()
state_lock = threading.Lock()
is_scanning    = False
scan_start_time = None
scan_end_time   = None

SUBNET_TO_GW   = {}
GATEWAY_IPS    = set()
DIRECT_SUBNETS = []

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
    "plc":     {"bg": "#ef4444", "border": "#dc2626", "size": 30},
    "scada":   {"bg": "#f97316", "border": "#ea580c", "size": 28},
    "router":  {"bg": "#8b5cf6", "border": "#7c3aed", "size": 32},
    "server":  {"bg": "#3b82f6", "border": "#2563eb", "size": 24},
    "unknown": {"bg": "#64748b", "border": "#475569", "size": 18},
}


def load_routing_table():
    global SUBNET_TO_GW, GATEWAY_IPS, DIRECT_SUBNETS
    SUBNET_TO_GW.clear(); GATEWAY_IPS.clear(); DIRECT_SUBNETS.clear()
    try:
        out = subprocess.run(["ip", "route"], capture_output=True, text=True).stdout
        for line in out.splitlines():
            parts = line.split()
            if not parts or parts[0] == "default": continue
            try:
                net = ipaddress.IPv4Network(parts[0], strict=False)
                net_str = str(net)
                if "via" in parts:
                    gw = parts[parts.index("via") + 1]
                    SUBNET_TO_GW[net_str] = gw; GATEWAY_IPS.add(gw)
                else:
                    DIRECT_SUBNETS.append(net_str)
            except Exception: pass
    except FileNotFoundError: pass
    if not DIRECT_SUBNETS and not SUBNET_TO_GW:
        try:
            out = subprocess.run(["netstat", "-rn"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) < 3 or not parts[0][0:1].isdigit(): continue
                dest, gw, mask = parts[0], parts[1], parts[2]
                if dest == "0.0.0.0": continue
                try:
                    net = str(ipaddress.IPv4Network(f"{dest}/{mask}", strict=False))
                    if gw == "0.0.0.0": DIRECT_SUBNETS.append(net)
                    else: SUBNET_TO_GW[net] = gw; GATEWAY_IPS.add(gw)
                except Exception: pass
        except Exception: pass


def get_all_subnets():
    seen, result = set(), []
    def add(n):
        if n not in seen and "169.254" not in n and "127." not in n:
            seen.add(n); result.append(n)
    for s in DIRECT_SUBNETS: add(s)
    for s in SUBNET_TO_GW: add(s)
    if not result:
        try:
            out = subprocess.run(["ifconfig"], capture_output=True, text=True).stdout
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("inet ") and "127." not in line:
                    parts = line.split()
                    try: add(str(ipaddress.IPv4Interface(f"{parts[1]}/{parts[3]}").network))
                    except Exception: pass
        except Exception: pass
    return result


def get_level(ip, subnet):
    if subnet in DIRECT_SUBNETS:
        return 1 if ip in GATEWAY_IPS else 0
    if ip in GATEWAY_IPS: return 1
    gw = SUBNET_TO_GW.get(subnet)
    if gw:
        for gw_subnet in SUBNET_TO_GW:
            if ipaddress.ip_address(gw) in ipaddress.ip_network(gw_subnet, strict=False):
                return 3
        return 2
    return 0


def detect_type(ip, ports):
    if ip in GATEWAY_IPS: return "router"
    for p in ports:
        if p in ("502","102","44818","20000","1962","789"): return "plc"
        if p in ("1881","1882","1883","1884","4840"): return "scada"
    return "server" if ports else "unknown"


def build_label(ip, ports):
    if ip in GATEWAY_IPS:
        routed = [s for s, g in SUBNET_TO_GW.items() if g == ip]
        return ip + ("\nRouteur → " + " | ".join(routed) if routed else "\nPasserelle")
    for p in ports:
        if p in SERVICE_DB:
            return ip + "\n" + SERVICE_DB[p][0]
    return ip


def node_payload(ip, info, action="update"):
    t = info.get("type", "unknown")
    st = NODE_STYLE.get(t, NODE_STYLE["unknown"])
    alive = info.get("alive", True)
    max_sev = "INFO"
    for p in info.get("ports", []):
        if p in SERVICE_DB:
            s = SERVICE_DB[p][2]
            if SEV_ORDER.get(s, 9) < SEV_ORDER.get(max_sev, 9): max_sev = s
    services = [{"port": p, "name": SERVICE_DB[p][0], "sev": SERVICE_DB[p][2], "desc": SERVICE_DB[p][3]}
                for p in info.get("ports", []) if p in SERVICE_DB]
    return {
        "action": action, "id": ip, "label": info.get("label", ip),
        "type": t, "size": st["size"], "subnet": info.get("subnet", ""),
        "gateway": info.get("gateway", ""), "level": info.get("level", 0),
        "alive": alive, "severity": max_sev, "services": services,
        "bg": st["bg"], "border": st["border"],
    }


def maybe_add_edge(a, b):
    key = frozenset({a, b})
    with state_lock:
        if key in edges_set: return
        edges_set.add(key)
    sio.emit("edge_add", {"from": a, "to": b})


def connect_node(ip, info):
    subnet, level, gateway = info["subnet"], info.get("level", 0), info.get("gateway", "")
    with state_lock: snap = dict(hosts)
    if level == 0:
        for peer, pinfo in snap.items():
            if peer != ip and pinfo.get("level") == 1:
                if pinfo.get("subnet") == subnet or pinfo.get("gateway") == "":
                    maybe_add_edge(ip, peer)
    elif level == 1:
        for peer, pinfo in snap.items():
            if peer == ip: continue
            if pinfo.get("level") == 0: maybe_add_edge(ip, peer)
            if pinfo.get("gateway") == ip: maybe_add_edge(ip, peer)
    elif level >= 2:
        if gateway and gateway in snap: maybe_add_edge(ip, gateway)
        else:
            for peer, pinfo in snap.items():
                if peer != ip and pinfo.get("level") == 1:
                    if pinfo.get("id") == gateway:
                        maybe_add_edge(ip, peer); break


SCAN_PORTS = ("21,22,23,80,102,443,445,502,789,1881,1882,1883,1884,"
              "1962,3306,3389,4840,5432,5443,5900,6080,6081,8080,8086,8888,20000,44818")


def is_bridge_gateway(ip):
    last = ip.split(".")[-1]
    ignored = {"0", "255"}
    if IGNORE_DOCKER_GATEWAY_DOT1: ignored.add("1")
    return last in ignored


def scan_subnet(subnet):
    sio.emit("log", {"msg": f"Scan {subnet}…", "level": "info"})
    nm = nmap_lib.PortScanner()
    try:
        net = ipaddress.IPv4Network(subnet, strict=False)
        excluded = [str(ip) for ip in net.hosts() if is_bridge_gateway(str(ip))]
        exclude_arg = f" --exclude {','.join(excluded)}" if excluded else ""
        nm.scan(hosts=subnet, ports=SCAN_PORTS, arguments=f"-sT --open -T4 --host-timeout 60s{exclude_arg}")
    except Exception as e:
        sio.emit("log", {"msg": f"Erreur {subnet}: {e}", "level": "error"}); return
    for host in nm.all_hosts():
        if nm[host].state() != "up": continue
        if is_bridge_gateway(host):
            sio.emit("log", {"msg": f"Ignoré : {host} (réseau/bridge)", "level": "muted"}); continue
        ports_open = []
        try:
            for proto in nm[host].all_protocols():
                for port in sorted(nm[host][proto].keys()):
                    if nm[host][proto][port]["state"] == "open":
                        ports_open.append(str(port))
        except Exception: pass
        t = detect_type(host, ports_open)
        level = get_level(host, subnet)
        gateway = SUBNET_TO_GW.get(subnet, "")
        label = build_label(host, ports_open)
        with state_lock:
            hosts[host] = {"label": label, "type": t, "ports": ports_open, "alive": True,
                           "subnet": subnet, "gateway": gateway, "level": level}
        log_lvl = "critical" if t == "plc" else "warn" if t in ("scada","router") else "ok"
        sio.emit("node_update", node_payload(host, hosts[host], action="add"))
        sio.emit("log", {"msg": f"{host}  [{t.upper()}]  niv.{level}  {len(ports_open)} port(s)", "level": log_lvl})
        sio.emit("stats_update", {"hosts": len(hosts)})
        connect_node(host, hosts[host])
        time.sleep(0.05)
    sio.emit("log", {"msg": f"{subnet} — terminé", "level": "done"})


def run_full_scan():
    global is_scanning, scan_start_time, scan_end_time
    is_scanning = True; scan_start_time = datetime.now()
    load_routing_table()
    sio.emit("scan_started", {})
    sio.emit("log", {"msg": "Démarrage du scan réseau", "level": "title"})
    subnets = get_all_subnets()
    if not subnets:
        sio.emit("log", {"msg": "Aucun réseau détecté", "level": "error"})
        is_scanning = False; sio.emit("scan_done", {"total": 0}); return
    sio.emit("log", {"msg": f"Cibles : {' · '.join(subnets)}", "level": "info"})
    for subnet in subnets: scan_subnet(subnet)
    is_scanning = False; scan_end_time = datetime.now()
    total = len(hosts)
    sio.emit("scan_done", {"total": total})
    sio.emit("log", {"msg": f"{total} équipement(s) découvert(s)", "level": "title"})
    sio.emit("report_ready", {})


def monitor_loop():
    while True:
        time.sleep(20)
        with state_lock: ips = list(hosts.keys())
        for ip in ips:
            alive = subprocess.run(["ping","-c","1","-W","1",ip], capture_output=True).returncode == 0
            with state_lock:
                if ip not in hosts: continue
                prev = hosts[ip].get("alive", True)
                hosts[ip]["alive"] = alive
                info = hosts[ip].copy()
            if prev != alive:
                sio.emit("node_update", node_payload(ip, info, action="update"))
                sio.emit("log", {"msg": f"{'↑' if alive else '↓'} {ip} → {'en ligne' if alive else 'HORS LIGNE'}",
                                 "level": "ok" if alive else "error"})


def _host_severity(info):
    max_sev = "INFO"
    for p in info.get("ports", []):
        if p in SERVICE_DB:
            s = SERVICE_DB[p][2]
            if SEV_ORDER.get(s, 9) < SEV_ORDER.get(max_sev, 9): max_sev = s
    return max_sev


def _recommendations(snap):
    ports_found = {p for info in snap.values() for p in info.get("ports", [])}
    RECO_DB = {
        "502":   ("CRITIQUE","Modbus TCP exposé sans authentification","Isoler les automates sur VLAN dédié. Déployer un pare-feu bloquant Modbus depuis les réseaux non-ICS."),
        "102":   ("CRITIQUE","Siemens S7 exposé (port 102)","Restreindre le port 102 aux stations d'ingénierie via ACL ou pare-feu."),
        "44818": ("ÉLEVÉ","EtherNet/IP exposé","Segmenter le réseau OT avec VLAN. Restreindre CIP aux équipements légitimes."),
        "20000": ("CRITIQUE","DNP3 sans authentification","Activer DNP3 Secure Authentication v5. Isoler sur segment dédié."),
        "23":    ("CRITIQUE","Telnet détecté","Remplacer par SSH immédiatement. Bloquer port 23 au firewall."),
        "21":    ("CRITIQUE","FTP non chiffré","Remplacer par SFTP ou FTPS. Restreindre à un réseau de gestion isolé."),
        "5900":  ("ÉLEVÉ","VNC sans TLS","Chiffrer via SSH ou VPN. Restreindre aux IPs de management."),
        "3389":  ("ÉLEVÉ","RDP exposé","Restreindre au réseau de management. Activer NLA."),
        "445":   ("ÉLEVÉ","SMB exposé","Désactiver SMBv1. Restreindre aux échanges strictement nécessaires."),
        "1883":  ("ÉLEVÉ","MQTT non authentifié","Activer authentification + TLS. Restreindre aux clients légitimes."),
        "4840":  ("ÉLEVÉ","OPC-UA détecté","Vérifier niveau SignAndEncrypt. Restreindre aux clients autorisés."),
        "8086":  ("ÉLEVÉ","InfluxDB exposé","Activer authentification. Restreindre accès aux serveurs de supervision."),
        "6080":  ("MOYEN","noVNC accessible","Protéger par mot de passe fort. Préférer un VPN."),
        "8080":  ("ÉLEVÉ","Interface web non standard","Vérifier authentification. Restreindre aux administrateurs."),
    }
    PRIO = {"CRITIQUE":0,"ÉLEVÉ":1,"MOYEN":2,"INFO":3}
    found = [(PRIO.get(sev,9), sev, titre, detail)
             for port,(sev,titre,detail) in RECO_DB.items() if port in ports_found]
    found.sort(key=lambda x: x[0])
    return [(sev,titre,detail) for _,sev,titre,detail in found]


def generate_report_html():
    with state_lock:
        snap = {ip: dict(info) for ip,info in hosts.items()}
        subnets_direct = list(DIRECT_SUBNETS)
        subnets_routed = dict(SUBNET_TO_GW)
    now = datetime.now()
    scan_date = scan_start_time.strftime("%d/%m/%Y %H:%M:%S") if scan_start_time else "—"
    duration = ""
    if scan_start_time and scan_end_time:
        m, s = divmod(int((scan_end_time - scan_start_time).total_seconds()), 60)
        duration = f"{m}m {s}s"
    SC = {"CRITIQUE":"#ef4444","ÉLEVÉ":"#f97316","MOYEN":"#eab308","INFO":"#3b82f6"}
    TL = {"plc":"PLC / Automate","scada":"SCADA / HMI","router":"Routeur","server":"Serveur","unknown":"Inconnu"}
    total = len(snap); critiques = sum(1 for i in snap.values() if _host_severity(i)=="CRITIQUE")
    eleves = sum(1 for i in snap.values() if _host_severity(i)=="ÉLEVÉ")
    moyens = sum(1 for i in snap.values() if _host_severity(i)=="MOYEN")
    hors_ligne = sum(1 for i in snap.values() if not i.get("alive",True))
    score = min(100, critiques*30 + eleves*10 + moyens*3)
    sc = "#ef4444" if score>=60 else "#f97316" if score>=30 else "#eab308" if score>=10 else "#22c55e"
    sl = "CRITIQUE" if score>=60 else "ÉLEVÉ" if score>=30 else "MOYEN" if score>=10 else "BAS"
    recs = _recommendations(snap)
    sorted_hosts = sorted(snap.items(), key=lambda x:(x[1].get("level",0),[int(o) for o in x[0].split(".")]))
    def badge(sev):
        c=SC.get(sev,"#6b7280")
        return f'<span style="background:{c}18;color:{c};border:1px solid {c}35;border-radius:5px;padding:2px 9px;font-size:11px;font-weight:700">{sev}</span>'
    rows_inv = "".join(f"""<tr>
      <td style="font-family:monospace;font-weight:700;color:#f1f5f9">{ip}</td>
      <td style="color:#94a3b8">{TL.get(i.get('type','unknown'),i.get('type',''))}</td>
      <td style="color:#64748b">Niv.{i.get('level',0)}</td>
      <td style="font-family:monospace;font-size:11px;color:#475569">{i.get('subnet','—')}</td>
      <td style="font-family:monospace;font-size:11px">{', '.join(i.get('ports',[])[:5]) or '—'}</td>
      <td style="font-size:11px;color:#94a3b8">{', '.join([SERVICE_DB[p][0] for p in i.get('ports',[]) if p in SERVICE_DB][:2]) or '—'}</td>
      <td>{badge(_host_severity(i))}</td>
      <td style="color:{'#22c55e' if i.get('alive',True) else '#ef4444'};font-size:12px;font-weight:600">{'● En ligne' if i.get('alive',True) else '● Hors ligne'}</td>
    </tr>""" for ip,i in sorted_hosts)
    rows_risk = "".join(f"<tr><td>{badge(sev)}</td><td style='font-family:monospace;font-weight:700;color:#f1f5f9'>{ip}</td><td style='font-family:monospace;color:#38bdf8'>{port}/tcp</td><td style='font-weight:600'>{name}</td><td style='font-size:11px;color:#64748b'>{desc}</td></tr>"
        for sev,ip,port,name,desc,*_ in sorted(
            [(sev,ip,p,SERVICE_DB[p][0],"",i.get("type"),i.get("subnet")) for ip,i in sorted_hosts for p in i.get("ports",[]) if p in SERVICE_DB and SERVICE_DB[p][2] in ("CRITIQUE","ÉLEVÉ")],
            key=lambda x: SEV_ORDER.get(x[0],9)))
    recs_html = "".join(f'''<div style="display:flex;gap:14px;padding:14px 18px;margin:8px 0;border-left:3px solid {SC.get(sev,'#6b7280')};background:{SC.get(sev,'#6b7280')}0a;border-radius:0 10px 10px 0">
      <div style="flex-shrink:0;width:26px;height:26px;background:{SC.get(sev,'#6b7280')}20;border-radius:50%;display:flex;align-items:center;justify-content:center;color:{SC.get(sev,'#6b7280')};font-weight:900;font-size:12px">{idx}</div>
      <div><div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">{badge(sev)}<span style="font-weight:700;color:#f1f5f9">{titre}</span></div>
      <div style="font-size:13px;color:#94a3b8;line-height:1.7">{detail}</div></div></div>'''
        for idx,(sev,titre,detail) in enumerate(recs,1)) or '<div style="color:#22c55e;padding:14px;background:#22c55e10;border-radius:8px">✔ Aucun service à haut risque détecté.</div>'
    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetCarto — Rapport</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>*{{box-sizing:border-box;margin:0;padding:0}}body{{background:#07111f;color:#cbd5e1;font-family:'Inter',sans-serif;line-height:1.6}}
.wrap{{max-width:1120px;margin:0 auto;padding:0 24px 48px}}
.topbar{{background:#0c1a2e;border-bottom:1px solid rgba(99,130,165,.15);padding:20px 24px;margin-bottom:0;position:sticky;top:0;z-index:10}}
h2{{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:32px 0 14px;display:flex;align-items:center;gap:8px}}
h2::after{{content:'';flex:1;height:1px;background:rgba(71,85,105,.3)}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{background:#112240;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.07em;padding:9px 14px;text-align:left}}
td{{padding:9px 14px;border-bottom:1px solid rgba(15,23,42,.6);vertical-align:middle}}
tr:hover td{{background:rgba(255,255,255,.025)}}
.kgrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin:14px 0}}
.kbox{{background:#0c1a2e;border:1px solid rgba(99,130,165,.15);border-radius:10px;padding:14px;text-align:center}}
.kbox .n{{font-size:26px;font-weight:900;font-family:'JetBrains Mono',monospace;display:block;line-height:1}}
.kbox .l{{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-top:3px}}
.card{{background:#0c1a2e;border:1px solid rgba(99,130,165,.12);border-radius:12px;padding:18px;margin:8px 0;overflow-x:auto}}
@media print{{body{{background:#fff;color:#000}}.topbar{{background:#f8fafc;position:relative}}.no-print{{display:none}}.card{{border-color:#e2e8f0;background:#f8fafc}}th{{background:#f1f5f9}}}}
</style></head><body>
<div class="topbar"><div style="max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
  <div><div style="font-size:22px;font-weight:900;color:#f1f5f9;letter-spacing:-.02em">NetCarto — Rapport</div>
  <div style="font-size:12px;color:#475569;margin-top:2px">Scan du {scan_date}{f' · Durée : {duration}' if duration else ''} · Généré le {now.strftime('%d/%m/%Y %H:%M:%S')}</div></div>
  <div class="no-print" style="display:flex;gap:8px">
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer">Imprimer / PDF</button>
    <a href="/" style="background:#1e293b;color:#e2e8f0;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;text-decoration:none">← Retour</a>
  </div>
</div></div>
<div class="wrap">
<h2>Score de risque</h2>
<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:8px">
  <div style="width:80px;height:80px;border-radius:50%;border:3px solid {sc};display:flex;align-items:center;justify-content:center;flex-direction:column;box-shadow:0 0 20px {sc}30">
    <span style="font-size:22px;font-weight:900;color:{sc}">{score}</span>
    <span style="font-size:9px;color:#64748b;text-transform:uppercase">/100</span>
  </div>
  <div><div style="font-size:20px;font-weight:900;color:{sc}">{sl}</div>
  <div style="font-size:12px;color:#64748b;margin-top:4px">{total} équip. · {critiques} critique(s) · {eleves} élevé(s) · {hors_ligne} hors ligne</div></div>
</div>
<div class="kgrid">
  <div class="kbox"><span class="n" style="color:#38bdf8">{total}</span><span class="l">Équipements</span></div>
  <div class="kbox"><span class="n" style="color:#ef4444">{critiques}</span><span class="l">Critique</span></div>
  <div class="kbox"><span class="n" style="color:#f97316">{eleves}</span><span class="l">Élevé</span></div>
  <div class="kbox"><span class="n" style="color:#eab308">{moyens}</span><span class="l">Moyen</span></div>
  <div class="kbox"><span class="n" style="color:#ef4444">{hors_ligne}</span><span class="l">Hors ligne</span></div>
  <div class="kbox"><span class="n" style="color:#64748b">{len(subnets_direct)+len(subnets_routed)}</span><span class="l">Sous-réseaux</span></div>
</div>
<h2>Inventaire</h2>
<div class="card"><table><thead><tr><th>IP</th><th>Type</th><th>Niveau</th><th>Subnet</th><th>Ports</th><th>Services</th><th>Risque</th><th>État</th></tr></thead>
<tbody>{rows_inv or '<tr><td colspan="8" style="color:#475569">Aucun équipement</td></tr>'}</tbody></table></div>
<h2>Services à risque</h2>
<div class="card"><table><thead><tr><th>Sévérité</th><th>IP</th><th>Port</th><th>Service</th><th>Description</th></tr></thead>
<tbody>{rows_risk or '<tr><td colspan="5" style="color:#22c55e">✔ Aucun service à haut risque</td></tr>'}</tbody></table></div>
<h2>Recommandations</h2>{recs_html}
<div style="margin-top:40px;border-top:1px solid rgba(71,85,105,.2);padding-top:14px;font-size:11px;color:#334155;text-align:center">Rapport NetCarto — Cartographie réseau ICS/OT</div>
</div></body></html>"""


@app.route("/")
def index(): return HTML_PAGE

@app.route("/report")
def report():
    with state_lock:
        if not hosts: return "<h2 style='font-family:sans-serif;color:#dc2626;padding:40px'>Aucun scan — lancez d'abord un scan.</h2>", 404
    return Response(generate_report_html(), content_type="text/html; charset=utf-8")

@app.route("/api/report.json")
def report_json():
    with state_lock: snap = {ip: dict(info) for ip,info in hosts.items()}
    return Response(json.dumps({
        "scan_date": scan_start_time.isoformat() if scan_start_time else None,
        "generated_at": datetime.now().isoformat(),
        "subnets_direct": list(DIRECT_SUBNETS), "subnets_routed": SUBNET_TO_GW,
        "hosts": [{"ip":ip,"type":info.get("type"),"level":info.get("level"),"subnet":info.get("subnet"),
                   "gateway":info.get("gateway"),"ports":info.get("ports",[]),"alive":info.get("alive",True),
                   "severity":_host_severity(info),"services":[{"port":p,"name":SERVICE_DB[p][0],"severity":SERVICE_DB[p][2],"description":SERVICE_DB[p][3]} for p in info.get("ports",[]) if p in SERVICE_DB]}
                  for ip,info in sorted(snap.items(),key=lambda x:(x[1].get("level",0),x[0]))]
    }, ensure_ascii=False, indent=2), content_type="application/json; charset=utf-8")

@app.route("/api/start_scan", methods=["POST", "GET"])
def start_scan_api():
    if not is_scanning:
        threading.Thread(target=run_full_scan, daemon=True).start()
    return Response(json.dumps({"started": True, "already_running": is_scanning}, ensure_ascii=False),
                    content_type="application/json; charset=utf-8")

@sio.on("start_scan")
def on_scan():
    if not is_scanning: threading.Thread(target=run_full_scan, daemon=True).start()

@sio.on("connect")
def on_connect():
    with state_lock: snap = dict(hosts); esnap = set(edges_set)
    for ip,info in snap.items(): emit("node_update", node_payload(ip, info, action="add"))
    for pair in esnap:
        lst = list(pair); emit("edge_add", {"from": lst[0], "to": lst[1]})
    emit("stats_update", {"hosts": len(snap)})
    if snap: emit("scan_done", {"total": len(snap)})


# ═══════════════════════════════════════════════════════════════════════════════
#  HTML_PAGE — Interface principale
# ═══════════════════════════════════════════════════════════════════════════════

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetCarto — Cartographie Réseau</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.6.1/socket.io.min.js"></script>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
/* ─── Reset ─────────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; }

/* ─── Theme tokens ───────────────────────────────────────────────────────────── */
:root {
  --bg:        #07111f;
  --bg2:       #0c1a2e;
  --bg3:       #112240;
  --border:    rgba(99,130,165,0.14);
  --border2:   rgba(99,130,165,0.28);
  --text:      #ccd6f6;
  --muted:     #64748b;
  --dim:       #334155;
  --accent:    #3b82f6;
  --radius:    10px;
  --tr:        0.2s cubic-bezier(.4,0,.2,1);
  --shadow:    0 8px 32px rgba(0,0,0,0.45);
}
[data-theme="light"] {
  --bg:        #f0f4f9;
  --bg2:       #ffffff;
  --bg3:       #f1f5f9;
  --border:    rgba(15,23,42,0.09);
  --border2:   rgba(15,23,42,0.18);
  --text:      #0f172a;
  --muted:     #64748b;
  --dim:       #94a3b8;
  --accent:    #2563eb;
  --shadow:    0 8px 32px rgba(15,23,42,0.12);
}

/* ─── Layout ─────────────────────────────────────────────────────────────────── */
body {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex; flex-direction: column; height: 100vh;
}

/* ─── Top bar ────────────────────────────────────────────────────────────────── */
#topbar {
  height: 54px; min-height: 54px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 14px; gap: 10px;
  position: relative; z-index: 200;
  box-shadow: 0 1px 0 var(--border);
}

.brand { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
.brand-logo {
  width: 30px; height: 30px;
  background: linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(59,130,246,0.4);
}
.brand-name { font-size: 15px; font-weight: 800; letter-spacing: -.03em; color: var(--text); }
.brand-sub  { font-size: 10px; color: var(--muted); font-weight: 400; white-space: nowrap; }

/* Stat counters */
.stats { display: flex; gap: 4px; margin-left: 6px; }
.stat {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 20px;
  background: var(--bg3); border: 1px solid var(--border);
  cursor: default;
}
.stat-n { font-size: 15px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
.stat-l { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

/* Divider */
.tb-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; flex-shrink: 0; }

/* Scan progress */
#scan-bar {
  position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
  overflow: hidden; display: none;
}
#scan-bar.on { display: block; }
#scan-bar::after {
  content: ''; position: absolute; top: 0; left: -45%; width: 45%; height: 100%;
  background: linear-gradient(90deg, transparent, #3b82f6, #8b5cf6, transparent);
  animation: scanAnim 1.5s ease-in-out infinite;
}
@keyframes scanAnim { to { left: 145%; } }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: var(--radius);
  font-size: 12px; font-weight: 600; cursor: pointer;
  border: none; transition: all var(--tr); white-space: nowrap;
  text-decoration: none; font-family: inherit;
}
.btn-blue {
  background: var(--accent); color: #fff;
  box-shadow: 0 2px 8px rgba(59,130,246,0.35);
}
.btn-blue:hover { filter: brightness(1.1); transform: translateY(-1px); }
.btn-blue:disabled { background: var(--bg3); color: var(--muted); box-shadow: none; transform: none; filter: none; cursor: not-allowed; }
.btn-blue.scanning { background: linear-gradient(135deg,#7c3aed,#8b5cf6); animation: btnPulse 1.4s ease infinite; }
@keyframes btnPulse { 0%,100%{opacity:1} 50%{opacity:.65} }
.btn-green { background: #16a34a; color: #fff; box-shadow: 0 2px 8px rgba(22,163,74,0.3); }
.btn-green:hover { filter: brightness(1.1); transform: translateY(-1px); }
.btn-ghost { background: var(--bg3); color: var(--text); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--border2); background: var(--bg2); }
.icon-btn {
  width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg3); border: 1px solid var(--border);
  font-size: 14px; color: var(--muted); transition: all var(--tr);
  flex-shrink: 0;
}
.icon-btn:hover { border-color: var(--border2); color: var(--text); }

/* ─── Main workspace ──────────────────────────────────────────────────────────── */
#workspace { flex: 1; display: flex; overflow: hidden; min-height: 0; position: relative; }

/* ─── Left sidebar ────────────────────────────────────────────────────────────── */
#sidebar {
  width: 268px; min-width: 268px;
  background: var(--bg2);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  transition: width var(--tr), min-width var(--tr), transform var(--tr);
  overflow: hidden; flex-shrink: 0; position: relative; z-index: 10;
}
#sidebar.collapsed { width: 0; min-width: 0; }

#sidebar-inner { width: 268px; display: flex; flex-direction: column; height: 100%; }

/* Sidebar section header */
.sec-hdr {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 14px 8px; flex-shrink: 0;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .08em; color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.sec-hdr svg { opacity: .7; }

/* Collapse tab */
#sidebar-tab {
  position: absolute; right: -14px; top: 50%;
  transform: translateY(-50%); z-index: 20;
  width: 14px; height: 44px;
  background: var(--bg2); border: 1px solid var(--border);
  border-left: none; border-radius: 0 6px 6px 0;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 9px; transition: all var(--tr);
}
#sidebar-tab:hover { color: var(--text); background: var(--bg3); }
#sidebar.collapsed #sidebar-tab { border-left: 1px solid var(--border); border-radius: 6px; }
#sidebar-tab .arr { transition: transform var(--tr); }
#sidebar.collapsed #sidebar-tab .arr { transform: rotate(180deg); }

/* Log */
#log-scroll { flex: 1; overflow-y: auto; padding: 4px 2px; min-height: 0; }
.le {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 2px 10px; border-radius: 4px; cursor: default;
  font-family: 'JetBrains Mono', monospace; font-size: 10.5px; line-height: 1.55;
}
.le:hover { background: rgba(255,255,255,0.04); }
.le-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.le-msg { word-break: break-all; }
.le.title  .le-dot { background: #a78bfa; } .le.title  .le-msg { color: #a78bfa; font-weight: 700; }
.le.info   .le-dot { background: var(--dim); } .le.info   .le-msg { color: var(--muted); }
.le.muted  .le-dot { background: var(--dim); opacity: .4; } .le.muted  .le-msg { color: var(--dim); }
.le.ok     .le-dot { background: #4ade80; } .le.ok     .le-msg { color: #4ade80; }
.le.done   .le-dot { background: #22c55e; box-shadow: 0 0 5px #22c55e60; } .le.done .le-msg { color: #22c55e; font-weight: 600; }
.le.warn   .le-dot { background: #fb923c; } .le.warn   .le-msg { color: #fb923c; }
.le.critical .le-dot { background: #ef4444; box-shadow: 0 0 5px #ef444450; } .le.critical .le-msg { color: #ef4444; font-weight: 700; }
.le.error  .le-dot { background: #ef4444; } .le.error  .le-msg { color: #f87171; }

/* Legend */
#legend {
  border-top: 1px solid var(--border);
  padding: 10px 14px 12px; flex-shrink: 0;
}
.leg-t { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin-bottom: 7px; }
.leg-r { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); margin: 3px 0; }
.leg-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.sev-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.sev-tag { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 4px; }

/* ─── Graph canvas ────────────────────────────────────────────────────────────── */
#graph-wrap { flex: 1; position: relative; overflow: hidden; min-width: 0; }
#net { position: absolute; inset: 0; width: 100%; height: 100%; }

/* Empty state */
#empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  pointer-events: none;
}
#empty.hidden { display: none; }
.em-ring {
  width: 80px; height: 80px; border-radius: 50%;
  border: 2px dashed var(--border2);
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; opacity: .35;
}
.em-t { font-size: 14px; font-weight: 700; color: var(--muted); }
.em-s { font-size: 12px; color: var(--dim); }

/* ─── Floating detail panel ──────────────────────────────────────────────────── */
#detail {
  position: absolute; top: 12px; right: 12px; bottom: 12px;
  width: 296px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  z-index: 100;
  display: flex; flex-direction: column;
  transform: translateX(320px);
  transition: transform var(--tr);
  overflow: hidden;
}
#detail.open { transform: translateX(0); }

#detail-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
#detail-hdr-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
#detail-close {
  width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg3); border: 1px solid var(--border);
  font-size: 12px; color: var(--muted); transition: all var(--tr);
}
#detail-close:hover { color: var(--text); border-color: var(--border2); }

#detail-body { flex: 1; overflow-y: auto; padding: 14px; }

/* Node card */
.nd-type {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 11px; border-radius: 20px;
  font-size: 11px; font-weight: 600; margin-bottom: 8px;
}
.nd-ip {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px; font-weight: 700; color: var(--text);
  margin-bottom: 3px; word-break: break-all; letter-spacing: -.01em;
}
.nd-meta { font-size: 11px; color: var(--muted); margin-bottom: 10px; line-height: 1.6; }
.nd-sev { display: inline-block; padding: 3px 10px; border-radius: 5px; font-size: 11px; font-weight: 700; margin-bottom: 12px; }
.nd-sec { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 10px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.svc {
  background: var(--bg3); border: 1px solid var(--border);
  border-radius: 8px; padding: 9px 11px; margin: 5px 0;
  transition: border-color var(--tr);
}
.svc:hover { border-color: var(--border2); }
.svc-port { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: #38bdf8; }
.svc-name { font-size: 12px; font-weight: 600; color: var(--text); margin-top: 2px; }
.svc-desc { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.4; }
.svc-sev  { font-size: 10px; font-weight: 700; margin-top: 4px; }
.nd-alive {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; padding: 5px 11px;
  border-radius: 20px; margin-top: 10px;
}
.nd-alive.on  { background: #22c55e18; color: #4ade80; }
.nd-alive.off { background: #ef444418; color: #f87171; animation: offBlink 1.1s ease infinite; }
@keyframes offBlink { 0%,100%{opacity:1} 50%{opacity:.3} }

/* ─── Scrollbars ─────────────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-thumb { background: var(--dim); border-radius: 2px; }
::-webkit-scrollbar-track { background: transparent; }

/* ─── vis-network tooltip override ───────────────────────────────────────────── */
div.vis-tooltip {
  background: var(--bg2) !important; border: 1px solid var(--border2) !important;
  border-radius: 10px !important; padding: 0 !important;
  color: var(--text) !important; font-family: 'Inter', sans-serif !important;
  box-shadow: var(--shadow) !important; max-width: 270px !important;
}

/* ══════════════════════════════════════════════════════════════════
   SURCOUCHE PREMIUM — habillage visuel (n'affecte que le style)
   ══════════════════════════════════════════════════════════════════ */
:root{
  --accent:#38bdf8; --accent2:#8b5cf6;
  --glow:0 0 0 1px rgba(56,189,248,.18), 0 10px 40px -12px rgba(56,189,248,.35);
  --glass:rgba(12,26,46,.62);
}
:root[data-theme="light"]{ --glass:rgba(255,255,255,.7); }

body{
  background:
    radial-gradient(1100px 620px at 82% -12%, rgba(56,189,248,.10), transparent 60%),
    radial-gradient(900px 560px at 6% 112%, rgba(139,92,246,.12), transparent 60%),
    linear-gradient(180deg,#07111f,#050d18) !important;
}

/* ── Barre supérieure : verre + liseré lumineux ── */
#topbar{
  background:linear-gradient(180deg, var(--glass), rgba(7,17,31,.35)) !important;
  backdrop-filter:blur(16px) saturate(1.2); -webkit-backdrop-filter:blur(16px) saturate(1.2);
  border-bottom:1px solid transparent !important;
  box-shadow:0 1px 0 rgba(56,189,248,.14), 0 10px 30px -18px rgba(0,0,0,.8);
}
#topbar::after{
  content:""; position:absolute; left:0; right:0; bottom:0; height:1px;
  background:linear-gradient(90deg, transparent, rgba(56,189,248,.5), rgba(139,92,246,.4), transparent);
  opacity:.7; pointer-events:none;
}

/* ── Logo en pastille dégradée ── */
.brand-logo{
  background:linear-gradient(135deg,#22d3ee,#3b82f6 45%,#8b5cf6) !important;
  border-radius:11px !important; color:#fff !important;
  box-shadow:0 6px 18px -6px rgba(56,189,248,.7), inset 0 1px 0 rgba(255,255,255,.35);
  display:flex; align-items:center; justify-content:center;
  font-size:0 !important;
  position:relative;
}
.brand-logo::after{
  content:""; width:15px; height:15px;
  background:
    radial-gradient(circle at 50% 22%, #fff 2.4px, transparent 3px),
    radial-gradient(circle at 20% 82%, #fff 2.4px, transparent 3px),
    radial-gradient(circle at 80% 82%, #fff 2.4px, transparent 3px);
}
.brand-name{
  background:linear-gradient(90deg,#eaf6ff,#a9c8ff); -webkit-background-clip:text;
  background-clip:text; -webkit-text-fill-color:transparent; letter-spacing:-.02em !important;
}

/* ── Compteurs en cartes verre avec accent latéral ── */
.stats{ gap:8px !important; margin-left:14px !important; }
.stat{
  position:relative; padding:7px 13px 7px 15px !important;
  background:var(--glass) !important; border:1px solid var(--border) !important;
  border-radius:11px !important; backdrop-filter:blur(8px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04); transition:var(--tr);
  overflow:hidden;
}
.stat::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:3px; }
.stat:nth-child(1)::before{ background:#38bdf8; box-shadow:0 0 12px #38bdf8aa; }
.stat:nth-child(2)::before{ background:#ef4444; box-shadow:0 0 12px #ef4444aa; }
.stat:nth-child(3)::before{ background:#f97316; box-shadow:0 0 12px #f97316aa; }
.stat:hover{ border-color:var(--border2) !important; transform:translateY(-1px); }
.stat-n{ font-size:17px !important; }

/* ── Bouton scan : dégradé, glow, halo animé ── */
.btn{ border-radius:11px !important; transition:var(--tr) !important; }
.btn-blue{
  background:linear-gradient(135deg,#22d3ee,#3b82f6 55%,#6366f1) !important;
  box-shadow:0 8px 24px -8px rgba(56,189,248,.65), inset 0 1px 0 rgba(255,255,255,.25) !important;
  font-weight:700 !important; letter-spacing:.01em;
}
.btn-blue:hover{ transform:translateY(-1px); box-shadow:0 12px 30px -8px rgba(56,189,248,.8), inset 0 1px 0 rgba(255,255,255,.3) !important; }
.btn-green{ background:linear-gradient(135deg,#10b981,#059669) !important; border-radius:11px !important; }

/* ── Boutons icônes ── */
.icon-btn{
  border-radius:10px !important; border:1px solid var(--border) !important;
  background:var(--glass) !important; backdrop-filter:blur(8px); transition:var(--tr);
}
.icon-btn:hover{ border-color:rgba(56,189,248,.45) !important; color:#eaf6ff !important;
  box-shadow:0 0 0 1px rgba(56,189,248,.25), 0 6px 16px -8px rgba(56,189,248,.5); }
.tb-sep{ background:var(--border2) !important; }

/* ── Barre latérale : verre ── */
#sidebar, #sidebar-inner{ background:linear-gradient(180deg, rgba(12,26,46,.55), rgba(7,17,31,.35)) !important; }
#sidebar{ border-right:1px solid transparent !important; box-shadow:1px 0 0 rgba(56,189,248,.10); backdrop-filter:blur(14px); }
.sec-hdr{ color:#8fb4d8 !important; letter-spacing:.09em !important; }
.sec-hdr svg{ color:#38bdf8; opacity:.9 !important; }
#sidebar-tab{ border:1px solid var(--border) !important; background:var(--glass) !important; backdrop-filter:blur(8px); }

/* ── Légende ── */
.leg-t{ color:#8fb4d8 !important; letter-spacing:.08em; }
.leg-dot{ box-shadow:0 0 10px currentColor; }
.sev-tag{ border-radius:6px !important; backdrop-filter:blur(6px); }

/* ── Panneau détail : verre profond ── */
#detail{
  background:linear-gradient(180deg, rgba(12,26,46,.9), rgba(7,17,31,.92)) !important;
  backdrop-filter:blur(20px) saturate(1.2); -webkit-backdrop-filter:blur(20px) saturate(1.2);
  border-left:1px solid rgba(56,189,248,.18) !important;
  box-shadow:-24px 0 60px -30px rgba(0,0,0,.9) !important;
}
#detail-hdr{ background:linear-gradient(180deg, rgba(56,189,248,.08), transparent) !important;
  border-bottom:1px solid var(--border) !important; }
#detail-close{ border-radius:9px !important; transition:var(--tr); }
#detail-close:hover{ box-shadow:0 0 0 1px rgba(239,68,68,.4); color:#fca5a5 !important; }

/* ── État vide : anneau lumineux ── */
#empty .em-ring{
  box-shadow:0 0 0 1px rgba(56,189,248,.25), 0 0 40px -6px rgba(56,189,248,.4) !important;
  animation:emPulse 3s ease-in-out infinite;
}
@keyframes emPulse{ 0%,100%{ box-shadow:0 0 0 1px rgba(56,189,248,.22), 0 0 34px -8px rgba(56,189,248,.35);}
  50%{ box-shadow:0 0 0 1px rgba(56,189,248,.4), 0 0 52px -4px rgba(56,189,248,.6);} }

/* ── Barre de progression du scan ── */
#scan-bar{ background:linear-gradient(90deg,#22d3ee,#8b5cf6) !important; box-shadow:0 0 14px rgba(56,189,248,.6); }

/* ── Scrollbars fines ── */
#log-scroll::-webkit-scrollbar, #detail-body::-webkit-scrollbar{ width:8px; }
#log-scroll::-webkit-scrollbar-thumb, #detail-body::-webkit-scrollbar-thumb{
  background:rgba(56,189,248,.25); border-radius:5px; }
#log-scroll::-webkit-scrollbar-thumb:hover, #detail-body::-webkit-scrollbar-thumb:hover{
  background:rgba(56,189,248,.45); }

@media (prefers-reduced-motion:reduce){ #empty .em-ring{ animation:none; } }
</style>
</head>
<body>

<!-- ══ TOPBAR ══════════════════════════════════════════════════════════════════ -->
<nav id="topbar">
  <div class="brand">
    <div class="brand-logo">🔷</div>
    <div>
      <div class="brand-name">NetCarto</div>
      <div class="brand-sub">Cartographie réseau temps réel</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat"><span class="stat-n" id="sh" style="color:#38bdf8">0</span><span class="stat-l">Équip.</span></div>
    <div class="stat"><span class="stat-n" id="sc" style="color:#ef4444">0</span><span class="stat-l">Critique</span></div>
    <div class="stat"><span class="stat-n" id="sd" style="color:#f97316">0</span><span class="stat-l">Hors ligne</span></div>
  </div>

  <div style="margin-left:auto;display:flex;align-items:center;gap:7px">
    <button id="btn-scan" class="btn btn-blue" onclick="startScan()">▶ Lancer le scan</button>
    <a id="btn-report" href="/report" target="_blank" class="btn btn-green" style="display:none">📄 Rapport</a>
    <div class="tb-sep"></div>
    <div class="icon-btn" id="btn-fit"    onclick="fitView()"    title="Recadrer (F)">⊞</div>
    <div class="icon-btn" id="btn-theme"  onclick="toggleTheme()" title="Thème (T)">🌙</div>
  </div>

  <div id="scan-bar"></div>
</nav>

<!-- ══ WORKSPACE ════════════════════════════════════════════════════════════════ -->
<div id="workspace">

  <!-- LEFT SIDEBAR -->
  <aside id="sidebar">
    <div id="sidebar-tab" onclick="toggleSidebar()"><span class="arr">‹</span></div>
    <div id="sidebar-inner">

      <div class="sec-hdr">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="2" height="10" rx="1"/><rect x="5" y="4" width="2" height="7" rx="1"/><rect x="9" y="2" width="2" height="9" rx="1"/></svg>
        Journal de découverte
      </div>

      <div id="log-scroll"></div>

      <div id="legend" style="display:none">
        <div class="leg-t">Légende</div>
        <div class="leg-r"><div class="leg-dot" style="background:#ef4444"></div>PLC / Automate</div>
        <div class="leg-r"><div class="leg-dot" style="background:#f97316"></div>SCADA / HMI</div>
        <div class="leg-r"><div class="leg-dot" style="background:#8b5cf6"></div>Routeur / Passerelle</div>
        <div class="leg-r"><div class="leg-dot" style="background:#3b82f6"></div>Serveur</div>
        <div class="leg-r"><div class="leg-dot" style="background:#64748b"></div>Inconnu</div>
        <div class="sev-row">
          <span class="sev-tag" style="background:#ef444418;color:#ef4444;border:1px solid #ef444435">CRITIQUE</span>
          <span class="sev-tag" style="background:#f9731618;color:#f97316;border:1px solid #f9731635">ÉLEVÉ</span>
          <span class="sev-tag" style="background:#eab30818;color:#eab308;border:1px solid #eab30835">MOYEN</span>
          <span class="sev-tag" style="background:#3b82f618;color:#3b82f6;border:1px solid #3b82f635">INFO</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- GRAPH -->
  <div id="graph-wrap">
    <div id="net"></div>
    <div id="empty">
      <div class="em-ring">🔍</div>
      <div class="em-t">Aucun équipement</div>
      <div class="em-s">Cliquez sur « Lancer le scan »</div>
    </div>

    <!-- FLOATING DETAIL PANEL -->
    <div id="detail">
      <div id="detail-hdr">
        <span id="detail-hdr-title">Détails du nœud</span>
        <div id="detail-close" onclick="closeDetail()">✕</div>
      </div>
      <div id="detail-body"></div>
    </div>
  </div>

</div><!-- /workspace -->

<script>
"use strict";
// ─────────────────────────────────────────────────────────────────────────────
//  NetCarto Frontend v3
// ─────────────────────────────────────────────────────────────────────────────

const socket = io();

const SEV_COLOR = { "CRITIQUE":"#ef4444","ÉLEVÉ":"#f97316","MOYEN":"#eab308","INFO":"#3b82f6" };
const TYPE_COLOR = { plc:"#ef4444", scada:"#f97316", router:"#8b5cf6", server:"#3b82f6", unknown:"#64748b" };
const TYPE_LABEL = { plc:"PLC / Automate", scada:"SCADA / HMI", router:"Routeur / Passerelle", server:"Serveur", unknown:"Inconnu" };

// ─── State ────────────────────────────────────────────────────────────────────
const nodeData   = {};
const levelBuckets = {};  // level → [ip, ...]
const subnetMap  = {};    // subnet → [ip, ...]
let   edgeSeq    = 0;
const blinkSet   = new Set();
let   selectedId = null;
let   isDark     = true;

// Layout config
const LEVEL_Y    = 240;   // px between levels
const NODE_W     = 175;   // px between nodes in same subnet
const SUBNET_GAP = 85;    // px between subnet groups

// Level band styles
const BAND_COLORS = [
  { fill:"rgba(37,99,235,0.06)",   stroke:"rgba(37,99,235,0.22)",   text:"rgba(59,130,246,0.8)"  },
  { fill:"rgba(139,92,246,0.06)",  stroke:"rgba(139,92,246,0.22)",  text:"rgba(139,92,246,0.8)" },
  { fill:"rgba(239,68,68,0.07)",   stroke:"rgba(239,68,68,0.22)",   text:"rgba(239,68,68,0.8)"  },
  { fill:"rgba(5,150,105,0.06)",   stroke:"rgba(5,150,105,0.22)",   text:"rgba(16,185,129,0.8)" },
  { fill:"rgba(234,88,12,0.06)",   stroke:"rgba(234,88,12,0.22)",   text:"rgba(249,115,22,0.8)" },
];

// ─── vis-network ──────────────────────────────────────────────────────────────
const nodes   = new vis.DataSet();
const edges   = new vis.DataSet();
const netEl   = document.getElementById("net");

const network = new vis.Network(netEl, { nodes, edges }, {
  physics: { enabled: false },
  interaction: {
    hover: true,
    tooltipDelay: 80,
    hideEdgesOnDrag: false,
    navigationButtons: false,
    keyboard: false,
    zoomView: true,
    dragView: true,
  },
  edges: {
    color: { color:"rgba(130,150,180,0.20)", highlight:"rgba(200,220,250,0.85)", hover:"rgba(200,220,250,0.6)", inherit:false },
    width: 0.7,
    smooth: { enabled: true, type: "continuous", roundness: 0.35 },  // liens souples façon Obsidian
    arrows: { to: { enabled: false } },
    selectionWidth: 0.6,
    hoverWidth: 0.4,
  },
  nodes: {
    borderWidth: 1,
    borderWidthSelected: 2,
    font: { size: 10.5, color: "#9fb2c9", face: "'Inter',system-ui,sans-serif", vadjust: 9, strokeWidth: 0 },
    chosen: {
      node: (values) => { values.borderWidth = 2; values.borderColor = "#eaf2ff"; },
    },
  },
});

/* ─── Style Obsidian : petits nœuds dimensionnés par le nombre de
   connexions, et focus au survol (les voisins s'illuminent, le
   reste s'estompe). ─────────────────────────────────────────── */
const BASE_SIZE = { plc:9, scada:8, router:10, server:6, unknown:5 };
const degree = {};
function sizeFor(id, type) {
  return (BASE_SIZE[type] || 6) + Math.min(degree[id] || 0, 8) * 1.35;
}
function neighborsOf(id) {
  const s = new Set([id]);
  edges.get().forEach(e => { if (e.from===id) s.add(e.to); if (e.to===id) s.add(e.from); });
  return s;
}
let focusActive = false;
function applyFocus(id) {
  focusActive = true;
  const keep = neighborsOf(id);
  nodes.get().forEach(n => {
    const d = nodeData[n.id]; if (!d) return;
    d.__dim = !keep.has(n.id);
    const col = (d.alive === false) ? "#ef4444" : (TYPE_COLOR[d.type] || "#64748b");
    if (keep.has(n.id)) {
      nodes.update({ id:n.id, color:{ background:col, border: n.id===id ? "#eaf2ff" : col },
        font:{ color:"#dbe7f7", size:11, vadjust:9 }, opacity:1 });
    } else {
      nodes.update({ id:n.id, color:{ background:col+"22", border:col+"22" },
        font:{ color:"rgba(159,178,201,0.25)", size:10.5, vadjust:9 }, opacity:0.28 });
    }
  });
  edges.get().forEach(e => {
    const on = (e.from===id || e.to===id);
    edges.update({ id:e.id, color:{ color: on ? "rgba(200,220,250,0.85)" : "rgba(130,150,180,0.05)" },
      width: on ? 1.4 : 0.5 });
  });
}
function clearFocus() {
  if (!focusActive) return;
  focusActive = false;
  nodes.get().forEach(n => {
    const d = nodeData[n.id]; if (!d) return;
    d.__dim = false;
    const col = (d.alive === false) ? "#ef4444" : (TYPE_COLOR[d.type] || "#64748b");
    nodes.update({ id:n.id, opacity:1,
      color: (d.alive===false)
        ? { background:"#1a0000", border:"#ef4444", highlight:{background:"#7f1d1d",border:"#fca5a5"} }
        : { background:col, border:col+"bb", highlight:{background:col,border:"#ffffff"}, hover:{background:col,border:"#ffffff"} },
      font:{ color:"#9fb2c9", size:10.5, vadjust:9 } });
  });
  edges.get().forEach(e => edges.update({ id:e.id,
    color:{ color:"rgba(130,150,180,0.20)", highlight:"rgba(200,220,250,0.85)", hover:"rgba(200,220,250,0.6)" }, width:0.7 }));
}
network.on("hoverNode", p => applyFocus(p.node));
network.on("blurNode", () => clearFocus());

// ─── Position computation ─────────────────────────────────────────────────────
function recomputeLayout() {
  const levels = Object.keys(levelBuckets).map(Number).sort((a,b) => a - b);

  levels.forEach(lv => {
    const ids = levelBuckets[lv];
    if (!ids?.length) return;
    const y = lv * LEVEL_Y;

    // Group by subnet
    const order = [], groups = {};
    ids.forEach(id => {
      const sn = nodeData[id]?.subnet || "__";
      if (!groups[sn]) { groups[sn] = []; order.push(sn); }
      if (!groups[sn].includes(id)) groups[sn].push(id);
    });

    // Total width
    const groupW = order.map(sn => Math.max((groups[sn].length - 1) * NODE_W, 0));
    const totalW = groupW.reduce((a,b) => a+b, 0) + Math.max(order.length-1, 0)*SUBNET_GAP;

    let curX = -totalW / 2;
    order.forEach((sn, gi) => {
      const g = groups[sn];
      g.forEach((id, ni) => {
        const x = g.length === 1 ? curX : curX + ni * NODE_W;
        nodes.update({ id, x, y });
      });
      curX += groupW[gi] + SUBNET_GAP;
    });
  });
  network.redraw();
}

// ─── Level bands ──────────────────────────────────────────────────────────────
const BAND_H = 100;
const BAND_W = 3000;
const BAND_X = -BAND_W / 2;

function bandLabel(lv) {
  const subnets = [...new Set((levelBuckets[lv]||[]).map(id => nodeData[id]?.subnet).filter(Boolean))];
  const base = lv === 0 ? "Niveau 0 — Réseau direct"
             : lv === 1 ? "Niveau 1 — Passerelles / Routeurs"
             : `Niveau ${lv} — Réseaux distants (${lv-1} saut${lv>2?"s":""})`;
  return base + (subnets.length ? "   ·   " + subnets.join("   ·   ") : "");
}

network.on("beforeDrawing", ctx => {
  const levels = Object.keys(levelBuckets).map(Number).sort((a,b)=>a-b);
  if (!levels.length) return;

  // Dot grid background
  ctx.save();
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.035)" : "rgba(15,23,42,0.05)";
  const step = 36;
  const yMin = levels[0]*LEVEL_Y - 300, yMax = levels[levels.length-1]*LEVEL_Y + 300;
  for (let gx = -1500; gx <= 1500; gx += step)
    for (let gy = yMin; gy <= yMax; gy += step) {
      ctx.beginPath(); ctx.arc(gx, gy, 1, 0, 6.283); ctx.fill();
    }
  ctx.restore();

  // Bands
  levels.forEach(lv => {
    if (!(levelBuckets[lv]?.length)) return;
    const col = BAND_COLORS[Math.min(lv, BAND_COLORS.length-1)];
    const y   = lv * LEVEL_Y;

    ctx.save();
    ctx.fillStyle   = col.fill;
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(BAND_X, y - BAND_H, BAND_W, BAND_H*2, 10);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle    = col.text;
    ctx.font         = "600 11px 'Inter',system-ui,sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(bandLabel(lv), BAND_X + 20, y - BAND_H + 10);
    ctx.restore();

    // Subnet dividers within a level
    const snMap = {};
    (levelBuckets[lv]||[]).forEach(id => {
      const sn = nodeData[id]?.subnet || "__";
      if (!snMap[sn]) snMap[sn] = [];
      snMap[sn].push(id);
    });
    const sns = Object.keys(snMap);
    if (sns.length < 2) return;
    const pos = network.getPositions();
    sns.slice(1).forEach(sn => {
      const minX = Math.min(...snMap[sn].map(id => pos[id]?.x ?? 0)) - SUBNET_GAP/2;
      ctx.save();
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(minX, y - BAND_H + 20);
      ctx.lineTo(minX, y + BAND_H - 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });
  });
});

// ─── Node icon drawing ────────────────────────────────────────────────────────
// Pure canvas primitives — no font dependency

function drawIcon(ctx, type, x, y, r) {
  const s = r * 0.42;
  ctx.save();
  ctx.fillStyle   = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth   = r * 0.08;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  switch (type) {
    case "plc": {
      // Microchip: square body + pins
      const hw = s * 0.72;
      ctx.strokeRect(x - hw, y - hw, hw*2, hw*2);
      ctx.fillRect(x - hw*0.45, y - hw*0.45, hw*0.9, hw*0.9);
      const pinO = [-0.55, 0, 0.55].map(t => t*hw*1.18);
      pinO.forEach(py => {
        ctx.beginPath(); ctx.moveTo(x - hw, y + py); ctx.lineTo(x - hw - s*0.38, y + py); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + hw, y + py); ctx.lineTo(x + hw + s*0.38, y + py); ctx.stroke();
      });
      break;
    }
    case "scada": {
      // Monitor frame + chart line + stand
      ctx.strokeRect(x - s, y - s*0.62, s*2, s*1.24);
      // chart
      ctx.beginPath();
      const pts = [[-0.72,0.1],[-0.36,-0.24],[0,0.06],[0.35,-0.28],[0.72,0.06]];
      pts.forEach(([dx,dy],i) => {
        if (i===0) ctx.moveTo(x+dx*s, y+dy*s);
        else       ctx.lineTo(x+dx*s, y+dy*s);
      });
      ctx.stroke();
      // stand
      ctx.beginPath(); ctx.moveTo(x, y+s*0.62); ctx.lineTo(x, y+s*0.92); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x-s*0.45, y+s*0.92); ctx.lineTo(x+s*0.45, y+s*0.92); ctx.stroke();
      break;
    }
    case "router": {
      // Hub: center dot + 4 spokes + endpoint dots
      ctx.beginPath(); ctx.arc(x, y, s*0.28, 0, 6.283); ctx.fill();
      const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
      dirs.forEach(([dx,dy]) => {
        const ex = x+dx*s*0.88, ey = y+dy*s*0.88;
        ctx.beginPath(); ctx.moveTo(x+dx*s*0.28, y+dy*s*0.28); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, s*0.2, 0, 6.283); ctx.fill();
      });
      break;
    }
    case "server": {
      // Server rack: 3 horizontal bars
      const bh = s*0.26, bw = s*1.7, gap = s*0.1;
      [-1,0,1].forEach((i,idx) => {
        const by = y + i*(bh+gap);
        ctx.beginPath();
        ctx.roundRect(x-bw/2, by-bh/2, bw, bh, 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x+bw/2-s*0.22, by, s*0.11, 0, 6.283);
        ctx.fillStyle = idx===1 ? "#22c55e" : "rgba(255,255,255,0.6)";
        ctx.fill();
        ctx.fillStyle = ctx.strokeStyle = "rgba(255,255,255,0.92)";
      });
      break;
    }
    default: {
      ctx.font         = `bold ${Math.round(r*0.62)}px 'Inter',system-ui,sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x, y + r*0.05);
    }
  }
  ctx.restore();
}

// Draw icons + glow rings after vis renders nodes
network.on("afterDrawing", ctx => {
  const pos = network.getPositions();
  const sc  = network.getScale();

  Object.entries(pos).forEach(([id, {x,y}]) => {
    const d = nodeData[id];
    if (!d) return;
    if (focusActive && d.__dim) return;   // ne rien surligner sur les nœuds estompés
    const r = sizeFor(id, d.type) * sc;   // vraie taille du nœud à l'écran

    // Anneau lumineux pour CRITIQUE / hors ligne
    if (d.severity === "CRITIQUE" || !d.alive) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r + 4*sc, 0, 6.283);
      ctx.strokeStyle = d.alive === false ? "#ef444470" : "#ef444450";
      ctx.lineWidth   = 1.5 * sc;
      ctx.stroke();
      ctx.restore();
    }

    // Icône seulement quand le nœud est assez grand à l'écran :
    // dézoomé, on garde des points purs façon Obsidian.
    if (r >= 11) drawIcon(ctx, d.type, x, y, r);
  });
});

// ─── Offline blink ────────────────────────────────────────────────────────────
let blinkOn = true;
setInterval(() => {
  blinkOn = !blinkOn;
  blinkSet.forEach(id => {
    const d = nodeData[id];
    if (!d) return;
    nodes.update({ id, color: {
      background: blinkOn ? "#7f1d1d" : "#1a0000",
      border: "#ef4444",
      highlight: { background: "#7f1d1d", border: "#fca5a5" },
    }});
  });
}, 750);

// ─── Tooltip (DOM element — no raw HTML in title) ─────────────────────────────
function makeTooltip(d) {
  const col    = TYPE_COLOR[d.type] || "#64748b";
  const sev    = d.severity || "INFO";
  const sevCol = SEV_COLOR[sev] || "#6b7280";
  const wrap   = document.createElement("div");
  wrap.style.cssText = "padding:12px 14px;font-family:'Inter',system-ui,sans-serif;min-width:180px;";

  // IP header
  const hdr = document.createElement("div");
  hdr.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:7px";
  hdr.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${col};
    box-shadow:0 0 6px ${col}80;display:inline-block;flex-shrink:0"></span>
    <span style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#f1f5f9">${d.id}</span>`;
  wrap.appendChild(hdr);

  // Meta
  const meta = document.createElement("div");
  meta.style.cssText = "font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px";
  meta.textContent = `${(TYPE_LABEL[d.type]||'').toUpperCase()} · NIV.${d.level} · ${d.subnet}`;
  wrap.appendChild(meta);

  // Severity
  const sevEl = document.createElement("span");
  sevEl.style.cssText = `display:inline-block;background:${sevCol}20;color:${sevCol};border:1px solid ${sevCol}40;
    border-radius:4px;padding:1px 8px;font-size:10px;font-weight:700;margin-bottom:8px`;
  sevEl.textContent = sev;
  wrap.appendChild(sevEl);
  if (!d.alive) {
    const off = document.createElement("span");
    off.style.cssText = "color:#ef4444;font-size:10px;font-weight:700;margin-left:8px";
    off.textContent = "● HORS LIGNE";
    wrap.appendChild(off);
  }

  // Services
  const svcs = (d.services || []).slice(0, 5);
  if (svcs.length) {
    const divider = document.createElement("div");
    divider.style.cssText = "height:1px;background:rgba(71,85,105,0.3);margin:7px 0";
    wrap.appendChild(divider);
    svcs.forEach(s => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0";
      const sc2 = SEV_COLOR[s.sev] || "#6b7280";
      row.innerHTML = `<code style="font-family:'JetBrains Mono',monospace;color:#38bdf8;font-size:11px;min-width:60px">${s.port}/tcp</code>
        <span style="font-size:12px;color:#cbd5e1">${s.name}</span>
        <span style="font-size:10px;font-weight:700;color:${sc2};margin-left:auto">${s.sev}</span>`;
      wrap.appendChild(row);
    });
  } else {
    const noSvc = document.createElement("div");
    noSvc.style.cssText = "font-size:11px;color:#475569;margin-top:4px";
    noSvc.textContent = "Aucun service détecté";
    wrap.appendChild(noSvc);
  }
  return wrap;
}

// ─── Node update ──────────────────────────────────────────────────────────────
socket.on("node_update", d => {
  const isNew = !nodeData[d.id];
  nodeData[d.id] = d;

  const lv = d.level ?? 0;
  const sn = d.subnet || "__";
  if (!levelBuckets[lv]) levelBuckets[lv] = [];
  if (!levelBuckets[lv].includes(d.id)) levelBuckets[lv].push(d.id);
  if (!subnetMap[sn]) subnetMap[sn] = [];
  if (!subnetMap[sn].includes(d.id)) subnetMap[sn].push(d.id);

  const col = TYPE_COLOR[d.type] || "#64748b";
  const fontColor = isDark ? "#ccd6f6" : "#0f172a";

  const vn = {
    id:    d.id,
    label: (d.label || d.id).split("\n")[0],  // only first line as label
    shape: "dot",
    size:  sizeFor(d.id, d.type),
    color: d.alive === false ? {
      background: "#1a0000", border: "#ef4444",
      highlight: { background: "#7f1d1d", border: "#fca5a5" },
    } : {
      background: col, border: col + "bb",
      highlight: { background: col, border: "#ffffff" },
      hover: { background: col, border: "#ffffff" },
    },
    font:  { color: "#9fb2c9", size: 10.5, face:"'Inter',system-ui,sans-serif", vadjust: 9 },
    title: makeTooltip(d),
    x: 0, y: lv * LEVEL_Y,
    shadow: { enabled: true, color: col+"66", size:14, x:0, y:0 },
  };

  if (isNew) nodes.add(vn); else nodes.update({ ...vn, x:undefined, y:undefined });
  recomputeLayout();

  if (!d.alive) blinkSet.add(d.id); else blinkSet.delete(d.id);
  if (isNew) document.getElementById("empty").classList.add("hidden");
  if (selectedId === d.id) renderDetail(d);

  const all = Object.values(nodeData);
  document.getElementById("sh").textContent = all.length;
  document.getElementById("sc").textContent = all.filter(n => n.severity === "CRITIQUE").length;
  document.getElementById("sd").textContent = all.filter(n => !n.alive).length;
});

// ─── Edge ─────────────────────────────────────────────────────────────────────
socket.on("edge_add", d => {
  const dup = edges.get().some(e => (e.from===d.from&&e.to===d.to)||(e.from===d.to&&e.to===d.from));
  if (!dup) {
    edges.add({ id: ++edgeSeq, from: d.from, to: d.to });
    // Le nœud grossit avec son nombre de connexions (comme Obsidian).
    [d.from, d.to].forEach(id => {
      degree[id] = (degree[id] || 0) + 1;
      const nd = nodeData[id];
      if (nd) nodes.update({ id, size: sizeFor(id, nd.type) });
    });
  }
});

// ─── Log ──────────────────────────────────────────────────────────────────────
socket.on("log", d => {
  const wrap = document.getElementById("log-scroll");
  const div  = document.createElement("div");
  div.className = "le " + (d.level || "info");
  const dot = document.createElement("div"); dot.className = "le-dot";
  const msg = document.createElement("span"); msg.className = "le-msg";
  msg.textContent = d.msg;
  div.appendChild(dot); div.appendChild(msg);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
});

// ─── Scan lifecycle ────────────────────────────────────────────────────────────
socket.on("scan_started", () => {
  const b = document.getElementById("btn-scan");
  b.disabled = true;
  b.textContent = "⟳ Scan en cours…";
  b.classList.add("scanning");
  document.getElementById("scan-bar").classList.add("on");
});

socket.on("scan_done", () => {
  const b = document.getElementById("btn-scan");
  b.disabled = false;
  b.textContent = "↻ Relancer le scan";
  b.classList.remove("scanning");
  document.getElementById("scan-bar").classList.remove("on");
  document.getElementById("legend").style.display = "block";
  setTimeout(fitView, 350);
});

socket.on("report_ready", () => {
  document.getElementById("btn-report").style.display = "inline-flex";
});

socket.on("stats_update", d => {
  document.getElementById("sh").textContent = d.hosts;
});

// ─── Detail panel ─────────────────────────────────────────────────────────────
function renderDetail(d) {
  const col    = TYPE_COLOR[d.type] || "#64748b";
  const sev    = d.severity || "INFO";
  const sevCol = SEV_COLOR[sev] || "#6b7280";
  const alive  = d.alive !== false;

  const svcsHtml = (d.services || []).map(s => {
    const sc = SEV_COLOR[s.sev] || "#6b7280";
    return `<div class="svc">
      <div class="svc-port">${s.port}/tcp</div>
      <div class="svc-name">${s.name}</div>
      <div class="svc-desc">${s.desc||""}</div>
      <div class="svc-sev" style="color:${sc}">⬤ ${s.sev}</div>
    </div>`;
  }).join("") || `<div style="font-size:12px;color:var(--muted);padding:8px 0">Aucun service identifié</div>`;

  const ports = nodeData[d.id]?.services || [];
  const extraPorts = (nodeData[d.id]?.ports || []).filter(p => !ports.find(s => s.port===p));

  document.getElementById("detail-body").innerHTML = `
    <div class="nd-type" style="background:${col}18;color:${col};border:1px solid ${col}30">
      ${getTypeSymbol(d.type)} ${TYPE_LABEL[d.type]||"Inconnu"}
    </div>
    <div class="nd-ip">${d.id}</div>
    <div class="nd-meta">
      Niveau ${d.level}
      ${d.subnet ? ` &nbsp;·&nbsp; ${d.subnet}` : ""}
      ${d.gateway ? `<br>Via ${d.gateway}` : ""}
    </div>
    <span class="nd-sev" style="background:${sevCol}18;color:${sevCol};border:1px solid ${sevCol}35">${sev}</span>
    <div class="nd-sec">Services détectés</div>
    ${svcsHtml}
    ${extraPorts.length ? `<div class="nd-sec">Autres ports ouverts</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#38bdf8;line-height:1.8">${extraPorts.map(p=>`${p}/tcp`).join("  ")}</div>` : ""}
    <div class="nd-alive ${alive?"on":"off"}">
      <span style="font-size:7px">⬤</span> ${alive?"En ligne":"HORS LIGNE"}
    </div>`;
}

function getTypeSymbol(type) {
  const s = { plc:"⚙", scada:"🖥", router:"⬡", server:"⊟", unknown:"?" };
  return s[type] || "?";
}

network.on("click", p => {
  if (!p.nodes.length) return;
  const d = nodeData[p.nodes[0]];
  if (!d) return;
  selectedId = d.id;
  renderDetail(d);
  document.getElementById("detail").classList.add("open");
});

function closeDetail() {
  document.getElementById("detail").classList.remove("open");
  selectedId = null;
  network.unselectAll();
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function fitView() {
  network.fit({ animation: { duration: 650, easingFunction: "easeInOutQuad" } });
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
  setTimeout(() => { network.setSize("100%","100%"); network.redraw(); }, 230);
}

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  document.getElementById("btn-theme").textContent = isDark ? "🌙" : "☀️";

  // Update font colors on all nodes
  const fc = isDark ? "#ccd6f6" : "#0f172a";
  nodes.forEach(n => nodes.update({ id:n.id, font:{...n.font, color:fc} }));
}

function startScan() { socket.emit("start_scan"); }

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "f" || e.key === "F") fitView();
  if (e.key === "t" || e.key === "T") toggleTheme();
  if (e.key === "Escape") closeDetail();
  if (e.key === "[") toggleSidebar();
});

window.addEventListener("resize", () => { network.setSize("100%","100%"); network.redraw(); });
</script>
</body>
</html>"""


if __name__ == "__main__":
    load_routing_table()
    threading.Thread(target=monitor_loop, daemon=True).start()
    try:
        import socket as _s
        _x = _s.socket(_s.AF_INET, _s.SOCK_DGRAM)
        _x.connect(("8.8.8.8", 80)); local_ip = _x.getsockname()[0]; _x.close()
    except Exception:
        local_ip = "0.0.0.0"
    print(f"\n{'='*52}\n  NetCarto — Cartographie Réseau\n  http://{local_ip}:5090\n{'='*52}\n")
    sio.run(app, host="0.0.0.0", port=5090, debug=False, allow_unsafe_werkzeug=True)
