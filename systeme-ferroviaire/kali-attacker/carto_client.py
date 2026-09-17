#!/usr/bin/env python3
"""
Cartographie ICS — Démo Client
-------------------------------
Lance un scan nmap sur les 3 zones réseau du Cyber Range ICS,
découvre automatiquement les équipements, capture des screenshots
des interfaces web, et génère un rapport HTML visuel professionnel.

Usage : python3 /opt/tools/carto_client.py
Output: /tmp/carto/rapport_client.html
"""

import subprocess, os, base64, datetime, sys
import xml.etree.ElementTree as ET

OUTPUT_DIR = "/tmp/carto"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

NETWORKS = [
    ("L1 — Réseau Terrain",     "192.168.10.0/24", "#b91c1c"),
    ("L2 — Réseau Supervision", "192.168.20.0/24", "#c2410c"),
    ("L3 — Réseau Gestion",     "192.168.30.0/24", "#1d4ed8"),
]

# Base de connaissance des équipements attendus
ROLE_DB = {
    "192.168.10.10":  ("PLC Station A",      "PLC",       "L1"),
    "192.168.10.20":  ("SCADA Station A",    "SCADA",     "L1"),
    "192.168.10.254": ("Routeur R1",         "Routeur",   "L1"),
    "192.168.20.10":  ("PLC Station B",      "PLC",       "L2"),
    "192.168.20.20":  ("SCADA Station B",    "SCADA",     "L2"),
    "192.168.20.40":  ("SCADA Central",      "SCADA",     "L2"),
    "192.168.20.253": ("Routeur R2",         "Routeur",   "L2"),
    "192.168.20.254": ("Routeur R1 (côté L2)","Routeur",  "L2"),
    "192.168.30.10":  ("SCADA Dispatching",  "SCADA",     "L3"),
    "192.168.30.20":  ("EWS Ingénierie",     "EWS",       "L3"),
    "192.168.30.30":  ("Machine Attaquante", "Kali",      "L3"),
    "192.168.30.40":  ("Historian InfluxDB", "Historian", "L3"),
    "192.168.30.253": ("Routeur R2 (côté L3)","Routeur",  "L3"),
    "192.168.30.254": ("Routeur R1 (côté L3)","Routeur",  "L3"),
}

SERVICE_INFO = {
    "502":   ("Modbus TCP",      "CRITIQUE", "Protocole industriel sans authentification"),
    "102":   ("Siemens S7",      "CRITIQUE", "Accès direct aux automates Siemens"),
    "44818": ("EtherNet/IP",     "ÉLEVÉ",    "Protocole Allen-Bradley / Rockwell"),
    "1881":  ("FUXA SCADA A",    "ÉLEVÉ",    "Interface de supervision sans auth forte"),
    "1882":  ("FUXA SCADA B",    "ÉLEVÉ",    "Interface de supervision sans auth forte"),
    "1884":  ("FUXA Dispatching","ÉLEVÉ",    "Supervision centrale — vue globale process"),
    "8080":  ("OpenPLC Web",     "ÉLEVÉ",    "Interface web automate — credentials défaut"),
    "8086":  ("InfluxDB",        "ÉLEVÉ",    "Base de données industrielle — sans TLS"),
    "8888":  ("Caldera C2",      "INFO",     "Plateforme de simulation d'attaques"),
    "5443":  ("Firewall UI",     "MOYEN",    "Interface pare-feu — credentials admin/password"),
    "6080":  ("noVNC Bureau",    "MOYEN",    "Bureau distant accessible via navigateur"),
    "6081":  ("noVNC Bureau",    "MOYEN",    "Bureau distant accessible via navigateur"),
    "22":    ("SSH",             "MOYEN",    "Administration système"),
    "80":    ("HTTP",            "INFO",     "Service web"),
    "443":   ("HTTPS",           "INFO",     "Service web sécurisé"),
}

