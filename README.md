# MushIoT

A modern IoT web app to monitor and control mushroom cultivation soil moisture with an ESP32. The frontend is built with Vite + React + Tailwind, the backend is an Express (Node.js) server with MongoDB for storage. Includes an ESP32 Arduino sketch for a capacitive soil moisture sensor, I2C LCD, and relay-driven 12V water pump.

## Tech Stack
- Frontend: React 18, Vite, Tailwind CSS, @tanstack/react-query, Recharts
- Backend: Node.js (Express v5), Helmet, CORS, Morgan, express-rate-limit
- Database: MongoDB via Mongoose
- Device: ESP32 (soil moisture sensor on ADC, 16x2 LCD I2C, relay -> water pump)
- Deployment: Dockerfile included

## Project Structure
```
.
├─ server.js                 # Express server, API endpoints, SPA static serving
├─ src/                      # Frontend (Vite + React + Tailwind)
│  ├─ pages/Dashboard.tsx    # Live data dashboard + device control
│  ├─ components/            # UI components
│  └─ index.css              # Tailwind base and global fonts
├─ arduino/main.ino          # ESP32 firmware: sensor+LCD+relay+API client
├─ .env.example              # Example environment variables
├─ Dockerfile                # Multi-stage build for production
└─ index.html                # Loads fonts (Open Sans, Roboto, Lato)
```

## Features
- Live device readings with polling (5s)
- Global device selection (persisted in URL `?deviceId=`)
- Pump control modes:
  - Auto: moisture hysteresis (onBelow/offAbove)
  - Manual: UI Start/Stop overrides relay
- Device ACK: ESP32 confirms applied mode and relay state (3s)
- MongoDB-backed modules:
  - Alerts (CRUD, mark read/dismiss, mark-all-read)
  - Schedules (CRUD times per device)
  - App Settings (singleton document, PATCH by category)
  - History aggregations (moisture per day; watering count & minutes)
- Security: API Key for device-origin endpoints (`x-api-key`)
- Unified connection model:
  - `online` (server health), `deviceOnline` (latest reading < 30s)
  - `canControl = online && deviceOnline` gates all control actions
- Docker support

## Getting Started

### 1) Prerequisites
- Node.js 18+ (recommended Node 20)
- MongoDB (local or Atlas)
- Arduino IDE (ESP32 boards package installed)

### 2) Environment Variables
Create `.env` from `.env.example` and set:
```
PORT=3000
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/mushiot  # or Atlas URI
MONGODB_DB=mushiot
# CORS
ALLOWED_ORIGINS=http://localhost:3000
# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

# Optional CORS whitelist
ALLOWED_ORIGINS=http://localhost:3000
```

### 3) Install & Run (Production-like)
```
npm install
npm install mongoose dotenv cors helmet morgan express-rate-limit
npm run build
npm run start
```
Visit: http://localhost:3000

Health check: http://localhost:3000/api/health

### 4) Development
- Vite dev server: `npm run dev` (optional)
  - If you use separate dev servers, configure Vite proxy for `/api` (not required in production; Express serves the built app and API from the same origin).

### 5) Docker
```
docker build -t mushiot:prod .
docker run -d --name mushiot -p 3000:3000 --env-file .env mushiot:prod
```
If MongoDB runs on the host, use `MONGODB_URI=mongodb://host.docker.internal:27017/mushiot` in `.env`.

## REST API (Highlights)
- GET `/api/health` -> `{ status: "ok", time }`
- POST `/api/readings`
  - Body JSON: `{ deviceId, moisture?, temperature?, humidity?, co2?, payload? }`
  - Returns: `{ success: true, id }`
- GET `/api/readings?deviceId=esp32-001&limit=50`
  - Returns sorted newest-first
- GET `/api/devices`
  - Returns distinct device IDs
- GET `/api/devices/:deviceId/settings`
  - Returns persisted settings: `{ deviceId, pumpMode, overridePumpOn, pumpOnBelow, pumpOffAbove }`
- PATCH `/api/devices/:deviceId/settings`
  - Partial update of the above fields
- POST `/api/devices/:deviceId/ack`
  - Body JSON: `{ pumpOn: boolean, pumpMode: 'auto'|'manual', note? }`
  - Stored as latest device-applied state
- GET `/api/devices/:deviceId/ack`
  - Returns the latest ACK or `null`

### Security (API Key)
- POST `/api/devices/:deviceId/rotate-key` → `{ deviceId, apiKey }`
  - Use this to generate the key for each device.
- Device-origin endpoints require header: `x-api-key: <DEVICE_API_KEY>`
  - POST `/api/readings`
  - POST `/api/devices/:deviceId/ack`
  - GET `/api/devices/:deviceId/settings` (device polling)

