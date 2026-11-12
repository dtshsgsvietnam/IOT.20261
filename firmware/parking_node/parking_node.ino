/*
 * ============================================================
 *  SMART PARKING - ESP32 PARKING NODE
 * ============================================================
 *  Hardware : ESP32 DevKit V1 (30 pins)
 *             5x IR obstacle sensors (2 gates + 3 parking slots)
 *             1x LCD 16x2 I2C
 *             2x servo barriers (manual test only, not automated yet)
 *
 *  Features : - Read 5 IR sensors with per-sensor debounce
 *             - Rotate 3 LCD pages (slots / gates / network)
 *             - Publish state changes to the MQTT broker
 *             - Keep working offline: LCD and sensor logic never
 *               depend on Wi-Fi or the server
 *
 *  Libraries (install via Library Manager):
 *             LiquidCrystal I2C  (Frank de Brabander)  1.1.2
 *             ESP32Servo         (Kevin Harrington)    3.0.x
 *             PubSubClient       (Nick O'Leary)        2.8
 *
 *  Setup    : copy config.example.h to config.h, then fill in
 *             Wi-Fi credentials and the broker IP.
 *
 *  MQTT contract: see docs/mqtt-topics.md. Do not change topics or
 *  payloads here without updating the backend as well.
 * ============================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"

// ============================================================
// 1. PINS AND HARDWARE
// ============================================================
const uint8_t PIN_IR_GATE_IN  = 32;
const uint8_t PIN_IR_GATE_OUT = 33;
const uint8_t PIN_IR_SLOT1    = 34;   // input-only pin, no internal pull-up
const uint8_t PIN_IR_SLOT2    = 35;   // input-only pin, no internal pull-up
const uint8_t PIN_IR_SLOT3    = 27;
const uint8_t PIN_SERVO_IN    = 25;
const uint8_t PIN_SERVO_OUT   = 26;
const uint8_t PIN_I2C_SDA     = 21;
const uint8_t PIN_I2C_SCL     = 22;

// Most IR obstacle modules pull OUT low when an object is detected.
// If the readings are inverted, change this to HIGH.
const int IR_DETECTED_LEVEL = LOW;

// Common I2C addresses for 16x2 LCD backpacks are 0x27 and 0x3F.
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo servoIn;
Servo servoOut;

// ============================================================
// 2. SENSOR TABLE
// ============================================================
// All sensors live in one array so they share the same debounce logic.
// Index layout: 0 = gate in, 1 = gate out, 2..4 = slot 1..3
const uint8_t N_SENSORS    = 5;
const uint8_t N_SLOTS      = 3;
const uint8_t IDX_GATE_IN  = 0;
const uint8_t IDX_GATE_OUT = 1;
const uint8_t IDX_SLOT1    = 2;

const uint8_t sensorPins[N_SENSORS] = {
  PIN_IR_GATE_IN, PIN_IR_GATE_OUT, PIN_IR_SLOT1, PIN_IR_SLOT2, PIN_IR_SLOT3
};
const char *sensorNames[N_SENSORS] = {
  "Cong vao", "Cong ra", "Slot 1", "Slot 2", "Slot 3"
};

/*
 * Debounce: a new state is accepted only after N consecutive reads agree.
 * With a 150 ms read period:
 *   - gates: 2 reads = 300 ms -> fast enough to catch a passing car
 *   - slots: 6 reads = 900 ms -> ignores people walking by and cars
 *                                 maneuvering in/out of the slot
 * Without this, a single passer-by would toggle a slot free -> occupied
 * -> free and flood the broker with meaningless messages.
 */
const uint8_t debounceReads[N_SENSORS] = {2, 2, 6, 6, 6};

bool    detected[N_SENSORS]      = {};   // confirmed (debounced) state
uint8_t mismatchCount[N_SENSORS] = {};   // consecutive reads that differ from it

// ============================================================
// 3. TIMING (ms)
// ============================================================
const unsigned long SENSOR_READ_MS       = 150;
const unsigned long LCD_PAGE_MS          = 2500;
const unsigned long HEARTBEAT_MS         = 30000;
const unsigned long WIFI_RETRY_MS        = 10000;
const unsigned long MQTT_RETRY_MS        = 3000;
const unsigned long WIFI_BOOT_TIMEOUT_MS = 8000;

unsigned long lastSensorRead = 0;
unsigned long lastLcdPage    = 0;
unsigned long lastHeartbeat  = 0;
unsigned long lastWifiTry    = 0;
unsigned long lastMqttTry    = 0;

// ============================================================
// 4. MQTT CLIENT
// ============================================================
WiFiClient   netClient;
PubSubClient mqtt(netClient);

char topicStatus[64];   // parking/device/<DEVICE_ID>/status

// ============================================================
// 5. HELPERS
// ============================================================
// Convert a sensor index (2..4) to a slot number (1..3).
uint8_t slotNumber(uint8_t sensorIdx) {
  return sensorIdx - IDX_SLOT1 + 1;
}

int freeSlots() {
  int used = 0;
  for (uint8_t i = IDX_SLOT1; i < N_SENSORS; i++) {
    if (detected[i]) used++;
  }
  return N_SLOTS - used;
}

