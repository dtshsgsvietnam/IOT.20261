/**
 * Giả lập 2 thiết bị IoT (thay cho ESP32 thật khi chưa có phần cứng):
 *  - gate-01 : cổng vào/ra (RFID + IR qua cổng + barrier + LCD)
 *  - node-01 : node cảm biến IR các ô đỗ
 * Firmware thật chỉ cần publish/subscribe ĐÚNG các topic + payload như file này.
 */
const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const GATE_ID = process.env.GATE_ID || 'gate-01';
const NODE_ID = process.env.NODE_ID || 'node-01';
const SLOTS = (process.env.SLOTS || 'A1,A2,A3,A4,A5,A6').split(',');
// DEADBEEF = thẻ bị khóa, FFFFFFFF = thẻ lạ -> để test trường hợp bị từ chối
const CARDS = (process.env.CARDS || 'A1B2C3D4,11223344,55667788,99AABBCC,DEADBEEF,FFFFFFFF').split(',');
const CAR_INTERVAL_MS = Number(process.env.CAR_INTERVAL_MS || 7000);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => new Date().toISOString();

function createDevice(id, metadata, { extraSubs = [], onConnect, onMessage } = {}) {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `sim-${id}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 2000,
    // Last Will: broker tự publish khi thiết bị rớt mạng bất thường
    will: {
      topic: `parking/${id}/status`,
      payload: JSON.stringify({ status: 'offline' }),
      qos: 1,
      retain: true,
    },
  });

  const pub = (channel, payload, opts = {}) =>
    client.publish(`parking/${id}/${channel}`, JSON.stringify({ ...payload, ts: now() }), { qos: 1, ...opts });

  const device = { id, client, pub, reportIntervalMs: 5000 };

  client.on('connect', () => {
    console.log(`[${id}] connected ${MQTT_URL}`);
    pub('status', { status: 'online' }, { retain: true });
    pub('metadata', metadata, { retain: true });
    client.subscribe([`parking/${id}/cmd`, 'parking/broadcast/summary', ...extraSubs], { qos: 1 });
    if (onConnect) onConnect(device);
  });
  client.on('error', (e) => console.error(`[${id}] error`, e.message));

  client.on('message', (topic, buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (topic === 'parking/broadcast/summary') {
      if (metadata.type === 'GATE') console.log(`[${id}] LCD  >> Con trong: ${msg.available}/${msg.total}`);
      return;
    }
    const channel = topic.split('/').slice(2).join('/');
    if (channel === 'cmd') {
      console.log(`[${id}] CMD  << ${msg.command} ${JSON.stringify(msg.params || {})}`);
      let success = true;
      switch (msg.command) {
        case 'SET_REPORT_INTERVAL':
          device.reportIntervalMs = Number(msg.params?.intervalMs) || device.reportIntervalMs;
          break;
        case 'REQUEST_STATUS':
          pub('heartbeat', heartbeatPayload(device));
          if (onMessage) onMessage(device, 'cmd', msg);
          break;
        case 'RESTART_DEVICE':
          // ack trước, rồi ngắt kết nối "bất thường" để broker bắn LWT -> backend thấy OFFLINE
          pub('cmd/ack', { cmdId: msg.cmdId, command: msg.command, success: true });
          setTimeout(() => client.stream.destroy(), 300);
          return;
        default:
          success = onMessage ? onMessage(device, 'cmd', msg) !== false : true;
      }
      pub('cmd/ack', { cmdId: msg.cmdId, command: msg.command, success });
      return;
    }
    if (onMessage) onMessage(device, channel, msg);
  });

  setInterval(() => client.connected && pub('heartbeat', heartbeatPayload(device)), 10000);
  return device;
}

function heartbeatPayload(device) {
  return { uptime: Math.floor(process.uptime()), rssi: -40 - Math.floor(Math.random() * 30), reportIntervalMs: device.reportIntervalMs };
}

// ============================================================ GATE
const inside = new Set();               // các thẻ simulator nghĩ là đang trong bãi
const lastScan = { ENTRY: null, EXIT: null };
let entryEnabled = true;
let barrier = 'CLOSED';

const gate = createDevice(
  GATE_ID,
  {
    name: 'Cổng chính',
    type: 'GATE',
    location: 'Cổng A',
    hwVersion: 'esp32-v1',
    fwVersion: '0.1.0-sim',
    sensors: ['RFID', 'IR_ENTRY', 'IR_EXIT', 'IR_SAFETY'],
  },
  {
    extraSubs: [`parking/${GATE_ID}/rfid/response`],
    onMessage(device, channel, msg) {
      if (channel === 'rfid/response') {
        console.log(`[${GATE_ID}] LCD  >> ${msg.message} (${msg.reason})`);
        if (!msg.allowed) lastScan[msg.gate] = null;
        // tự đồng bộ lại nếu lệch với DB
        if (msg.reason === 'ALREADY_INSIDE') inside.add(msg.uid);
        if (msg.reason === 'NO_ACTIVE_SESSION') inside.delete(msg.uid);
        return;
      }
      if (channel !== 'cmd') return;
      switch (msg.command) {
        case 'OPEN_GATE': {
          const g = String(msg.params?.gate || 'ENTRY').toUpperCase();
          barrier = 'OPEN';
          console.log(`[${GATE_ID}] BARRIER ${g} OPEN`);
          // 1.5s sau IR xác nhận xe đã qua, IR an toàn thông -> tự đóng barrier
          setTimeout(() => {
            device.pub('telemetry/gate', { gate: g });
            const uid = lastScan[g];
            if (uid) (g === 'ENTRY' ? inside.add(uid) : inside.delete(uid));
            lastScan[g] = null;
            barrier = 'CLOSED';
            console.log(`[${GATE_ID}] xe da qua cong ${g}, BARRIER CLOSED`);
          }, 1500);
          return true;
        }
        case 'CLOSE_GATE':
          barrier = 'CLOSED';
          return true;
        case 'ENABLE_ENTRY':
          entryEnabled = true;
          return true;
        case 'DISABLE_ENTRY':
          entryEnabled = false;
          return true;
        default:
          return false;
      }
    },
  }
);

function simulateCar() {
  if (!gate.client.connected || barrier === 'OPEN') return;
  let uid;
  let g;
  if (inside.size && Math.random() < 0.45) {
    uid = pick([...inside]);
    g = 'EXIT';
  } else {
    uid = pick(CARDS);
    g = inside.has(uid) ? 'EXIT' : 'ENTRY';
  }
  if (g === 'ENTRY' && !entryEnabled) {
    console.log(`[${GATE_ID}] LCD  >> Cong vao dang tam khoa`);
    return;
  }
  lastScan[g] = uid;
  console.log(`[${GATE_ID}] RFID >> ${uid} @ ${g}`);
  gate.pub('telemetry/rfid', { uid, gate: g });
}
setInterval(simulateCar, CAR_INTERVAL_MS);

// ============================================================ SLOT NODE
const slotState = Object.fromEntries(SLOTS.map((s) => [s, Math.random() < 0.5 ? 'FREE' : 'OCCUPIED']));
const publishAllSlots = (device) =>
  SLOTS.forEach((slotId) => device.pub('telemetry/slot', { slotId, state: slotState[slotId] }));

const node = createDevice(
  NODE_ID,
  {
    name: 'Node ô đỗ khu A',
    type: 'SLOT_NODE',
    location: 'Khu A',
    hwVersion: 'esp32-v1',
    fwVersion: '0.1.0-sim',
    sensors: SLOTS.map((s) => `IR_${s}`),
    slots: SLOTS,
  },
  {
    onConnect: publishAllSlots,
    onMessage(device, channel, msg) {
      if (channel === 'cmd' && msg.command === 'REQUEST_STATUS') publishAllSlots(device);
      return true;
    },
  }
);

function tickSlots() {
  if (node.client.connected) {
    const slotId = pick(SLOTS);
    const r = Math.random();
    const next = r < 0.05 ? 'UNKNOWN' : slotState[slotId] === 'OCCUPIED' ? 'FREE' : 'OCCUPIED';
    if (next !== slotState[slotId]) {
      slotState[slotId] = next;
      console.log(`[${NODE_ID}] IR   >> ${slotId} = ${next}`);
      node.pub('telemetry/slot', { slotId, state: next });
    }
  }
  setTimeout(tickSlots, node.reportIntervalMs);
}
setTimeout(tickSlots, 3000);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
