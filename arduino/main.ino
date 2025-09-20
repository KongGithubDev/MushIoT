// MushIoT ESP32: real hardware integration for soil moisture, LCD, relay pump, and API posting

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <HTTPUpdate.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ==== USER CONFIG =====================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Choose one of the following deployment targets:
// - Local development (HTTP): e.g., SERVER_HOST = "192.168.1.100", SERVER_PORT = 3000, SERVER_USE_HTTPS = false
// - Render production (HTTPS): SERVER_HOST = "mushiot.onrender.com", SERVER_PORT = 443, SERVER_USE_HTTPS = true
const char* SERVER_HOST = "mushiot.onrender.com"; // or your local IP, e.g., "192.168.1.100"
const uint16_t SERVER_PORT = 443;                 // 3000 for local, 443 for Render
const bool SERVER_USE_HTTPS = true;               // true for Render, false for local

// Firmware version (used for OTA check)
const char* FW_VERSION = "1.0.0";

// Device identifier
// Use "auto" to derive from WiFi MAC (e.g., esp32-a1b2c3)
char DEVICE_ID[32] = "auto";
// API key for this device (persisted in NVS after provisioning)
// For first boot/provisioning, leave as placeholder. Code will fetch and store a real key.
char DEVICE_API_KEY[96] = "CHANGE_ME_API_KEY";
// Optional enrollment secret (must match server ENROLL_SECRET) for secure provisioning
const char* ENROLL_SECRET = ""; // leave empty if server doesn't require it

// Optional root CA certificate for strict TLS (leave empty to use setInsecure())
// Provide PEM string if you want strict TLS verification
const char* ROOT_CA_PEM = "";

// Moisture sensor analog pin (ESP32 ADC). Use GPIO34 (input-only)
const int PIN_SOIL_ADC = 34;

// Relay control pin (active LOW). IN1 on 2-channel relay module
const int PIN_RELAY_PUMP = 25;

// LCD I2C address and pins (ESP32 default SDA=21, SCL=22)
LiquidCrystal_I2C lcd(0x27, 16, 2); // If nothing shows, try 0x3F

// Calibration values for capacitive sensor (ADC range 0..4095)
// Measure your sensor's raw values: insert in dry air (DRY_ADC) and in water (WET_ADC)
int DRY_ADC = 3200;  // example, adjust after calibration
int WET_ADC = 1400;  // example, adjust after calibration

// Control thresholds (percent) with hysteresis
int PUMP_ON_BELOW = 35;   // turn pump ON when moisture% < 35
int PUMP_OFF_ABOVE = 45;  // turn pump OFF when moisture% > 45

// Ensure a minimum ON time to protect pump
const unsigned long MIN_PUMP_ON_MS = 5000; // 5 seconds

// Send interval in milliseconds
const unsigned long SEND_INTERVAL_MS = 10000; // 10 seconds
// Poll settings interval
const unsigned long SETTINGS_POLL_MS = 3000; // 3 seconds
// =====================================

// Runtime state
unsigned long lastSend = 0;
unsigned long lastSettingsPoll = 0;
unsigned long lastOtaCheck = 0;
bool pumpOn = false;
unsigned long pumpLastChanged = 0;

// ========== Settings fetching (simple JSON parsing) ==========
bool g_isManualMode = false;      // auto by default
bool g_overridePumpOn = false;
int  g_onBelow = -1;              // -1 means use local default
int  g_offAbove = -1;

Preferences prefs;