// ============================================================
// 6. LCD
// ============================================================
uint8_t lcdPage = 0;   // 0: slots | 1: gates | 2: network

// Overwrite a full row padded with spaces instead of calling lcd.clear(),
// which causes visible flicker.
void lcdLine(uint8_t row, const char *text) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void showLcd() {
  char line0[24], line1[24];

  if (lcdPage == 0) {
    snprintf(line0, sizeof(line0), "CHO TRONG: %d/%u", freeSlots(), N_SLOTS);
    snprintf(line1, sizeof(line1), "S1:%c S2:%c S3:%c",
             detected[IDX_SLOT1]     ? 'X' : 'O',
             detected[IDX_SLOT1 + 1] ? 'X' : 'O',
             detected[IDX_SLOT1 + 2] ? 'X' : 'O');
  } else if (lcdPage == 1) {
    snprintf(line0, sizeof(line0), "IR VAO: %s", detected[IDX_GATE_IN]  ? "CO XE" : "KHONG");
    snprintf(line1, sizeof(line1), "IR RA : %s", detected[IDX_GATE_OUT] ? "CO XE" : "KHONG");
  } else {
    bool wifiOk = WiFi.status() == WL_CONNECTED;
    snprintf(line0, sizeof(line0), "WiFi:%s MQTT:%s",
             wifiOk ? "OK" : "--", mqtt.connected() ? "OK" : "--");
    if (wifiOk) snprintf(line1, sizeof(line1), "%s", WiFi.localIP().toString().c_str());
    else        snprintf(line1, sizeof(line1), "Chay cuc bo");
  }

  lcdLine(0, line0);
  lcdLine(1, line1);
}

// ============================================================
// 7. MQTT PUBLISH
// ============================================================
// Slot state and lot summary are RETAINED: a client that subscribes later
// (e.g. a freshly opened dashboard) receives the current state immediately.
// Gate messages are NOT retained: they are one-off events, not state.

void publishSlot(uint8_t slotNo, bool occupied) {
  if (!mqtt.connected()) return;

  char topic[64], payload[128];
  snprintf(topic, sizeof(topic), "parking/slot/%u/state", slotNo);
  snprintf(payload, sizeof(payload),
           "{\"slot\":%u,\"state\":\"%s\",\"device\":\"%s\",\"uptime\":%lu}",
           slotNo, occupied ? "occupied" : "free", DEVICE_ID, millis() / 1000);
  mqtt.publish(topic, payload, true);
}

void publishGate(const char *gate, bool carDetected) {
  if (!mqtt.connected()) return;

  char topic[64], payload[128];
  snprintf(topic, sizeof(topic), "parking/gate/%s/event", gate);
  snprintf(payload, sizeof(payload),
           "{\"gate\":\"%s\",\"detected\":%s,\"device\":\"%s\",\"uptime\":%lu}",
           gate, carDetected ? "true" : "false", DEVICE_ID, millis() / 1000);
  mqtt.publish(topic, payload, false);
}

void publishSummary() {
  if (!mqtt.connected()) return;

  char payload[128];
  snprintf(payload, sizeof(payload),
           "{\"total\":%u,\"free\":%d,\"device\":\"%s\",\"uptime\":%lu}",
           N_SLOTS, freeSlots(), DEVICE_ID, millis() / 1000);
  mqtt.publish("parking/lot/summary", payload, true);
}

// Re-send the full state, used after every (re)connect so the broker
// never keeps stale retained values from before the outage.
void publishAll() {
  for (uint8_t i = IDX_SLOT1; i < N_SENSORS; i++) {
    publishSlot(slotNumber(i), detected[i]);
  }
  publishSummary();
}

// ============================================================
// 8. CONNECTION MANAGEMENT
// ============================================================
// Both functions are non-blocking: they return immediately if a retry
// is not due yet, so loop() keeps reading sensors and updating the LCD
// even when the network is down.

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry = millis();

  Serial.println("[WiFi] dang thu ket noi lai...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) return;
  if (millis() - lastMqttTry < MQTT_RETRY_MS) return;
  lastMqttTry = millis();

  Serial.printf("[MQTT] ket noi %s ... ", MQTT_BROKER);

  /*
   * Last Will and Testament: if the ESP32 loses power or network, the
   * broker publishes "offline" (retained) on topicStatus on our behalf.
   * This lets the dashboard tell "slot is free" apart from "sensor is dead".
   */
  bool ok;
  if (strlen(MQTT_USER) > 0) {
    ok = mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASSWORD, topicStatus, 1, true, "offline");
  } else {
    ok = mqtt.connect(DEVICE_ID, topicStatus, 1, true, "offline");
  }

  if (ok) {
    Serial.println("OK");
    mqtt.publish(topicStatus, "online", true);
    publishAll();
  } else {
    Serial.printf("THAT BAI, rc=%d\n", mqtt.state());
  }
}