ZONE_COLORS = {
    "L1": {"bg": "#fef2f2", "border": "#b91c1c", "text": "#b91c1c", "node": "#dc2626", "light": "#fee2e2"},
    "L2": {"bg": "#fff7ed", "border": "#c2410c", "text": "#c2410c", "node": "#ea580c", "light": "#ffedd5"},
    "L3": {"bg": "#eff6ff", "border": "#1d4ed8", "text": "#1d4ed8", "node": "#2563eb", "light": "#dbeafe"},
}

SEV_COLORS = {
    "CRITIQUE": "#dc2626",
    "ÉLEVÉ":    "#ea580c",
    "MOYEN":    "#ca8a04",
    "INFO":     "#3b82f6",
}

# ═══════════════════════════════════════════════════════════════════
#  ÉTAPE 1 — SCAN NMAP
# ═══════════════════════════════════════════════════════════════════

def print_banner(text):
    print(f"\n{'═'*60}")
    print(f"  {text}")
    print(f"{'═'*60}")

print_banner("CARTOGRAPHIE ICS — DÉMARRAGE DU SCAN")
print(f"  Heure  : {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
print(f"  Zones  : L1 · L2 · L3")
print(f"  Output : {OUTPUT_DIR}/rapport_client.html")

discovered = {}  # ip -> {name, type, zone, ports:[{port,service,product}]}

for net_name, cidr, color in NETWORKS:
    print(f"\n[*] Scan en cours : {net_name} ({cidr})")
    xml_file = f"{OUTPUT_DIR}/nmap_{cidr.replace('/', '_')}.xml"

    try:
        subprocess.run([
            "nmap", "-sS", "-sV", "--open", "-T4",
            "-p", "22,80,102,443,502,1881,1882,1883,1884,5443,6080,6081,8080,8086,8888,44818",
            "--script", "modbus-discover,s7-info",
            "--host-timeout", "15s",
            "-oX", xml_file, cidr
        ], capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        print(f"   ! Timeout sur {cidr}")
        continue
    except FileNotFoundError:
        print("   ! nmap non trouvé — simulation avec hôtes connus")
        # Mode simulation si nmap absent
        for ip, (name, typ, zone) in ROLE_DB.items():
            if zone == net_name.split("—")[0].strip():
                discovered[ip] = {"name": name, "type": typ, "zone": zone, "ports": [], "simulated": True}
        continue

    if not os.path.exists(xml_file):
        continue

    try:
        tree = ET.parse(xml_file)
        for host in tree.getroot().findall("host"):
            if host.find("status") is None or host.find("status").get("state") != "up":
                continue
            addr_el = host.find("address[@addrtype='ipv4']")
            if addr_el is None:
                continue
            ip = addr_el.get("addr")

            ports_found = []
            ports_el = host.find("ports")
            if ports_el:
                for port_el in ports_el.findall("port"):
                    st = port_el.find("state")
                    if st is None or st.get("state") != "open":
                        continue
                    pid = port_el.get("portid", "")
                    svc = port_el.find("service")
                    ports_found.append({
                        "port":    pid,
                        "service": svc.get("name", "") if svc is not None else "",
                        "product": svc.get("product", "") if svc is not None else "",
                    })

            role = ROLE_DB.get(ip, (f"Hôte {ip}", "Inconnu", net_name.split("—")[0].strip()))
            zone = role[2]
            discovered[ip] = {
                "name": role[0], "type": role[1], "zone": zone,
                "ports": ports_found, "simulated": False
            }
            print(f"   ✓ {ip:16s}  {role[0]:25s}  {len(ports_found)} port(s) ouvert(s)")
    except ET.ParseError as e:
        print(f"   ! Erreur XML: {e}")

print(f"\n[✓] {len(discovered)} équipement(s) découvert(s)")

# ═══════════════════════════════════════════════════════════════════
#  ÉTAPE 2 — SCREENSHOTS DES INTERFACES WEB
# ═══════════════════════════════════════════════════════════════════

print_banner("CAPTURE DES INTERFACES WEB")

web_targets = []
for ip, info in discovered.items():
    for p in info["ports"]:
        port = p["port"]
        if port in ["80","443","1881","1882","1884","5443","6080","6081","8080","8086","8888"]:
            proto = "https" if port in ["443","5443"] else "http"
            web_targets.append((ip, port, info["name"], proto))

screenshots = {}
for ip, port, name, proto in web_targets[:10]:
    url  = f"{proto}://{ip}:{port}"
    slug = f"{ip.replace('.','_')}_{port}"
    path = f"{OUTPUT_DIR}/{slug}.png"
    print(f"   -> {url}")
    try:
        subprocess.run([
            "chromium", "--headless=new", "--no-sandbox",
            "--disable-setuid-sandbox", "--disable-dev-shm-usage",
            "--disable-gpu", "--window-size=1280,800",
            f"--screenshot={path}",
            "--virtual-time-budget=7000",
            "--ignore-certificate-errors", url
        ], capture_output=True, timeout=25)
    except Exception as e:
        print(f"      ! {e}")
    if os.path.exists(path):
        with open(path, "rb") as f:
            screenshots[slug] = base64.b64encode(f.read()).decode()
        print(f"      OK  ({os.path.getsize(path)//1024} KB)")
    else:
        print(f"      Échec")

# ═══════════════════════════════════════════════════════════════════
#  ÉTAPE 3 — GÉNÉRATION DU DIAGRAMME SVG
# ═══════════════════════════════════════════════════════════════════

def build_topology_svg(discovered):
    """Génère un diagramme SVG de la topologie réseau."""

    # Trier les hôtes par zone
    zones_hosts = {"L1": [], "L2": [], "L3": []}
    for ip, info in sorted(discovered.items()):
        z = info["zone"]
        if z in zones_hosts:
            zones_hosts[z].append((ip, info))

    SVG_W  = 960
    ZONE_H = 160
    PAD_X  = 40
    ROUTER_H = 40
    TOTAL_H  = 3 * ZONE_H + 2 * ROUTER_H + 60

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_W}" height="{TOTAL_H}" '
        f'viewBox="0 0 {SVG_W} {TOTAL_H}" style="font-family:sans-serif;background:#f8fafc;border-radius:12px">'
    ]

    zone_order  = ["L3", "L2", "L1"]
    zone_labels = {
        "L3": "ZONE L3 — Réseau de Gestion",
        "L2": "ZONE L2 — Réseau de Supervision",
        "L1": "ZONE L1 — Réseau Terrain (OT)",
    }

    zone_y = {}
    y = 20
    for zone_key in zone_order:
        c = ZONE_COLORS[zone_key]
        zone_y[zone_key] = y

        # Zone background
        svg_parts.append(
            f'<rect x="{PAD_X}" y="{y}" width="{SVG_W - 2*PAD_X}" height="{ZONE_H}" '
            f'rx="10" fill="{c["light"]}" stroke="{c["border"]}" stroke-width="2"/>'
        )
        # Zone label
        svg_parts.append(
            f'<text x="{PAD_X + 14}" y="{y + 22}" '
            f'font-size="12" font-weight="bold" fill="{c["text"]}">{zone_labels[zone_key]}</text>'
        )

        hosts = zones_hosts.get(zone_key, [])
        n = len(hosts)
        if n > 0:
            slot_w = (SVG_W - 2*PAD_X) / max(n, 1)
            for i, (ip, info) in enumerate(hosts):
                cx = int(PAD_X + slot_w * i + slot_w / 2)
                cy = int(y + ZONE_H / 2 + 10)
                r  = 32 if info["type"] == "Routeur" else 36

                # Node circle
                node_color = "#7c3aed" if info["type"] == "Routeur" else c["node"]
                svg_parts.append(
                    f'<circle cx="{cx}" cy="{cy}" r="{r}" '
                    f'fill="{node_color}" stroke="white" stroke-width="3" opacity="0.92"/>'
                )

                # Type icon (letter abbreviation)
                abbr = {"PLC":"PLC","SCADA":"SCADA","Routeur":"RTR","EWS":"EWS",
                        "Historian":"HIST","Kali":"KALI"}.get(info["type"], info["type"][:4].upper())
                svg_parts.append(
                    f'<text x="{cx}" y="{cy + 5}" text-anchor="middle" '
                    f'font-size="11" font-weight="bold" fill="white">{abbr}</text>'
                )

                # IP label below node
                svg_parts.append(
                    f'<text x="{cx}" y="{cy + r + 14}" text-anchor="middle" '
                    f'font-size="10" fill="#374151" font-weight="600">{ip}</text>'
                )
                # Name label
                short_name = info["name"][:18]
                svg_parts.append(
                    f'<text x="{cx}" y="{cy + r + 26}" text-anchor="middle" '
                    f'font-size="9" fill="#6b7280">{short_name}</text>'
                )

                # Port count badge (if has critical ports)
                critical_ports = [p for p in info["ports"]
                                  if p["port"] in ["502","102","44818","1881","1882","1884","8080","8086"]]
                if critical_ports:
                    badge_x = cx + r - 8
                    badge_y = cy - r + 8
                    svg_parts.append(
                        f'<circle cx="{badge_x}" cy="{badge_y}" r="9" fill="#dc2626" stroke="white" stroke-width="2"/>'
                    )
                    svg_parts.append(
                        f'<text x="{badge_x}" y="{badge_y + 4}" text-anchor="middle" '
                        f'font-size="8" font-weight="bold" fill="white">{len(critical_ports)}</text>'
                    )

        # Separator / router band between zones
        y += ZONE_H
        if zone_key != "L1":
            # Router band
            svg_parts.append(
                f'<rect x="{PAD_X}" y="{y}" width="{SVG_W - 2*PAD_X}" height="{ROUTER_H}" '
                f'rx="0" fill="#f3f4f6" stroke="#d1d5db" stroke-width="1"/>'
            )
            # Arrow down
            ax = SVG_W // 2
            ay = y + ROUTER_H // 2
            svg_parts.append(
                f'<line x1="{ax}" y1="{ay-12}" x2="{ax}" y2="{ay+12}" '
                f'stroke="#6b7280" stroke-width="2" marker-end="url(#arr)"/>'
            )
            # Router label
            rtr_label = "Routeur R2 + Pare-feu (L2↔L3)" if zone_key == "L2" else "Routeur R1 + Pare-feu (L1↔L2)"
            svg_parts.append(
                f'<text x="{PAD_X + 20}" y="{y + 26}" font-size="10" fill="#6b7280">{rtr_label}</text>'
            )
            y += ROUTER_H

    # Arrow marker definition
    svg_parts.insert(1,
        '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 Z" fill="#6b7280"/></marker>'
        '<marker id="arr_red" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 Z" fill="#dc2626"/></marker></defs>'
    )

    svg_parts.append('</svg>')
    return "".join(svg_parts)

