from flask import Flask, render_template, request, redirect, url_for, session, flash
import subprocess
import json, os, functools
from pathlib import Path
from datetime import datetime

# --- CORRECTION ICI ---
# On calcule le chemin absolu du dossier où se trouve ce fichier (app.py)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# On pointe vers le dossier templates situé au même endroit
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')

app = Flask(__name__, template_folder=TEMPLATE_DIR)

INTERFACE_LABELS = {
    "eth0": "Network-A",
    "eth1": "Network-B"
}

# SECRET_KEY is required for sessions - FIXED key for persistence
app.secret_key = "firewall-ui-secret-key-2024-fixed"

# --- CORRECTION SESSION ---
# On change le nom du cookie pour forcer le navigateur à en créer un nouveau propre
app.config['SESSION_COOKIE_NAME'] = 'fwui_session' 
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False  # False car tu es en HTTP (pas HTTPS)
app.config['PERMANENT_SESSION_LIFETIME'] = 3600


# default users list (will be persisted when load_config runs if config exists)
DEFAULT_USERS = [{"username": "admin", "password": "password"}]  # intentionally weak for labs

users = DEFAULT_USERS.copy()  # list of dicts with username/password

LOG_FILE = "/var/log/ulog/netfilter_log.json"
FIREWALL_RULES_PATH = "/etc/firewall/rules"
CONFIG_PATH = "/etc/firewall/config.json"
IDS_ALERTS_FILE = "/etc/suricata/alerts.json"
IDS_RULES_FILE = "/etc/suricata/rules/local.rules"

pending_rules = []
dirty = False

def parse_firewall_logs(limit=100):
    entries = []
    try:
        with open(LOG_FILE) as f:
            for line in f:
                data = json.loads(line)
                in_iface = INTERFACE_LABELS.get(data.get("oob.in"), data.get("oob.in", "?"))
                entries.append({
                    "time": datetime.fromisoformat(data.get("timestamp")).strftime("%H:%M:%S"),
                    "action": data.get("oob.prefix", "").replace("FW ", "").strip(": "),
                    "proto": {6:"TCP",17:"UDP",1:"ICMP"}.get(data.get("ip.protocol"), str(data.get("ip.protocol"))),
                    "src": f"{data.get('src_ip','?')}:{data.get('src_port','')}",
                    "dst": f"{data.get('dest_ip','?')}:{data.get('dest_port','')}",
                    "iface": f"{in_iface}",
                })
        entries = entries[-limit:]  # last N lines
    except FileNotFoundError:
        pass
    return entries

def get_recent_alerts(limit=50):
    eve_path = Path("/var/log/suricata/eve.json")
    alerts = []
    if not eve_path.exists():
        return alerts
    with eve_path.open() as f:
        for line in f:
            try:
                event = json.loads(line)
                if event.get("event_type") == "alert":
                    alerts.append({
                        "timestamp": event.get("timestamp"),
                        "src": event.get("src_ip"),
                        "dst": event.get("dest_ip"),
                        "proto": event.get("proto"),
                        "signature": event["alert"].get("signature"),
                    })
            except json.JSONDecodeError:
                continue
    return alerts[-limit:]

def load_json(path, default=[]):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_config():
    global pending_rules, dirty, users
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            data = json.load(f)
            pending_rules = data.get("rules", [])
            # Load users list from config
            if "users" in data:
                users = data["users"]
            # Migration: convert old single-user "auth" to new "users" list
            elif "auth" in data:
                users = [data["auth"]]
    else:
        pending_rules = []
    dirty = False


def save_config():
    data = {"rules": pending_rules, "users": users}
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)


# --- login helper/decorator ---
def login_required(view):
    @functools.wraps(view)
    def wrapped_view(*args, **kwargs):
        print(f"[DEBUG] Checking session for {request.path}: logged_in={session.get('logged_in')}, username={session.get('username')}")
        if not session.get("logged_in"):
            print(f"[DEBUG] Session not found, redirecting to login")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped_view

def find_user(username, password):
    """Check if user exists with matching password"""
    for user in users:
        if user.get("username") == username and user.get("password") == password:
            return user
    return None


@app.route("/login", methods=["GET", "POST"])
def login():
    next_url = request.args.get("next") or url_for("index")
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        # check against all users
        user = find_user(username, password)
        if user:
            # --- AJOUT ---
            session.clear() # On nettoie toute vieille session avant de connecter
            # -------------
            session.permanent = True  # Make session persistent
            session["logged_in"] = True
            session["username"] = username
            print(f"[DEBUG] Login successful for {username}, session: {dict(session)}")
            flash("Logged in", "success")
            return redirect(next_url)
        else:
            flash("Invalid username or password", "danger")
    return render_template("login.html", next=next_url)