// ============================================================
// 9. SENSOR READING
// ============================================================
void readSensors() {
  bool changed = false;

  for (uint8_t i = 0; i < N_SENSORS; i++) {
    bool raw = digitalRead(sensorPins[i]) == IR_DETECTED_LEVEL;

    // Reading agrees with the confirmed state: reset the counter.
    if (raw == detected[i]) {
      mismatchCount[i] = 0;
      continue;
    }

    // Reading differs: only accept it after enough consecutive reads.
    mismatchCount[i]++;
    if (mismatchCount[i] < debounceReads[i]) continue;

    detected[i]      = raw;
    mismatchCount[i] = 0;
    changed          = true;

    Serial.printf("%s: %s\n", sensorNames[i], raw ? "PHAT HIEN XE" : "KHONG CO XE");

    if (i >= IDX_SLOT1) publishSlot(slotNumber(i), raw);
    else                publishGate(i == IDX_GATE_IN ? "in" : "out", raw);
  }

  if (changed) {
    publishSummary();
    showLcd();
  }
}

// ============================================================
// 10. SERIAL COMMANDS (debug)
// ============================================================
// Blocks for ~2.5 s because of delay(). Acceptable here since it is only
// triggered manually from the Serial Monitor for hardware testing.
void testServo(uint8_t pin, Servo &motor, const char *name) {
  Serial.printf("Dang test %s\n", name);
  motor.setPeriodHertz(50);
  motor.attach(pin, 500, 2400);
  motor.write(0);   delay(700);
  motor.write(75);  delay(900);
  motor.write(0);   delay(900);
  motor.detach();
  Serial.println("Da test xong. Neu servo khong quay, kiem tra 5V/GND/SIGNAL.");
}

void printSensorStatus() {
  for (uint8_t i = 0; i < N_SENSORS; i++) {
    Serial.printf("%-9s (GPIO%2u): %s\n",
                  sensorNames[i], sensorPins[i], detected[i] ? "CO XE" : "TRONG");
  }
  Serial.printf("Cho trong: %d/%u\n", freeSlots(), N_SLOTS);
}

void printNetworkStatus() {
  Serial.printf("Wi-Fi: %s  IP: %s  MQTT: %s (rc=%d)\n",
                WiFi.status() == WL_CONNECTED ? "OK" : "MAT",
                WiFi.localIP().toString().c_str(),
                mqtt.connected() ? "OK" : "MAT", mqtt.state());
}

void handleSerialCommands() {
  while (Serial.available()) {
    char cmd = Serial.read();
    switch (cmd) {
      case '1':           testServo(PIN_SERVO_IN,  servoIn,  "CONG VAO"); break;
      case '2':           testServo(PIN_SERVO_OUT, servoOut, "CONG RA");  break;
      case 's': case 'S': printSensorStatus();  break;
      case 'w': case 'W': printNetworkStatus(); break;
      default: break;   // ignore newline and unknown characters
    }
  }
}

// ============================================================
// 11. SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(800);   // give the Serial Monitor time to attach

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  lcd.init();
  lcd.backlight();
  lcdLine(0, "Smart Parking");
  lcdLine(1, "Dang khoi dong");

  /*
   * GPIO34/35 are input-only and have NO internal pull-up, so they must use
   * INPUT. If the IR module has an open-collector NPN output (e.g. E18-D80NK),
   * add an external 10k resistor from OUT to 3V3 on these two pins, otherwise
   * the reading floats. The other pins use the internal pull-up.
   */
  for (uint8_t i = 0; i < N_SENSORS; i++) {
    bool inputOnly = sensorPins[i] == 34 || sensorPins[i] == 35;
    pinMode(sensorPins[i], inputOnly ? INPUT : INPUT_PULLUP);
    detected[i]      = digitalRead(sensorPins[i]) == IR_DETECTED_LEVEL;
    mismatchCount[i] = 0;
  }

  snprintf(topicStatus, sizeof(topicStatus), "parking/device/%s/status", DEVICE_ID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setKeepAlive(15);

  // Wait for Wi-Fi with a timeout, never forever: the node must still
  // work locally if the network is unavailable. ensureWifi() retries later.
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_BOOT_TIMEOUT_MS) {
    delay(250);
  }

  Serial.println("\n=== SMART PARKING ESP32 ===");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi OK, IP = %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("Chua co Wi-Fi - chay o che do cuc bo, se tu thu lai.");
  }
  Serial.println("Lenh Serial:  1 = test servo VAO | 2 = test servo RA");
  Serial.println("              s = in trang thai  | w = in thong tin mang");
  Serial.println("X = co xe; O = trong.");

  showLcd();
}

// ============================================================
// 12. MAIN LOOP (non-blocking, scheduled with millis())
// ============================================================
void loop() {
  ensureWifi();
  ensureMqtt();
  mqtt.loop();

  handleSerialCommands();

  if (millis() - lastSensorRead >= SENSOR_READ_MS) {
    lastSensorRead = millis();
    readSensors();
  }

  if (millis() - lastLcdPage >= LCD_PAGE_MS) {
    lastLcdPage = millis();
    lcdPage = (lcdPage + 1) % 3;
    showLcd();
  }

  // Heartbeat: periodic summary proves the node is alive even when
  // no sensor changes.
  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    publishSummary();
  }
}
