#!/usr/bin/env python3
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


SERVICE_NAME = os.environ.get("SERVICE_NAME", "Service Gare")
SERVICE_KIND = os.environ.get("SERVICE_KIND", "generic")
SERVICE_IP = os.environ.get("SERVICE_IP", "")
PORT = int(os.environ.get("PORT", "8080"))

STATE = {
    "service": SERVICE_NAME,
    "kind": SERVICE_KIND,
    "ip": SERVICE_IP,
    "status": "available",
    "availability": "nominal",
    "updated_at": None,
    "metrics": {},
    "published": {},
    "events": [],
}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def defaults_for(kind):
    if kind == "ticketing":
        return {
            "metrics": {
                "validations_last_hour": 128,
                "transactions_last_hour": 41,
                "failed_validations": 2,
            },
            "published": {
                "mode": "vente_validation",
                "gare": "Dakar",
            },
        }
    if kind == "siv":
        return {
            "metrics": {
                "messages_active": 2,
                "retard_minutes": 0,
            },
            "published": {
                "train": "DKR",
                "position": "Gare de Dakar",
                "destination": "Diamniadio",
                "message": "Train DKR vers Diamniadio - depart annonce",
            },
        }
    if kind == "sono":
        return {
            "metrics": {
                "announcements_today": 12,
            },
            "published": {
                "current_announcement": "Train DKR vers Diamniadio quai principal",
                "volume": "normal",
            },
        }
    if kind == "pipc":
        return {
            "metrics": {
                "commands_today": 7,
            },
            "published": {
                "mode": "supervision_ctc_simulee",
                "signal": "vert",
                "aiguille": "directe",
            },
        }
    if kind == "cctv":
        return {
            "metrics": {
                "cameras_online": 8,
                "cameras_total": 8,
            },
            "published": {
                "zone": "Gare de Dakar",
                "recording": True,
            },
        }
    return {
        "metrics": {},
        "published": {},
    }


STATE.update(defaults_for(SERVICE_KIND))
STATE["updated_at"] = now()


class Handler(BaseHTTPRequestHandler):
    server_version = "ServicesGare/1.0"

    def do_GET(self):
        if self.path == "/health":
            self.send_json({"ok": True, "service": SERVICE_NAME, "kind": SERVICE_KIND, "updated_at": now()})
            return
        if self.path == "/status":
            payload = dict(STATE)
            payload["updated_at"] = now()
            self.send_json(payload)
            return
        if self.path == "/events":
            self.send_json({"count": len(STATE["events"]), "items": STATE["events"][-50:]})
            return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path not in ["/events", "/status"]:
            self.send_json({"error": "not found"}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            data = json.loads(raw or "{}")
        except Exception as exc:
            self.send_json({"error": f"invalid json: {exc}"}, 400)
            return

        event = {
            "timestamp": now(),
            "source": data.get("source", "unknown"),
            "type": data.get("type", "update"),
            "message": data.get("message", "Mise a jour service Gare"),
            "data": data,
        }
        STATE["events"].append(event)
        STATE["events"] = STATE["events"][-100:]

        if isinstance(data.get("status"), str):
            STATE["status"] = data["status"]
        if isinstance(data.get("availability"), str):
            STATE["availability"] = data["availability"]
        if isinstance(data.get("metrics"), dict):
            STATE["metrics"].update(data["metrics"])
        if isinstance(data.get("published"), dict):
            STATE["published"].update(data["published"])
        STATE["updated_at"] = now()

        self.send_json({"ok": True, "status": STATE, "event": event}, 201)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"[ServicesGare] {SERVICE_NAME} ({SERVICE_KIND}) listening on 0.0.0.0:{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