@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out", "info")
    return redirect(url_for("login"))


def username_exists(username):
    """Check if username is already taken"""
    for user in users:
        if user.get("username").lower() == username.lower():
            return True
    return False


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")
        
        # Validation
        if not username or not password:
            flash("Username and password are required", "danger")
            return render_template("register.html")
        
        if len(username) < 3:
            flash("Username must be at least 3 characters", "danger")
            return render_template("register.html")
        
        if len(password) < 4:
            flash("Password must be at least 4 characters", "danger")
            return render_template("register.html")
        
        if password != confirm_password:
            flash("Passwords do not match", "danger")
            return render_template("register.html")
        
        # Check if username already exists
        if username_exists(username):
            flash("Username already taken", "danger")
            return render_template("register.html")
        
        # Add new user to users list
        global users
        users.append({"username": username, "password": password})
        save_config()
        
        flash("Account created successfully! You can now sign in.", "success")
        return redirect(url_for("login"))
    
    return render_template("register.html")

# --- protect routes: add @login_required above routes that need protection ---
# Example: protect index and all modifying endpoints

def is_dirty():
    active = subprocess.check_output(["iptables-save"], text=True)
    saved = open(CONFIG_PATH).read() if os.path.exists(CONFIG_PATH) else ""
    return saved not in active


def parse_iptables_rules():
    raw = subprocess.check_output(["iptables", "-S"], text=True).splitlines()
    idx = 0
    rules = []
    for line in raw:
        if not line.startswith('-A'):  # only actual rules
            continue
        idx += 1
        parts = line.split()
        rule = {
            'index': idx,
            'chain': parts[1],
            'iface_in': next((parts[i+1] for i,p in enumerate(parts) if p == '-i'), ''),
            'iface_out': next((parts[i+1] for i,p in enumerate(parts) if p == '-o'), ''),
            'src': next((parts[i+1] for i,p in enumerate(parts) if p == '-s'), 'any'),
            'dst': next((parts[i+1] for i,p in enumerate(parts) if p == '-d'), 'any'),
            'proto': next((parts[i+1] for i,p in enumerate(parts) if p == '-p'), 'any'),
            'dport': next((parts[i+1] for i,p in enumerate(parts) if p == '--dport'), 'any'),
            'action': parts[-1],
        }
        rules.append(rule)
    return rules

@app.route("/", endpoint="index")
@app.route("/firewall")
@app.route("/index")
@login_required
def firewall():
    global dirty
    user = session.get("username")
    return render_template("firewall.html", rules=pending_rules, labels=INTERFACE_LABELS, dirty=dirty, user=user)


@app.route("/delete", methods=["POST"])
@login_required
def delete_rule():
    global dirty
    idx = int(request.form["rule_num"])
    if 0 <= idx < len(pending_rules):
        del pending_rules[idx]
        save_config()
        dirty = True
    return redirect(url_for("index"))


@app.route("/add", methods=["POST"])
@login_required
def add_rule():
    global dirty
    iface_in = request.form.get("iface_in") 
    iface_out = request.form.get("iface_out") 
    src = request.form.get("src") or "0.0.0.0/0" 
    dst = request.form.get("dst") or "0.0.0.0/0" 
    proto = request.form.get("proto") 
    dport = request.form.get("dport") 
    action = request.form.get("action")
    if not src or src.lower() == "any": 
        src = "0.0.0.0/0" 
    if not dst or dst.lower() == "any": 
        dst = "0.0.0.0/0" 

    rule = {
        "iface_in": iface_in,
        "iface_out": iface_out,
        "src": src,
        "dst": dst,
        "proto": proto,
        "dport": dport,
        "action": action,
    }

    pending_rules.append(rule)
    save_config()
    dirty = True

    return redirect(url_for("index"))


@app.route("/move", methods=["POST"])
@login_required
def move_rule():
    global dirty
    idx = int(request.form["rule_num"])
    direction = request.form["direction"]

    if direction == "up" and idx > 0:
        pending_rules[idx - 1], pending_rules[idx] = pending_rules[idx], pending_rules[idx - 1]
    elif direction == "down" and idx < len(pending_rules) - 1:
        pending_rules[idx + 1], pending_rules[idx] = pending_rules[idx], pending_rules[idx + 1]

    save_config()
    dirty = True
    return redirect(url_for("index"))