### Alerts (MongoDB)
- GET `/api/alerts?deviceId=...` → list alerts
- POST `/api/alerts` → create alert `{ deviceId, type, severity, title, description }`
- PATCH `/api/alerts/:id` → update `{ isRead?, isActive? }`
- POST `/api/alerts/mark-all-read` → `{ deviceId }`

### Schedules (MongoDB)
- GET `/api/schedules?deviceId=...` → list schedules
- POST `/api/schedules` → `{ deviceId, time:"HH:MM", enabled }`
- PATCH `/api/schedules/:id` → `{ time?, enabled? }`
- DELETE `/api/schedules/:id`

### History Aggregations (MongoDB)
- GET `/api/history/moisture?deviceId=&days=7` → `[{ date, avg, min, max }]`
- GET `/api/history/watering-summary?deviceId=&days=7` → `[{ date, count, minutes }]`

### App Settings (MongoDB, singleton)
- GET `/api/app-settings` → returns full settings document
- PATCH `/api/app-settings` → send section(s): `{ system?, connection?, sensors?, notifications?, account? }`

## ESP32 Firmware (arduino/main.ino)
- Hardware
  - Sensor: Capacitive Soil Moisture -> ESP32 `GPIO34` (ADC)
  - Relay: 2-channel active LOW -> `GPIO25` (IN1)
  - LCD: 16x2 I2C (SDA=21, SCL=22), default address `0x27`
  - Pump: 12V DC + flyback diode (1N4007) across pump terminals
  - COMMON GND between ESP32, relay, sensor, and 12V supply
- Configuration
  - Set `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_HOST` (PC LAN IP), `SERVER_PORT`
  - Set `DEVICE_ID` (e.g., `esp32-001`)
  - Rotate API key from server and set `DEVICE_API_KEY`
    - `POST /api/devices/<DEVICE_ID>/rotate-key`
    - Copy `apiKey` into `DEVICE_API_KEY`
  - Calibrate `DRY_ADC`, `WET_ADC`
  - Hysteresis: `PUMP_ON_BELOW`, `PUMP_OFF_ABOVE` (defaults 35/45)
- Behavior
  - Poll settings every 3s: `GET /api/devices/<id>/settings`
    - Auto -> uses hysteresis; Manual -> overrides relay by `overridePumpOn`
  - Send readings every 10s: `POST /api/readings`
  - Send ACK on state change or after applying settings: `POST /api/devices/<id>/ack`
  - LCD shows moisture and pump state, or "Not connected" on WiFi loss

## Frontend
- Dashboard (`src/pages/Dashboard.tsx`):
  - Live readings chart, current moisture
  - Pump mode toggle (Auto/Manual) and Start/Stop button
  - Shows device ACK confirmation ("Command applied on device") when Manual override matches device state
- Alerts (`src/pages/Alerts.tsx`): loads from DB, mark read/dismiss, mark-all-read
- Control Panel (`src/pages/ControlPanel.tsx`): Schedules CRUD (MongoDB), control UI gated by `canControl`
- History (`src/pages/History.tsx`):
  - Events table from `/api/watering`
  - Charts from `/api/history/moisture` and `/api/history/watering-summary`
  - Weekly summary computed from aggregation results
- Settings (`src/pages/Settings.tsx`): App Settings load/save via `/api/app-settings`

## Wiring (Summary)
- Soil Sensor: `VCC->3.3V`, `GND->GND`, `AOUT->GPIO34`
- Relay: `VCC->5V`, `GND->GND`, `IN1->GPIO25` (LOW=ON)
- Pump: `12V+ -> Pump+`, `Pump- -> Relay NO`, `Relay COM -> 12V-`
- Diode: 1N4007 across pump terminals (stripe to +)
- LCD I2C: `VCC->3.3V` (or 5V if needed), `GND->GND`, `SDA->21`, `SCL->22`

## Notes & Safety
- Do not power ESP32 from 12V.
- Ensure flyback diode installed across the pump.
- If relay triggers unreliably with 3.3V logic, use a 3.3V-compatible relay or a transistor driver.

## Troubleshooting
- Device shows Offline but Server Online:
  - Ensure ESP32 posts a reading at least once every 30s (configurable window)
- 401/403 on device POSTs:
  - Make sure `x-api-key` header matches server’s rotated key for the `DEVICE_ID`
- CORS errors in browser:
  - Add your frontend origin to `ALLOWED_ORIGINS` in `.env`

## License
MIT © 2025 Watcharapong Namsaeng — see [`LICENSE`](./LICENSE)
