#!/usr/bin/env python3
"""
Continuous ESP32 simulator (close to the real firmware behavior).

Loop behavior:
- Ensure API key is provisioned via /api/devices/:id/rotate-key (supports x-enroll-secret)
- Every tick:
  * Fetch device settings: /api/devices/:id/settings (pumpMode, overridePumpOn, thresholds)
  * Simulate soil moisture (0..100) with drift and noise
  * Apply control logic (auto/manual + hysteresis) to decide pumpOn
  * If pump state changed, POST ack: /api/devices/:id/ack
  * POST reading: /api/readings with { deviceId, moisture, payload:{ raw, pumpOn } }

It persists per-device API keys to Tester/.tester_state.json

Examples:
  python Tester/sim_device.py --host localhost --port 3000 --device esp32-sim1 --interval 5
  python Tester/sim_device.py --host localhost --port 3000 --device auto --enroll-secret SECRET
  python Tester/sim_device.py --host mushiot.onrender.com --port 443 --https --device esp32-sim1
"""

import argparse
import json
import math
import os
import random
import signal
import sys
import time
from pathlib import Path

import requests
import threading

STATE_FILE = Path(__file__).resolve().parent / ".tester_state.json"

stop_flag = False

def sig_handler(signum, frame):
    global stop_flag
    stop_flag = True

signal.signal(signal.SIGINT, sig_handler)
signal.signal(signal.SIGTERM, sig_handler)


def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: dict):
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"Warning: failed to save state: {e}")


def make_base_url(host: str, port: int, use_https: bool) -> str:
    proto = "https" if use_https else "http"
    default_port = 443 if use_https else 80
    if port and port != default_port:
        return f"{proto}://{host}:{port}"
    return f"{proto}://{host}"


def auto_device_id(prefix: str = "esp32") -> str:
    suffix = ''.join(random.choice('0123456789abcdef') for _ in range(6))
    return f"{prefix}-{suffix}"


def rotate_key(base_url: str, device_id: str, enroll_secret: str | None) -> str:
    url = f"{base_url}/api/devices/{device_id}/rotate-key"
    headers = {}
    if enroll_secret:
        headers["x-enroll-secret"] = enroll_secret
    print(f"[provision] POST {url}")
    r = requests.post(url, headers=headers, timeout=15)
    print(f"-> {r.status_code}")
    r.raise_for_status()
    data = r.json()
    key = data.get("apiKey")
    if not key:
        raise RuntimeError("rotate-key succeeded but apiKey missing in response")
    return key


def get_settings(base_url: str, device_id: str, api_key: str) -> dict:
    url = f"{base_url}/api/devices/{device_id}/settings"
    headers = {"x-api-key": api_key}
    r = requests.get(url, headers=headers, timeout=15)
    if not r.ok:
        print(f"[warn] settings {r.status_code}")
        return {}
    return r.json() or {}


def post_ack(base_url: str, device_id: str, api_key: str, pump_on: bool, mode: str, note: str = "sim"):
    url = f"{base_url}/api/devices/{device_id}/ack"
    body = {"pumpOn": pump_on, "pumpMode": mode, "note": note}
    headers = {"Content-Type": "application/json", "x-api-key": api_key}
    r = requests.post(url, headers=headers, json=body, timeout=15)
    print(f"[ack] pumpOn={pump_on} mode={mode} -> {r.status_code}")
    if not r.ok:
        print(f"[ack] error: {r.text[:200]}")

def get_ota_manifest(base_url: str) -> dict:
    url = f"{base_url}/api/ota/manifest"
    try:
        r = requests.get(url, timeout=15)
        if r.ok:
            return r.json() or {}
        print(f"[ota] manifest error {r.status_code}")
    except Exception as e:
        print(f"[ota] error: {e}")
    return {}


def post_reading(base_url: str, device_id: str, api_key: str, moisture: int, pump_on: bool, raw: int):
    url = f"{base_url}/api/readings"
    body = {
        "deviceId": device_id,
        "moisture": moisture,
        "payload": {"raw": raw, "pumpOn": pump_on, "note": "sim"},
    }
    headers = {"Content-Type": "application/json", "x-api-key": api_key}
    r = requests.post(url, headers=headers, json=body, timeout=15)
    print(f"[reading] moisture={moisture} raw={raw} -> {r.status_code}")
    if not r.ok:
        print(f"[reading] error: {r.text[:200]}")


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def listen_sse(base_url: str, device_id: str, on_settings_cb, api_key: str | None = None, on_command_cb=None):
    try:
        url = f"{base_url}/api/devices/{device_id}/stream"
        headers = {"x-api-key": api_key} if api_key else None
        print(f"[sse] connect {url}")
        with requests.get(url, headers=headers, stream=True, timeout=30) as r:
            if r.status_code != 200:
                print(f"[sse] http {r.status_code}")
                return
            last_event = None
            for line in r.iter_lines(decode_unicode=True):
                if stop_flag:
                    break
                if not line:
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    last_event = line.split(":",1)[1].strip()
                    print(f"[sse] event {last_event}")
                elif line.startswith("data:"):
                    data = line.split(":",1)[1].strip()
                    print(f"[sse] data {data}")
                    if last_event == "settings":
                        try:
                            on_settings_cb()
                            print("[sse] wake by settings")
                        except Exception:
                            pass
                    elif last_event == "command" and on_command_cb:
                        try:
                            patch = json.loads(data).get("patch") if data else None
                            if isinstance(patch, dict):
                                print(f"[sse] apply command patch: {patch}")
                                on_command_cb(patch)
                        except Exception:
                            pass
    except Exception:
        pass


