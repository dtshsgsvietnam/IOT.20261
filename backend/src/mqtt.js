// MQTT client của backend: subscribe dữ liệu từ thiết bị, publish lệnh xuống thiết bị
const mqtt = require('mqtt');
const config = require('./config');

// Topic thiết bị -> server
const SUBSCRIPTIONS = [
  'parking/+/telemetry/#', // telemetry/slot, telemetry/rfid, telemetry/gate
  'parking/+/status',      // online/offline (LWT, retained)
  'parking/+/metadata',    // thông tin thiết bị (retained)
  'parking/+/heartbeat',   // nhịp tim định kỳ
  'parking/+/cmd/ack',     // xác nhận đã thực thi lệnh
];

let client = null;

/**
 * @param {Record<string, (deviceId: string, payload: object) => Promise<void>>} routes
 *        map "kênh" (phần topic sau deviceId) -> handler
 * @param {() => void} [onConnect]
 */
function connect(routes, onConnect) {
  client = mqtt.connect(config.mqtt.url, {
    clientId: `backend-${Math.random().toString(16).slice(2, 8)}`,
    username: config.mqtt.username,
    password: config.mqtt.password,
    reconnectPeriod: 2000,
    clean: true,
  });

  client.on('connect', () => {
    console.log(`[mqtt] connected ${config.mqtt.url}`);
    client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] subscribe error:', err.message);
    });
    if (onConnect) Promise.resolve(onConnect()).catch((e) => console.error(e));
  });
  client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));

  client.on('message', async (topic, buf) => {
    // parking/{deviceId}/{channel...}
    const [, deviceId, ...rest] = topic.split('/');
    const channel = rest.join('/');
    const handler = routes[channel];
    if (!handler || !deviceId) return;

    let payload;
    try {
      payload = buf.length ? JSON.parse(buf.toString()) : {};
    } catch {
      console.warn(`[mqtt] invalid JSON on ${topic}: ${buf.toString()}`);
      return;
    }

    try {
      await handler(deviceId, payload);
    } catch (err) {
      console.error(`[mqtt] handler error on ${topic}:`, err.message);
    }
  });

  return client;
}

function publish(topic, payload, opts = {}) {
  if (!client || !client.connected) {
    console.warn(`[mqtt] not connected, drop publish ${topic}`);
    return false;
  }
  client.publish(topic, JSON.stringify(payload), { qos: 1, ...opts });
  return true;
}

function isConnected() {
  return Boolean(client && client.connected);
}

module.exports = { connect, publish, isConnected };