@app.route("/apply", methods=["POST"])
@login_required
def apply_changes():
    # Flush FORWARD chain
    subprocess.run(["iptables", "-F", "FORWARD"], check=False)
    # Reapply each saved rule
    load_config()
    rules = pending_rules
    lines = [
        "*filter",
        ":INPUT ACCEPT [0:0]",
        ":FORWARD ACCEPT [0:0]",
        ":OUTPUT ACCEPT [0:0]",
        ":LOGDROP - [0:0]",
        ":LOGREJECT - [0:0]",
        "-A LOGDROP -m limit --limit 5/second -j NFLOG --nflog-group 1 --nflog-prefix \"FW DROP: \" ",
        "-A LOGDROP -j DROP",
        "-A LOGREJECT -m limit --limit 5/second -j NFLOG --nflog-group 1 --nflog-prefix \"FW REJECT: \" ",
        "-A LOGREJECT -j REJECT",
    ]
    for r in rules:
        line = f"-A FORWARD -p {r['proto']} -s {r['src']} -d {r['dst']}"
        if r.get('iface_in'): line += f" -i {r['iface_in']}"
        if r.get('iface_out'): line += f" -o {r['iface_out']}"
        if r.get('dport') and r['proto'] in ['tcp','udp']: line += f" --dport {r['dport']}"
        if r["action"] in ["DROP","REJECT"]:
            act = "LOG" + r["action"]
            line += f" -j {act}"
        else:
            line += f" -j {r['action']}"

        lines.append(line)

    lines.append("COMMIT")
    rules_text = "\n".join(lines) + "\n"

    with open(FIREWALL_RULES_PATH, "w") as f:
        f.write(rules_text)

    proc = subprocess.run(
        ["iptables-restore", "-n", FIREWALL_RULES_PATH],  # -n = don't flush counters
    )

    if proc.returncode != 0:
        flash("Error applying firewall rules!", "danger")
    else:
        flash("Firewall rules applied successfully.", "success")
    save_config()

    return redirect(url_for("index"))

@app.route("/revert", methods=["POST"])
@login_required
def revert_changes():
    global dirty
    rules = parse_iptables_rules()
    pending_rules = rules
    save_config()
    dirty = False
    flash("Reverted to active iptables configuration", "info")
    return redirect(url_for("index"))


@app.route("/ids")
@login_required
def ids():
    # Load existing rules as flat text
    try:
        with open(IDS_RULES_FILE, "r") as f:
            rule_text = f.read()
    except FileNotFoundError:
        rule_text = ""

    alerts = get_recent_alerts()
    stats = {
        "status": "Running",
        "alerts_today": len(alerts),
        "rules_count": len(rule_text.strip().splitlines()) if rule_text.strip() else 0,
    }

    return render_template(
        "ids.html",
        active_page="ids",
        alerts=alerts,
        rule_text=rule_text,
        stats=stats,
    )


@app.route("/ids/save_rules", methods=["POST"])
@login_required
def save_rules():
    new_rules = request.form.get("rules_text", "")
    os.makedirs(os.path.dirname(IDS_RULES_FILE), exist_ok=True)
    with open(IDS_RULES_FILE, "w") as f:
        f.write(new_rules.strip() + "\n")

    try:
        subprocess.run(["pkill", "-USR2", "Suricata-Main"], check=False)
        flash("Rules saved and Suricata reloaded.", "success")
    except Exception as e:
        flash(f"Rules saved, but reload failed: {e}", "warning")

    return redirect(url_for("ids"))



@app.route("/firewall/logs")
@login_required
def firewall_logs():
    entries = parse_firewall_logs(limit=200)
    user = session.get("username")
    return render_template("firewall_logs.html", entries=entries, user=user)



load_config()

# Verification de l'existence du fichier avant de restaurer
if os.path.exists(FIREWALL_RULES_PATH):
    print(f"Chargement des regles depuis {FIREWALL_RULES_PATH}...")
    proc = subprocess.run(
        ["iptables-restore", "-n", FIREWALL_RULES_PATH],
    )
else:
    print(f"ATTENTION: Le fichier {FIREWALL_RULES_PATH} n'existe pas encore. Demarrage sans regles pre-chargees.")
    # On cree le dossier si necessaire
    os.makedirs(os.path.dirname(FIREWALL_RULES_PATH), exist_ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5443)
