module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://parking:parking@localhost:5432/smart_parking',
  mqtt: {
    url: process.env.MQTT_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  },
  // Không nhận được message nào từ thiết bị sau N giây -> OFFLINE
  deviceTimeoutSec: Number(process.env.DEVICE_TIMEOUT_SEC || 30),
  // Sau khi cho phép mở barrier, xe phải qua cổng trong N giây
  gatePassTimeoutSec: Number(process.env.GATE_PASS_TIMEOUT_SEC || 20),
};

