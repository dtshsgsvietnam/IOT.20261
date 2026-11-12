/*
 * Configuration template for parking_node.
 *
 * Usage: copy this file to config.h and fill in real values.
 * config.h is gitignored because it contains the Wi-Fi password.
 */

#pragma once

// Wi-Fi: ESP32 only supports 2.4 GHz networks.
#define WIFI_SSID      "your-wifi-name"
#define WIFI_PASSWORD  "your-wifi-password"

// MQTT broker: must be the laptop's LAN IP (e.g. 192.168.1.10),
// NOT localhost / 127.0.0.1 - those point to the ESP32 itself.
#define MQTT_BROKER    "192.168.1.10"
#define MQTT_PORT      1883

// Leave both empty if Mosquitto runs with allow_anonymous true.
#define MQTT_USER      ""
#define MQTT_PASSWORD  ""

// Unique device ID: used as MQTT client ID and in every payload.
#define DEVICE_ID      "esp32-01"