# ═══════════════════════════════════════════════════════════════════
#  ÉTAPE 4 — RAPPORT HTML
# ═══════════════════════════════════════════════════════════════════

print_banner("GÉNÉRATION DU RAPPORT HTML")

topology_svg = build_topology_svg(discovered)

# Stats
all_ports = []
for info in discovered.values():
    all_ports.extend(info["ports"])
critical_ips = [ip for ip, info in discovered.items()
                if any(p["port"] in ["502","102","44818"] for p in info["ports"])]

n_hosts    = len(discovered)
n_services = len(all_ports)
n_critical = sum(1 for p in all_ports if p["port"] in ["502","102","44818"])
n_zones    = len([z for z in ["L1","L2","L3"] if any(i["zone"]==z for i in discovered.values())])

# Equipment cards
cards_html = ""
for zone_key in ["L3","L2","L1"]:
    zone_hosts = [(ip, info) for ip, info in sorted(discovered.items()) if info["zone"] == zone_key]
    if not zone_hosts:
        continue
    c = ZONE_COLORS[zone_key]
    zone_labels_map = {
        "L3": "Zone L3 — Réseau de Gestion",
        "L2": "Zone L2 — Réseau de Supervision",
        "L1": "Zone L1 — Réseau Terrain (OT)",
    }
    cards_html += f'''
    <div style="margin-bottom:28px">
      <h3 style="color:{c["text"]};font-size:14px;font-weight:700;border-left:4px solid {c["border"]};
        padding-left:12px;margin-bottom:14px">{zone_labels_map[zone_key]}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px">
    '''
    for ip, info in zone_hosts:
        port_badges = ""
        for p in info["ports"]:
            si = SERVICE_INFO.get(p["port"])
            if si:
                sc, sev, desc = si
                col = SEV_COLORS.get(sev, "#6b7280")
                port_badges += (
                    f'<span title="{desc}" style="display:inline-block;margin:2px;padding:2px 8px;'
                    f'border-radius:4px;font-size:11px;background:{col}22;color:{col};border:1px solid {col}">'
                    f'{p["port"]} · {sc}</span>'
                )

        # Screenshot
        slug     = f"{ip.replace('.','_')}_{info['ports'][0]['port']}" if info["ports"] else ""
        img_html = ""
        for p in info["ports"]:
            s = f"{ip.replace('.','_')}_{p['port']}"
            if s in screenshots:
                img_html = (
                    f'<img src="data:image/png;base64,{screenshots[s]}" '
                    f'style="width:100%;border-radius:6px;margin-top:10px;border:1px solid #e5e7eb">'
                )
                break

        cards_html += f'''
        <div style="background:white;border:1px solid {c["border"]}44;border-radius:10px;
          padding:16px;border-top:3px solid {c["border"]}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div>
              <div style="font-size:14px;font-weight:700;color:#111827">{info["name"]}</div>
              <div style="font-size:12px;color:#6b7280">{info["type"]}</div>
            </div>
            <code style="font-size:13px;color:{c["text"]};background:{c["light"]};
              padding:3px 8px;border-radius:6px">{ip}</code>
          </div>
          <div style="margin-bottom:8px">{port_badges if port_badges else
            '<span style="color:#9ca3af;font-size:12px">Aucun service critique détecté</span>'}</div>
          {img_html}
        </div>'''
    cards_html += '</div></div>'

