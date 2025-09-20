#!/usr/bin/env python3
"""
Simple ESP32 tester script to simulate one device.

Features:
- Rotate/Provision API key via /api/devices/:deviceId/rotate-key (optional x-enroll-secret)
- Post a reading to /api/readings with x-api-key
- Post an ack to /api/devices/:deviceId/ack with x-api-key
- Persist API key locally in Tester/.tester_state.json

Usage examples:
  python Tester/test_device.py --host localhost --port 3000 --https false --device esp32-001 --enroll-secret SECRET --reading 42 --ack-on
  python Tester/test_device.py --host localhost --port 3000 --device auto  # derive an auto id like esp32-001 (randomized)

Requirements:
  pip install -r Tester/requirements.txt
"""

import argparse
import json
import os
import random
import string
import sys
import time
from pathlib import Path

import requests

STATE_FILE = Path(__file__).resolve().parent / ".tester_state.json"


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


def auto_device_id() -> str:
    # generate a pseudo MAC-like suffix
    suffix = ''.join(random.choice('0123456789abcdef') for _ in range(6))
    return f"esp32-{suffix}"


def rotate_key(base_url: str, device_id: str, enroll_secret: str | None) -> str:
    url = f"{base_url}/api/devices/{device_id}/rotate-key"
    headers = {}
    if enroll_secret:
        headers["x-enroll-secret"] = enroll_secret
    print(f"POST {url}")
    r = requests.post(url, headers=headers, timeout=15)
    print(f"-> {r.status_code}")
    if r.ok:
        data = r.json()
        key = data.get("apiKey")
        if not key:
            raise RuntimeError("rotate-key succeeded but apiKey missing in response")
        return key
    else:
        raise RuntimeError(f"rotate-key failed: {r.status_code} {r.text}")


def post_reading(base_url: str, device_id: str, api_key: str, moisture: int):
    url = f"{base_url}/api/readings"
    body = {
        "deviceId": device_id,
        "moisture": moisture,
        "payload": {
            "raw": 2000,
            "pumpOn": False,
            "note": "tester"
        }
    }
    headers = {"Content-Type": "application/json", "x-api-key": api_key}
    print(f"POST {url} -> moisture={moisture}")
    r = requests.post(url, headers=headers, json=body, timeout=15)
    print(f"-> {r.status_code} {r.text[:200]}")
    if not r.ok:
        raise RuntimeError(f"post_reading failed: {r.status_code} {r.text}")


def post_ack(base_url: str, device_id: str, api_key: str, pump_on: bool, mode: str = "auto", note: str = "tester"):
    url = f"{base_url}/api/devices/{device_id}/ack"
    body = {"pumpOn": pump_on, "pumpMode": mode, "note": note}
    headers = {"Content-Type": "application/json", "x-api-key": api_key}
    print(f"POST {url} -> pumpOn={pump_on} mode={mode}")
    r = requests.post(url, headers=headers, json=body, timeout=15)
    print(f"-> {r.status_code} {r.text[:200]}")
    if not r.ok:
        raise RuntimeError(f"post_ack failed: {r.status_code} {r.text}")


def main():
    p = argparse.ArgumentParser(description="ESP32 tester (single device)")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=3000)
    p.add_argument("--https", dest="https", default=False, action=argparse.BooleanOptionalAction)
    p.add_argument("--device", default="esp32-001", help="deviceId or 'auto'")
    p.add_argument("--enroll-secret", default=os.getenv("ENROLL_SECRET"))
    p.add_argument("--reading", type=int, default=42)
    p.add_argument("--ack-on", dest="ack_on", default=False, action=argparse.BooleanOptionalAction)
    p.add_argument("--provision", dest="provision", default=True, action=argparse.BooleanOptionalAction, help="Rotate key before sending")
    args = p.parse_args()

    device_id = auto_device_id() if args.device == "auto" else args.device
    base_url = make_base_url(args.host, args.port, args.https)

    state = load_state()
    api_key = state.get("devices", {}).get(device_id)

    try:
        if args.provision or not api_key:
            api_key = rotate_key(base_url, device_id, args.enroll_secret)
            st = state.get("devices", {})
            st[device_id] = api_key
            state["devices"] = st
            save_state(state)
            print(f"Provisioned apiKey for {device_id}")

        post_reading(base_url, device_id, api_key, args.reading)
        post_ack(base_url, device_id, api_key, args.ack_on)
        print("Done.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