def main():
    p = argparse.ArgumentParser(description="Continuous ESP32 simulator")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=3000)
    p.add_argument("--https", dest="https", default=False, action=argparse.BooleanOptionalAction)
    p.add_argument("--device", default="esp32-sim1", help="deviceId or 'auto'")
    p.add_argument("--enroll-secret", default=os.getenv("ENROLL_SECRET"))
    p.add_argument("--interval", type=float, default=60.0, help="send interval seconds")
    p.add_argument("--seed", type=int, default=None, help="random seed for reproducibility")
    args = p.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    device_id = auto_device_id() if args.device == "auto" else args.device
    base_url = make_base_url(args.host, args.port, args.https)

    state = load_state()
    api_key = state.get("devices", {}).get(device_id)

    try:
        if not api_key:
            api_key = rotate_key(base_url, device_id, args.enroll_secret)
            st = state.get("devices", {})
            st[device_id] = api_key
            state["devices"] = st
            save_state(state)
            print(f"[provision] apiKey saved for {device_id}")
    except Exception as e:
        print(f"[fatal] provision failed: {e}")
        sys.exit(1)

    # Sim moisture state
    moisture = random.randint(35, 60)
    pump_on = False
    last_ack_state = None
    settings_applied_acked = False

    print(f"[run] device={device_id} interval={args.interval}s base={base_url}")

    # SSE listener to nudge immediate settings fetch
    sse_nudge = {"flag": False}
    def on_settings():
        sse_nudge["flag"] = True
    # pending command patch from SSE
    pending = {"patch": None}
    def on_command(patch: dict):
        pending["patch"] = patch
        sse_nudge["flag"] = True  # wake loop immediately
        print("[sse] loop wake due to command")

    t = threading.Thread(target=listen_sse, args=(base_url, device_id, on_settings, api_key, on_command), daemon=True)
    t.start()
    while not stop_flag:
        try:
            # Fetch settings
            s = get_settings(base_url, device_id, api_key)
            mode = (s.get("pumpMode") or "auto").lower()
            override_on = bool(s.get("overridePumpOn", False))
            on_below = int(s.get("pumpOnBelow", 35))
            off_above = int(s.get("pumpOffAbove", 45))
            send_interval = float(s.get("sendIntervalSec") or args.interval)

            # Apply pending command patch instantly (from SSE)
            if pending["patch"]:
                p = pending["patch"]
                pending["patch"] = None
                if "pumpMode" in p:
                    mode = str(p.get("pumpMode") or mode).lower()
                if "overridePumpOn" in p:
                    override_on = bool(p.get("overridePumpOn"))
                if "pumpOnBelow" in p:
                    on_below = int(p.get("pumpOnBelow") or on_below)
                if "pumpOffAbove" in p:
                    off_above = int(p.get("pumpOffAbove") or off_above)
                if "sendIntervalSec" in p:
                    try:
                        send_interval = float(p.get("sendIntervalSec") or send_interval)
                    except Exception:
                        pass
                # Post immediate ACK reflecting new desired state
                # Compute desired pump state right now (hysteresis-aware)
                desired_pump = pump_on
                if mode == "manual":
                    desired_pump = override_on
                else:
                    if (not pump_on) and (moisture < on_below):
                        desired_pump = True
                    elif pump_on and (moisture > off_above):
                        desired_pump = False
                # Send ACK immediately
                post_ack(base_url, device_id, api_key, desired_pump, mode, note="cmd")
                last_ack_state = (desired_pump, mode)
                # Also apply desired pump locally so subsequent logic is consistent
                pump_on = desired_pump

            # One-time ACK to confirm settings applied (mirrors firmware behavior)
            if not settings_applied_acked:
                post_ack(base_url, device_id, api_key, pump_on, mode, note="settings applied")
                settings_applied_acked = True

            # Simulate environment drift: random walk + slight sine
            moisture += random.randint(-2, 2) + int(5 * math.sin(time.time()/60.0))
            moisture = clamp(moisture, 0, 100)
            raw = 1400 + int((100 - moisture) * (3200 - 1400) / 100)  # inverse mapping similar to firmware

            # Control logic
            if mode == "manual":
                pump_on = override_on
            else:
                if not pump_on and moisture < on_below:
                    pump_on = True
                elif pump_on and moisture > off_above:
                    pump_on = False

            # Ack only when state changes
            if last_ack_state is None or last_ack_state != (pump_on, mode):
                post_ack(base_url, device_id, api_key, pump_on, mode)
                last_ack_state = (pump_on, mode)

            # Post reading
            post_reading(base_url, device_id, api_key, moisture, pump_on, raw)

            # Lightweight OTA check occasionally (every ~60 iterations)
            if int(time.time()) % 600 == 0:
                m = get_ota_manifest(base_url)
                if m.get("version") and m.get("url"):
                    print(f"[ota] available version={m['version']} url={m['url']}")
        except Exception as e:
            print(f"[loop] error: {e}")

        # sleep (respect server-provided sendIntervalSec if available)
        t0 = time.time()
        while time.time() - t0 < send_interval:
            if stop_flag:
                break
            if sse_nudge["flag"]:
                # immediate fetch triggered by SSE
                sse_nudge["flag"] = False
                break
            time.sleep(0.25)

    print("[stop] simulator stopped")


if __name__ == "__main__":
    main()
