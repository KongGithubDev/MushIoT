# MushIoT Tester (Python)

A minimal Python utility to simulate ESP32 devices for MushIoT.

It can:
- Rotate/provision an API key: `POST /api/devices/:deviceId/rotate-key`
- Post a reading: `POST /api/readings`
- Post an acknowledgment (ACK): `POST /api/devices/:deviceId/ack`
- Simulate continuous device behavior (auto/manual + hysteresis) with `sim_device.py`
- Perform a lightweight OTA manifest check periodically (simulator only)
  - Sends a one-time `ack` with note `"settings applied"` after the first settings fetch

State (API keys) is cached to `Tester/.tester_state.json`.

## Prerequisites
- Python 3.9+
- Install dependencies:

```bash
pip install -r Tester/requirements.txt
```

## Usage (single-device)
Run the tester against your local API server:

```bash
python Tester/test_device.py --host localhost --port 3000 --device esp32-001 --reading 42 --ack-on
```

Provision with an enrollment secret (if your server requires `x-enroll-secret`):

```bash
python Tester/test_device.py --host localhost --port 3000 \
  --device esp32-001 \
  --enroll-secret YOUR_SECRET
```

Let the script generate a pseudo device ID automatically:

```bash
python Tester/test_device.py --host localhost --port 3000 --device auto
```

Skip provisioning if an API key is already cached locally:

```bash
python Tester/test_device.py --host localhost --port 3000 --device esp32-001 --provision false
```

Call a production/HTTPS server (e.g., Render):

```bash
python Tester/test_device.py --host mushiot.onrender.com --port 443 --https --device esp32-001

### Continuous simulator (close to firmware)

```bash
python Tester/sim_device.py --host localhost --port 3000 --device esp32-sim1 --interval 60
```

Notes:
- Reads settings each cycle and applies auto/manual + thresholds.
- Sends a one-time `ack` with note `"settings applied"` on first settings load.
- Sends `ack` only when the pump state changes.
- Periodically checks OTA manifest and prints available version (no flashing).

Real-time testing (faster stream):

```bash
python Tester/sim_device.py --host localhost --port 3000 --device esp32-sim1 --interval 1
```

## Multi-device simulator

Run multiple virtual devices concurrently:

```bash
python Tester/sim_multi.py --count 5 --host localhost --port 3000 --prefix esp32-sim --interval 7
```

Production HTTPS example:

```bash
python Tester/sim_multi.py --count 3 --host mushiot.onrender.com --port 443 --https --enroll-secret YOUR_SECRET
```
```

## Arguments
- `--host` (string) API host (default `localhost`)
- `--port` (int) API port (default `3000` for local, `443` for HTTPS)
- `--https` (flag) Use HTTPS; if set, default port should be 443
- `--device` (string) Device ID or `auto`
- `--enroll-secret` (string) Enrollment secret; can also be read from env `ENROLL_SECRET`
- `--reading` (int) Moisture percentage to send (default `42`)
- `--ack-on` (flag) Send ACK with `pumpOn=true` (default `false`)
- `--provision` (flag) Rotate/provision an API key before sending (default `true`)

## Notes
- Ensure the backend server is running and the endpoint `/api/health` returns status `ok`.
- If the server enforces enrollment, set `ENROLL_SECRET` in your environment or provide `--enroll-secret`.
- If your device IDs are configured as `auto` on the firmware, the tester's `auto` option can help you simulate similar behavior.
