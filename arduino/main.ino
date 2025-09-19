// MushIoT ESP32: real hardware integration for soil moisture, LCD, relay pump, and API posting

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ==== USER CONFIG =====================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server where Node.js runs. For local dev, replace with your PC's LAN IP.
// Example: 192.168.1.10 and port 3000
const char* SERVER_HOST = "192.168.1.100"; // <- CHANGE ME
const uint16_t SERVER_PORT = 3000;          // matches PORT in .env or default 3000

// Device identifier
const char* DEVICE_ID = "esp32-001";
// API key for this device (set from server rotate-key response)
const char* DEVICE_API_KEY = "CHANGE_ME_API_KEY";

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

unsigned long lastSend = 0;
unsigned long lastSettingsPoll = 0;
bool pumpOn = false;
unsigned long pumpLastChanged = 0;

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

// ========== Settings fetching (simple JSON parsing) ==========
bool g_isManualMode = false;      // auto by default
bool g_overridePumpOn = false;
int  g_onBelow = -1;              // -1 means use local default
int  g_offAbove = -1;

void postAck(bool currentPumpOn, const char* mode, const char* note) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/api/devices/" + DEVICE_ID + "/ack";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_API_KEY);
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
  String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/api/devices/" + DEVICE_ID + "/settings";
  http.begin(url);
  http.addHeader("x-api-key", DEVICE_API_KEY);
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
  }
  Serial.print("\nWiFi connected. IP: ");
  Serial.println(WiFi.localIP());
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
  extern bool g_isManualMode;
  postAck(on, g_isManualMode ? "manual" : "auto", "relay state changed");
}

void controlPump(int moisturePercent) {
  unsigned long now = millis();

  // If manual override is enabled globally, apply and return
  // We'll update these globals from server settings in fetchSettings()
  extern bool g_isManualMode;     // declared below
  extern bool g_overridePumpOn;   // declared below
  extern int g_onBelow;
  extern int g_offAbove;

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
  String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/api/readings";
  http.begin(url);
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
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    postReading(raw, percent);
  }

  delay(250);
}
