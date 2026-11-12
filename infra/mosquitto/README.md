# Mosquitto broker

MQTT broker for the Smart Parking demo, running directly on the laptop.

## Run

From the repo root (PowerShell):

```powershell
D:\mosquitto\mosquitto.exe -c infra\mosquitto\mosquitto.conf -v
```

`-v` prints every connect / publish to the console, useful during the demo.
Keep this window open; closing it stops the broker.

## Check that it works

Open a second terminal and subscribe to every parking topic:

```powershell
D:\mosquitto\mosquitto_sub.exe -h <LAPTOP_LAN_IP> -t "parking/#" -v
```

When the ESP32 connects you should see the retained slot states, the
summary and `parking/device/esp32-01/status online`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| ESP32 logs `[MQTT] THAT BAI, rc=-2` | Cannot reach the broker: wrong `MQTT_BROKER` IP in `config.h`, broker not running, or firewall blocking port 1883 |
| Works from the laptop but not from the ESP32 | Windows Firewall: allow `mosquitto.exe` (or TCP 1883) on the active network profile |
| Laptop IP changed | DHCP gave a new IP. Check with `ipconfig`, update `config.h`, re-upload |
| `Only one usage of each socket address` | Another Mosquitto (e.g. the Windows service) already uses port 1883. Stop it: `net stop mosquitto` |
