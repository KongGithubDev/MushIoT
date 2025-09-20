#!/usr/bin/env python3
"""
Run multiple ESP32 simulators concurrently.

Examples:
  python Tester/sim_multi.py --count 5 --host localhost --port 3000 --prefix esp32-sim --interval 7
  python Tester/sim_multi.py --count 3 --host mushiot.onrender.com --port 443 --https --enroll-secret SECRET

This script spawns multiple subprocesses, each running sim_device.py with a unique deviceId.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
SIM_PATH = THIS_DIR / "sim_device.py"


def main():
    p = argparse.ArgumentParser(description="Run multiple ESP32 simulators")
    p.add_argument("--count", type=int, default=3)
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=3000)
    p.add_argument("--https", dest="https", default=False, action=argparse.BooleanOptionalAction)
    p.add_argument("--prefix", default="esp32-sim")
    p.add_argument("--interval", type=float, default=10.0)
    p.add_argument("--enroll-secret", default=os.getenv("ENROLL_SECRET"))
    p.add_argument("--seed", type=int, default=None, help="base seed; each device uses seed+i")
    args = p.parse_args()

    procs = []

    def launch(i: int):
        device_id = f"{args.prefix}{i+1}"
        cmd = [sys.executable, str(SIM_PATH),
               "--host", args.host,
               "--port", str(args.port),
               "--device", device_id,
               "--interval", str(args.interval)]
        if args.https:
            cmd.append("--https")
        if args.enroll_secret:
            cmd += ["--enroll-secret", args.enroll_secret]
        if args.seed is not None:
            cmd += ["--seed", str(args.seed + i)]
        print("[spawn]", " ".join(cmd))
        proc = subprocess.Popen(cmd)
        return proc

    try:
        for i in range(max(1, args.count)):
            procs.append(launch(i))
            time.sleep(0.3)  # slight stagger
        print(f"[info] launched {len(procs)} simulators. Press Ctrl+C to stop.")
        # Wait until interrupted
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[stop] stopping all simulators...")
    finally:
        for proc in procs:
            try:
                proc.send_signal(signal.SIGINT)
            except Exception:
                pass
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        print("[done]")


if __name__ == "__main__":
    main()