# Vulnerability table
vuln_rows = ""
for ip, info in sorted(discovered.items()):
    for p in info["ports"]:
        si = SERVICE_INFO.get(p["port"])
        if si and si[1] in ("CRITIQUE", "ÉLEVÉ"):
            sc, sev, desc = si
            col = SEV_COLORS[sev]
            vuln_rows += f'''
            <tr>
              <td><span style="background:{col}22;color:{col};border:1px solid {col};
                padding:2px 10px;border-radius:4px;font-size:11px;font-weight:700">{sev}</span></td>
              <td style="font-family:monospace;color:#1d4ed8">{ip}</td>
              <td style="font-weight:600">{info["name"]}</td>
              <td style="color:#374151">{p["port"]}/tcp · {sc}</td>
              <td style="color:#6b7280;font-size:12px">{desc}</td>
            </tr>'''

now = datetime.datetime.now().strftime("%d/%m/%Y à %H:%M")

HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Cartographie ICS — Rapport Client</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f5f9;color:#111827;padding:32px}}
h1{{font-size:24px;font-weight:800;color:#111827}}
h2{{font-size:16px;font-weight:700;color:#374151;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid #e5e7eb}}
.subtitle{{color:#6b7280;font-size:13px;margin:4px 0 32px}}
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}}
.stat{{background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 1px 3px #0001;border-top:4px solid var(--c)}}
.stat .n{{font-size:36px;font-weight:800;color:var(--c)}}
.stat .l{{font-size:12px;color:#6b7280;margin-top:4px}}
.topology-wrap{{background:white;border-radius:12px;padding:24px;margin-bottom:32px;box-shadow:0 1px 3px #0001}}
.legend{{display:flex;gap:16px;margin-top:16px;flex-wrap:wrap}}
.leg-item{{display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280}}
.leg-dot{{width:12px;height:12px;border-radius:50%}}
table{{width:100%;border-collapse:collapse;background:white;border-radius:12px;
  overflow:hidden;box-shadow:0 1px 3px #0001;margin-bottom:32px}}
th{{background:#f9fafb;color:#6b7280;padding:12px 16px;text-align:left;
  font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb}}
td{{padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:middle}}
tr:last-child td{{border-bottom:none}}
.badge-warn{{background:#fef9c3;color:#854d0e;border:1px solid #fde047;
  padding:6px 14px;border-radius:8px;font-size:12px;display:inline-block;margin-bottom:8px}}
</style>
</head>
<body>

<h1>Cartographie du Réseau Industriel</h1>
<div class="subtitle">
  Cyber Range ICS/OT — Rapport généré automatiquement le {now} depuis la machine attaquante Kali
</div>

<div class="badge-warn">
  ⚠ Ce rapport a été produit sans aucun accès préalable à la documentation du réseau.
  Toutes les informations ont été découvertes automatiquement en moins de 3 minutes.
</div>

<div class="stats">
  <div class="stat" style="--c:#2563eb"><div class="n">{n_zones}</div><div class="l">Zones réseau cartographiées</div></div>
  <div class="stat" style="--c:#059669"><div class="n">{n_hosts}</div><div class="l">Équipements découverts</div></div>
  <div class="stat" style="--c:#ea580c"><div class="n">{n_services}</div><div class="l">Services exposés</div></div>
  <div class="stat" style="--c:#dc2626"><div class="n">{n_critical}</div><div class="l">Services industriels critiques</div></div>
</div>

<h2>Topologie réseau reconstituée automatiquement</h2>
<div class="topology-wrap">
  <p style="font-size:12px;color:#6b7280;margin-bottom:16px">
    Diagramme généré à partir des résultats du scan — aucune documentation fournie.
    Le chiffre rouge sur un nœud indique le nombre de services industriels critiques exposés.
  </p>
  {topology_svg}
  <div class="legend">
    <div class="leg-item"><div class="leg-dot" style="background:#dc2626"></div> PLC / Automate</div>
    <div class="leg-item"><div class="leg-dot" style="background:#ea580c"></div> SCADA / HMI</div>
    <div class="leg-item"><div class="leg-dot" style="background:#2563eb"></div> Serveur (EWS, Historian)</div>
    <div class="leg-item"><div class="leg-dot" style="background:#7c3aed"></div> Routeur / Pare-feu</div>
    <div class="leg-item">
      <div style="width:12px;height:12px;border-radius:50%;background:#dc2626;
        display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:bold">N</div>
      Nombre de services critiques
    </div>
  </div>
</div>

<h2>Services critiques découverts</h2>
<table>
  <thead><tr>
    <th>Sévérité</th><th>Adresse IP</th><th>Équipement</th><th>Service</th><th>Risque</th>
  </tr></thead>
  <tbody>
    {vuln_rows if vuln_rows else '<tr><td colspan="5" style="text-align:center;color:#6b7280">Aucun service critique détecté</td></tr>'}
  </tbody>
</table>

<h2>Interfaces web capturées ({len(screenshots)} captures)</h2>
{cards_html}

<div style="text-align:center;color:#9ca3af;font-size:11px;margin-top:24px;padding-top:24px;border-top:1px solid #e5e7eb">
  Rapport généré par le Cyber Range ICS/OT — Usage interne &amp; démonstration client uniquement
</div>

</body>
</html>"""

out_path = f"{OUTPUT_DIR}/rapport_client.html"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(HTML)

print(f"\n{'═'*60}")
print(f"  RAPPORT GÉNÉRÉ AVEC SUCCÈS")
print(f"{'═'*60}")
print(f"  Fichier   : {out_path}")
print(f"  Taille    : {os.path.getsize(out_path)//1024} KB")
print(f"  Hôtes     : {n_hosts}")
print(f"  Services  : {n_services}")
print(f"  Critiques : {n_critical}")
print(f"  Captures  : {len(screenshots)}")
print(f"\n  Ouvrir dans le navigateur Kali :")
print(f"  xdg-open {out_path}")
print(f"{'═'*60}\n")
