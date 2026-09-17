#!/usr/bin/env python3
"""
Générateur de rapport de cartographie ICS — Scénario 1
Usage : python3 /opt/tools/gen_report.py
Sortie : /tmp/ics_report/rapport_cartographie.html
"""

import subprocess, os, base64, datetime

OUTPUT_DIR = "/tmp/ics_report"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---------------------------------------------------------------
# CIBLES — adapter si l'architecture change
# Format : (Nom affiché, IP, Réseau, URL, [ports])
# ---------------------------------------------------------------
TARGETS = [
    ("PLC Station A — OpenPLC Runtime",   "192.168.10.10", "L1",    "http://192.168.10.10:8080",  [502, 102, 8080, 44818]),
    ("SCADA Station A — FUXA",            "192.168.10.20", "L1",    "http://192.168.10.20:1881",  [1881]),
    ("PLC Station B — OpenPLC Runtime",   "192.168.20.10", "L2",    "http://192.168.20.10:8080",  [502, 102, 8080, 44818]),
    ("SCADA Station B — FUXA",            "192.168.20.20", "L2",    "http://192.168.20.20:1881",  [1881]),
    ("SCADA Central — FUXA Dispatching",  "192.168.30.10", "L3",    "http://192.168.30.10:1881",  [1881]),
    ("Historian — InfluxDB",              "192.168.30.40", "L3",    "http://192.168.30.40:8086",  [8086]),
    ("Routeur R1-R3 — Firewall L1/L3",   "192.168.10.254","L1/L3", "https://192.168.10.254:5443",[5443]),
    ("Routeur R2-R3 — Firewall L2/L3",   "192.168.20.254","L2/L3", "https://192.168.20.254:5443",[5443]),
]

# Correspondance port → (sévérité, description vulnérabilité)
VULN_MAP = {
    502:   ("CRITIQUE", "Modbus TCP sans authentification"),
    102:   ("CRITIQUE", "Siemens S7 exposé — contrôle direct automate"),
    44818: ("ELEVE",    "EtherNet/IP exposé"),
    1881:  ("ELEVE",    "FUXA SCADA accessible sans authentification forte"),
    8080:  ("ELEVE",    "Interface web OpenPLC — credentials défaut possibles"),
    8086:  ("ELEVE",    "InfluxDB admin HTTP sans TLS"),
    5443:  ("MOYEN",    "Interface firewall — credentials défaut admin/password"),
}

LEVEL_COLOR = {
    "L1": "#ef4444", "L2": "#f97316", "L3": "#3b82f6",
    "L1/L3": "#8b5cf6", "L2/L3": "#8b5cf6"
}
SEV_COLOR = {"CRITIQUE": "#dc2626", "ELEVE": "#ea580c", "MOYEN": "#ca8a04"}

# ---------------------------------------------------------------
# Screenshots via Chromium headless
# ---------------------------------------------------------------
print("[*] Prise de screenshots...")
screenshots = {}
for name, ip, level, url, ports in TARGETS:
    slug = ip.replace(".", "_") + "_" + str(ports[0])
    path = f"{OUTPUT_DIR}/{slug}.png"
    print(f"  -> {url}")
    try:
        subprocess.run([
            "chromium", "--headless=new", "--no-sandbox",
            "--disable-setuid-sandbox", "--disable-dev-shm-usage",
            "--disable-gpu", "--window-size=1280,720",
            f"--screenshot={path}",
            "--virtual-time-budget=6000",
            "--ignore-certificate-errors",
            url
        ], capture_output=True, timeout=25)
    except Exception as e:
        print(f"    ! Erreur: {e}")
    if os.path.exists(path):
        with open(path, "rb") as f:
            screenshots[slug] = base64.b64encode(f.read()).decode()
        print(f"    OK ({os.path.getsize(path)//1024} KB)")
    else:
        screenshots[slug] = ""
        print(f"    Echec screenshot")

# ---------------------------------------------------------------
# Construction du rapport HTML
# ---------------------------------------------------------------
print("[*] Construction du rapport HTML...")
cards = ""
vulns = []

for name, ip, level, url, ports in TARGETS:
    slug   = ip.replace(".", "_") + "_" + str(ports[0])
    lcolor = LEVEL_COLOR.get(level, "#6b7280")
    img = (
        f'<img src="data:image/png;base64,{screenshots[slug]}" '
        f'style="width:100%;border-radius:6px;margin-top:10px;">'
        if screenshots[slug] else
        '<div style="background:#1f2937;height:180px;border-radius:6px;margin-top:10px;'
        'display:flex;align-items:center;justify-content:center;color:#6b7280;">'
        'Screenshot non disponible</div>'
    )
    ptags = ""
    for p in ports:
        v = VULN_MAP.get(p)
        if v:
            sc, sd = v
            c = SEV_COLOR.get(sc, "#6b7280")
            ptags += (f'<span style="background:{c}22;color:{c};border:1px solid {c};'
                      f'padding:2px 8px;border-radius:4px;font-size:11px;margin:2px;'
                      f'display:inline-block;">! {p}/tcp — {sd}</span> ')
            vulns.append((sc, ip, p, sd, name))
        else:
            ptags += (f'<span style="background:#1f293733;color:#94a3b8;border:1px solid #334155;'
                      f'padding:2px 8px;border-radius:4px;font-size:11px;margin:2px;'
                      f'display:inline-block;">{p}/tcp</span> ')

    cards += f'''
    <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;color:#f1f5f9;font-size:15px;">{name}</h3>
        <span style="background:{lcolor}22;color:{lcolor};border:1px solid {lcolor};
          padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold;">Réseau {level}</span>
      </div>
      <div style="color:#64748b;font-size:13px;margin:6px 0;">
        <code style="color:#38bdf8;">{ip}</code> — <span style="color:#818cf8;">{url}</span>
      </div>
      <div style="margin:8px 0;">{ptags}</div>
      {img}
    </div>'''