// Build base URL helper
String baseUrl() {
  String proto = SERVER_USE_HTTPS ? "https://" : "http://";
  String host = String(SERVER_HOST);
  if ((SERVER_USE_HTTPS && SERVER_PORT != 443) || (!SERVER_USE_HTTPS && SERVER_PORT != 80)) {
    host += ":" + String(SERVER_PORT);
  }

// ===== OTA update =====
bool parseManifest(const String &body, String &version, String &url) {
  // naive string parsing for {"version":"x","url":"y"}
  int kv = body.indexOf("\"version\"");
  int ku = body.indexOf("\"url\"");
  if (kv < 0 || ku < 0) return false;
  int cv = body.indexOf(':', kv); int q1v = body.indexOf('"', cv + 1); int q2v = body.indexOf('"', q1v + 1);
  int cu = body.indexOf(':', ku); int q1u = body.indexOf('"', cu + 1); int q2u = body.indexOf('"', q1u + 1);
  if (q1v < 0 || q2v < 0 || q1u < 0 || q2u < 0) return false;
  version = body.substring(q1v + 1, q2v); version.trim();
  url = body.substring(q1u + 1, q2u); url.trim();
  return version.length() > 0 && url.length() > 0;
}

void checkForOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = baseUrl() + "/api/ota/manifest";
  if (!beginHttp(http, url)) return;
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    String ver, binUrl;
    if (parseManifest(body, ver, binUrl)) {
      if (ver != String(FW_VERSION)) {
        Serial.print("OTA: new version available "); Serial.println(ver);
        WiFiClientSecure secureClient;
        WiFiClient *client = makeHttpClientForUpdate(secureClient);
        t_httpUpdate_return ret = httpUpdate.update(*client, binUrl);
        if (ret == HTTP_UPDATE_OK) {
          Serial.println("OTA: update success, rebooting...");
        } else {
          Serial.printf("OTA: update failed, code=%d\n", (int)ret);
        }
      }
    }
  }
  http.end();
}
  return proto + host;
}

// Create HTTP/HTTPS client begin helper
bool beginHttp(HTTPClient &http, const String &url) {
  if (SERVER_USE_HTTPS) {
    static WiFiClientSecure secureClient;
    if (ROOT_CA_PEM && strlen(ROOT_CA_PEM) > 0) secureClient.setCACert(ROOT_CA_PEM);
    else secureClient.setInsecure(); // WARNING: accepts any certificate (OK for hobby projects)
    return http.begin(secureClient, url);
  } else {
    return http.begin(url);
  }
}

WiFiClient *makeHttpClientForUpdate(WiFiClientSecure &secureOut) {
  if (SERVER_USE_HTTPS) {
    if (ROOT_CA_PEM && strlen(ROOT_CA_PEM) > 0) secureOut.setCACert(ROOT_CA_PEM);
    else secureOut.setInsecure();
    return &secureOut;
  } else {
    return new WiFiClient(); // will be leaked intentionally if used, but update reboots; acceptable for OTA
  }
}

void postAck(bool currentPumpOn, const char* mode, const char* note) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = baseUrl() + "/api/devices/" + DEVICE_ID + "/ack";
  if (!beginHttp(http, url)) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", String(DEVICE_API_KEY));
  String body = String("{") +
    "\"pumpOn\":" + (currentPumpOn ? "true" : "false") + "," +
    "\"pumpMode\":\"" + mode + "\"," +
    "\"note\":\"" + note + "\"" +
  "}";
  http.POST(body);
  http.end();
}

bool parseBool(const String &src, const char *key, bool &outVal) {
  int k = src.indexOf(String("\"") + key + "\"");
  if (k < 0) return false;
  int c = src.indexOf(':', k);
  if (c < 0) return false;
  int t = src.indexOf("true", c);
  int f = src.indexOf("false", c);
  if (t >= 0 && (f < 0 || t < f)) { outVal = true; return true; }
  if (f >= 0 && (t < 0 || f < t)) { outVal = false; return true; }
  return false;
}

bool parseIntField(const String &src, const char *key, int &outVal) {
  int k = src.indexOf(String("\"") + key + "\"");
  if (k < 0) return false;
  int c = src.indexOf(':', k);
  if (c < 0) return false;
  // find end (comma or })
  int e1 = src.indexOf(',', c + 1);
  int e2 = src.indexOf('}', c + 1);
  int e = (e1 >= 0 && e2 >= 0) ? min(e1, e2) : max(e1, e2);
  if (e < 0) e = src.length();
  String num = src.substring(c + 1, e);
  num.trim();
  if (num.length() == 0) return false;
  outVal = num.toInt();
  return true;
}

bool parsePumpMode(const String &src, bool &isManual) {
  int k = src.indexOf("\"pumpMode\"");
  if (k < 0) return false;
  int c = src.indexOf(':', k);
  int q1 = src.indexOf('"', c + 1);
  int q2 = src.indexOf('"', q1 + 1);
  if (q1 < 0 || q2 < 0) return false;
  String val = src.substring(q1 + 1, q2);
  val.trim();
  isManual = (val == "manual");
  return true;
}