so = {"CRITIQUE": 0, "ELEVE": 1, "MOYEN": 2}
vulns.sort(key=lambda x: so.get(x[0], 9))
vrows = ""
for sev, ip, port, desc, src in vulns:
    c = SEV_COLOR.get(sev, "#6b7280")
    vrows += (f'<tr><td><span style="background:{c}22;color:{c};border:1px solid {c};'
              f'padding:2px 10px;border-radius:4px;font-size:12px;font-weight:bold;">{sev}</span></td>'
              f'<td style="color:#38bdf8;font-family:monospace;">{ip}</td>'
              f'<td style="color:#94a3b8;">{port}/tcp</td>'
              f'<td style="color:#e2e8f0;">{desc}</td>'
              f'<td style="color:#64748b;font-size:12px;">{src}</td></tr>')

nc = sum(1 for v in vulns if v[0] == "CRITIQUE")
ne = sum(1 for v in vulns if v[0] == "ELEVE")
nm = sum(1 for v in vulns if v[0] == "MOYEN")

html = f'''<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>ICSHUB — Cartographie ICS</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:30px}}
h1{{font-size:26px;color:#f1f5f9;margin-bottom:4px}}
h2{{font-size:16px;color:#94a3b8;margin:28px 0 14px;border-bottom:1px solid #1e293b;padding-bottom:8px}}
.meta{{color:#64748b;font-size:13px;margin-bottom:28px}}
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}}
.stat{{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:18px;text-align:center}}
.stat .n{{font-size:34px;font-weight:bold}}.stat .l{{font-size:12px;color:#64748b;margin-top:4px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:18px;margin-bottom:28px}}
table{{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}}
th{{background:#0f172a;color:#94a3b8;padding:12px 15px;text-align:left;font-size:11px;text-transform:uppercase}}
td{{padding:11px 15px;border-top:1px solid #334155;font-size:13px;vertical-align:middle}}
.topo{{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:20px;font-family:monospace;
  font-size:13px;color:#94a3b8;line-height:1.9;white-space:pre;overflow-x:auto;margin-bottom:28px}}
</style></head><body>
<h1>ICSHUB — Cartographie Hostile &amp; Espionnage Industriel</h1>
<div class="meta">Scénario 1 | Attaquant : 192.168.30.30 (Kali) | {datetime.datetime.now().strftime("%d/%m/%Y %H:%M")} | Chromium + Nmap</div>
<div class="stats">
  <div class="stat"><div class="n" style="color:#38bdf8;">{len(TARGETS)}</div><div class="l">Hôtes cartographiés</div></div>
  <div class="stat"><div class="n" style="color:#dc2626;">{nc}</div><div class="l">CRITIQUES</div></div>
  <div class="stat"><div class="n" style="color:#ea580c;">{ne}</div><div class="l">ÉLEVÉES</div></div>
  <div class="stat"><div class="n" style="color:#ca8a04;">{nm}</div><div class="l">MOYENNES</div></div>
</div>
<h2>Topologie réseau reconstituée</h2>
<div class="topo">Kali Attaquant (192.168.30.30)
|
+-- L3 Dispatching (192.168.30.0/24)
|    +-- SCADA Central  192.168.30.10   FUXA:1881
|    +-- EWS            192.168.30.20   SSH:22
|    +-- Historian      192.168.30.40   InfluxDB:8086
|    +-- Router R1-R3   192.168.30.254  Firewall:5443
|    +-- Router R2-R3   192.168.30.253  Firewall:5443
|
+-- via .254 -> L1 Terrain (192.168.10.0/24)
|    +-- PLC-A          192.168.10.10   Modbus:502 | S7:102 | EIP:44818 | Web:8080
|    +-- SCADA-A        192.168.10.20   FUXA:1881
|
+-- via .253 -> L2 Supervision (192.168.20.0/24)
     +-- PLC-B          192.168.20.10   Modbus:502 | S7:102 | EIP:44818 | Web:8080
     +-- SCADA-B        192.168.20.20   FUXA:1881</div>
<h2>Interfaces web capturées ({len(TARGETS)} hôtes)</h2>
<div class="grid">{cards}</div>
<h2>Vulnérabilités identifiées ({len(vulns)})</h2>
<table><thead><tr>
  <th>Sévérité</th><th>IP</th><th>Port</th><th>Vulnérabilité</th><th>Système</th>
</tr></thead><tbody>{vrows}</tbody></table>
</body></html>'''

out_path = f"{OUTPUT_DIR}/rapport_cartographie.html"
with open(out_path, "w") as f:
    f.write(html)

print(f"\n[OK] Rapport généré : {out_path}")
print(f"     Taille          : {os.path.getsize(out_path)//1024} KB")
print(f"     Screenshots     : {sum(1 for v in screenshots.values() if v)}/{len(TARGETS)}")