void fetchSettings() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = baseUrl() + "/api/devices/" + DEVICE_ID + "/settings";
  if (!beginHttp(http, url)) return;
  http.addHeader("x-api-key", String(DEVICE_API_KEY));
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    bool isManual;
    bool overrideOn;
    int onBelow;
    int offAbove;
    if (parsePumpMode(body, isManual)) g_isManualMode = isManual;
    if (parseBool(body, "overridePumpOn", overrideOn)) g_overridePumpOn = overrideOn;
    if (parseIntField(body, "pumpOnBelow", onBelow)) g_onBelow = onBelow;
    if (parseIntField(body, "pumpOffAbove", offAbove)) g_offAbove = offAbove;
    // ACK that settings were applied
    postAck(pumpOn, g_isManualMode ? "manual" : "auto", "settings applied");
  }
  http.end();
}

void connectWiFi() {
  Serial.print("Connecting to WiFi ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    retries++;
    if (retries > 60) { // ~30 seconds
      Serial.println("\nFailed to connect to WiFi, restarting...");
      ESP.restart();
    }
  }
  Serial.print("\nWiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

// ====== Device provisioning: get/restore API key from NVS or server ======
bool parseApiKey(const String &src, String &out) {
  int k = src.indexOf("\"apiKey\"");
  if (k < 0) return false;
  int c = src.indexOf(':', k);
  int q1 = src.indexOf('"', c + 1);
  int q2 = src.indexOf('"', q1 + 1);
  if (q1 < 0 || q2 < 0) return false;
  out = src.substring(q1 + 1, q2);
  out.trim();
  return out.length() > 0;
}

void loadApiKeyFromStorage() {
  prefs.begin("mushiot", true);
  String saved = prefs.getString("apiKey", "");
  prefs.end();
  if (saved.length() > 0) {
    saved.toCharArray(DEVICE_API_KEY, sizeof(DEVICE_API_KEY));
    Serial.println("Loaded API key from NVS");
  }
}

void saveApiKeyToStorage(const String &key) {
  prefs.begin("mushiot", false);
  prefs.putString("apiKey", key);
  prefs.end();
  key.toCharArray(DEVICE_API_KEY, sizeof(DEVICE_API_KEY));
  Serial.println("Saved API key to NVS");
}

bool provisionApiKeyIfNeeded() {
  if (String(DEVICE_API_KEY) != "CHANGE_ME_API_KEY" && String(DEVICE_API_KEY).length() > 10) {
    return true; // already provisioned
  }
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = baseUrl() + "/api/devices/" + DEVICE_ID + "/rotate-key";
  if (!beginHttp(http, url)) return false;
  if (String(ENROLL_SECRET).length() > 0) {
    http.addHeader("x-enroll-secret", ENROLL_SECRET);
  }
  int code = http.POST("");
  bool ok = false;
  if (code == 200) {
    String body = http.getString();
    String key;
    if (parseApiKey(body, key)) {
      saveApiKeyToStorage(key);
      ok = true;
    }
  }
  http.end();
  return ok;
}

int readSoilRaw() {
  // For ESP32, you may set attenuation if needed to linearize reading
  // analogSetPinAttenuation(PIN_SOIL_ADC, ADC_11db);
  int val = analogRead(PIN_SOIL_ADC);
  return val;
}

int toPercent(int raw) {
  // Map raw ADC to percentage (0=dry, 100=wet). Adjust DRY_ADC/WET_ADC accordingly
  // Handle WET_ADC < DRY_ADC typical for many capacitive sensors
  long percent = map(raw, DRY_ADC, WET_ADC, 0, 100);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return (int)percent;
}

void setPump(bool on) {
  pumpOn = on;
  pumpLastChanged = millis();
  // Active LOW relay module: LOW=ON, HIGH=OFF
  digitalWrite(PIN_RELAY_PUMP, on ? LOW : HIGH);
  // Send ACK when state changes
  postAck(on, g_isManualMode ? "manual" : "auto", "relay state changed");
}

void controlPump(int moisturePercent) {
  unsigned long now = millis();

  // If manual override is enabled globally, apply and return
  // We'll update these globals from server settings in fetchSettings()

  // Update thresholds with server-provided ones (if any)
  if (g_onBelow >= 0) PUMP_ON_BELOW = g_onBelow;
  if (g_offAbove >= 0) PUMP_OFF_ABOVE = g_offAbove;

  if (g_isManualMode) {
    // In manual, force relay according to overridePumpOn
    if (g_overridePumpOn && !pumpOn) setPump(true);
    else if (!g_overridePumpOn && pumpOn) setPump(false);
    return;
  }

  if (!pumpOn && moisturePercent < PUMP_ON_BELOW) {
    setPump(true);
  }

  if (pumpOn) {
    // Enforce minimum ON time
    bool minOnElapsed = now - pumpLastChanged >= MIN_PUMP_ON_MS;
    if (minOnElapsed && moisturePercent > PUMP_OFF_ABOVE) {
      setPump(false);
    }
  }
}

void updateLCD(int raw, int percent) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MushIoT v1.0   ");
  // Show WiFi status / Device
  if (WiFi.status() == WL_CONNECTED) {
    lcd.setCursor(0, 1);
    lcd.print("Soil:");
    lcd.print(percent);
    lcd.print("% ");
    lcd.print(pumpOn ? "Pump:ON " : "Pump:OFF");
  } else {
    lcd.setCursor(0, 1);
    lcd.print("Not connected   ");
  }
}

String buildJsonPayload(int raw, int percent) {
  // Build minimal JSON manually
  String json = "{";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"moisture\":" + String(percent) + ",";
  json += "\"payload\":{\"raw\":" + String(raw) + ",\"pumpOn\":" + String(pumpOn ? "true" : "false") + "}";
  json += "}";
  return json;
}

bool postReading(int raw, int percent) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skip send");
    return false;
  }

  HTTPClient http;
  String url = baseUrl() + "/api/readings";
  if (!beginHttp(http, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_API_KEY);

  String payload = buildJsonPayload(raw, percent);
  int httpCode = http.POST(payload);

  Serial.print("POST ");
  Serial.print(url);
  Serial.print(" -> ");
  Serial.println(httpCode);

  if (httpCode > 0) {
    String resp = http.getString();
    Serial.println(resp);
  } else {
    Serial.print("HTTP POST failed, error: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
  return httpCode == 201 || httpCode == 200;
}

void setup() {
  Serial.begin(115200);
  delay(300);

  // Pins
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  // Default OFF
  digitalWrite(PIN_RELAY_PUMP, HIGH);

  // I2C LCD
  Wire.begin(21, 22); // SDA=21, SCL=22 (default on many ESP32 boards)
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MushIoT v1.0");
  lcd.setCursor(0, 1);
  lcd.print("Connecting WiFi");

  connectWiFi();

  // If DEVICE_ID is "auto", derive from MAC (last 3 bytes)
  if (String(DEVICE_ID) == "auto") {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(DEVICE_ID, sizeof(DEVICE_ID), "esp32-%02x%02x%02x", mac[3], mac[4], mac[5]);
    Serial.print("Derived DEVICE_ID: ");
    Serial.println(DEVICE_ID);
  }

  // Load previously stored API key (if any) and provision if needed
  loadApiKeyFromStorage();
  if (!provisionApiKeyIfNeeded()) {
    Serial.println("Warning: API key provisioning failed. Will retry in loop.");
  }
}

void loop() {
  // Optional: reconnect if WiFi dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  int raw = readSoilRaw();
  int percent = toPercent(raw);
  controlPump(percent);
  updateLCD(raw, percent);

  unsigned long now = millis();
  // Poll settings
  if (now - lastSettingsPoll >= SETTINGS_POLL_MS) {
    lastSettingsPoll = now;
    fetchSettings();
  }
  // Periodic OTA check (every 1 hour)
  if (now - lastOtaCheck >= 3600000UL) {
    lastOtaCheck = now;
    checkForOtaUpdate();
  }
  // If key not yet provisioned, retry periodically
  if (String(DEVICE_API_KEY) == "CHANGE_ME_API_KEY") {
    provisionApiKeyIfNeeded();
  }
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    postReading(raw, percent);
  }

  delay(250);
}
