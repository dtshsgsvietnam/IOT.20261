// Nghiệp vụ chính: xử lý dữ liệu từ thiết bị, quyết định vào/ra, quản lý phiên gửi xe
const db = require('./db');
const config = require('./config');
const realtime = require('./realtime');
const { publish } = require('./mqtt');

const SLOT_STATES = ['FREE', 'OCCUPIED', 'UNKNOWN'];
const GATES = ['ENTRY', 'EXIT'];
const COMMANDS = [
  'OPEN_GATE',
  'CLOSE_GATE',
  'ENABLE_ENTRY',
  'DISABLE_ENTRY',
  'SET_REPORT_INTERVAL',
  'REQUEST_STATUS',
  'RESTART_DEVICE',
];

// Xe đã được cho phép, đang chờ cảm biến IR xác nhận đi qua cổng.
// key `${deviceId}:${gate}` -> { uid | null (mở tay), expiresAt }
const pendingPass = new Map();
// Cache trạng thái thiết bị để chỉ emit khi có thay đổi
const deviceStatus = new Map();

// ---------------------------------------------------------------- helpers

async function logEvent(deviceId, type, payload = {}) {
  const { rows } = await db.query(
    `INSERT INTO events (device_id, type, payload) VALUES ($1, $2, $3::jsonb) RETURNING *`,
    [deviceId, type, JSON.stringify(payload)]
  );
  realtime.emit('event:new', rows[0]);
  return rows[0];
}

async function getSummary() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int                                       AS total,
      COUNT(*) FILTER (WHERE state = 'FREE')::int         AS free,
      COUNT(*) FILTER (WHERE state = 'OCCUPIED')::int     AS occupied,
      COUNT(*) FILTER (WHERE state = 'UNKNOWN')::int      AS unknown,
      (SELECT COUNT(*)::int FROM parking_sessions WHERE status = 'ACTIVE') AS cars_inside
    FROM slots`);
  const s = rows[0];
  // Số chỗ còn có thể cho xe vào = tổng chỗ - số phiên đang gửi
  s.available = Math.max(0, s.total - s.cars_inside);
  s.updated_at = new Date().toISOString();
  return s;
}

/** Gửi summary lên web + publish retained để LCD của mọi thiết bị cập nhật */
async function broadcastSummary() {
  const summary = await getSummary();
  realtime.emit('summary:update', summary);
  publish('parking/broadcast/summary', summary, { retain: true });
  return summary;
}

async function touchDevice(deviceId) {
  const { rows } = await db.query(
    `INSERT INTO devices (id, status, last_seen) VALUES ($1, 'ONLINE', now())
     ON CONFLICT (id) DO UPDATE SET status = 'ONLINE', last_seen = now()
     RETURNING *`,
    [deviceId]
  );
  if (deviceStatus.get(deviceId) !== 'ONLINE') {
    deviceStatus.set(deviceId, 'ONLINE');
    realtime.emit('device:update', rows[0]);
    await logEvent(deviceId, 'DEVICE_ONLINE');
  }
  return rows[0];
}

async function markOffline(deviceId, reason) {
  deviceStatus.set(deviceId, 'OFFLINE');
  const { rows } = await db.query(
    `UPDATE devices SET status = 'OFFLINE' WHERE id = $1 AND status <> 'OFFLINE' RETURNING *`,
    [deviceId]
  );
  if (!rows.length) return;
  realtime.emit('device:update', rows[0]);
  realtime.emit('alert', {
    level: 'warning',
    deviceId,
    message: `Thiết bị ${deviceId} mất kết nối (${reason})`,
    at: new Date().toISOString(),
  });
  await logEvent(deviceId, 'DEVICE_OFFLINE', { reason });
}

function pendingEntryCount() {
  const now = Date.now();
  let n = 0;
  for (const [key, p] of pendingPass) if (key.endsWith(':ENTRY') && p.uid && p.expiresAt > now) n++;
  return n;
}

// ---------------------------------------------------------------- MQTT handlers

/** parking/{id}/telemetry/slot  { slotId, state } */
async function onSlot(deviceId, msg) {
  await touchDevice(deviceId);
  const slotId = String(msg.slotId || '').trim();
  const state = String(msg.state || '').toUpperCase();
  if (!slotId || !SLOT_STATES.includes(state)) throw new Error(`invalid slot payload ${JSON.stringify(msg)}`);

  const { rows } = await db.query(
    `INSERT INTO slots (id, device_id, label, state, updated_at) VALUES ($1, $2, $1, $3, now())
     ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, device_id = EXCLUDED.device_id, updated_at = now()
     RETURNING *`,
    [slotId, deviceId, state]
  );
  realtime.emit('slot:update', rows[0]);
  await logEvent(deviceId, 'SLOT_CHANGED', { slotId, state, deviceTs: msg.ts });
  await broadcastSummary();
}

async function decideAccess(uid, gate) {
  const { rows: [card] } = await db.query(`SELECT * FROM cards WHERE uid = $1`, [uid]);
  const { rows: [active] } = await db.query(
    `SELECT id FROM parking_sessions WHERE card_uid = $1 AND status = 'ACTIVE'`,
    [uid]
  );
  const summary = await getSummary();
  const deny = (reason, message) => ({ allowed: false, reason, message, available: summary.available });

  if (gate === 'ENTRY') {
    if (!card || !card.active) return deny('INVALID_CARD', 'The khong hop le');
    if (active) return deny('ALREADY_INSIDE', 'The dang o trong bai');
    if (summary.available - pendingEntryCount() <= 0) return deny('FULL', 'Bai da het cho');
    return { allowed: true, reason: 'OK', message: 'Moi xe vao', available: summary.available };
  }
  // EXIT
  if (!active) return deny('NO_ACTIVE_SESSION', 'Khong co phien gui');
  return { allowed: true, reason: 'OK', message: 'Tam biet!', available: summary.available };
}

/** parking/{id}/telemetry/rfid  { uid, gate: ENTRY|EXIT } */
async function onRfid(deviceId, msg) {
  await touchDevice(deviceId);
  const uid = String(msg.uid || '').toUpperCase().trim();
  const gate = String(msg.gate || 'ENTRY').toUpperCase();
  if (!uid || !GATES.includes(gate)) throw new Error(`invalid rfid payload ${JSON.stringify(msg)}`);

  await logEvent(deviceId, 'RFID_SCAN', { uid, gate, deviceTs: msg.ts });
  const decision = await decideAccess(uid, gate);

  // Phản hồi cho thiết bị (để hiện LCD)
  publish(`parking/${deviceId}/rfid/response`, { uid, gate, ...decision, ts: new Date().toISOString() });
  await logEvent(deviceId, decision.allowed ? 'ACCESS_GRANTED' : 'ACCESS_DENIED', {
    uid,
    gate,
    reason: decision.reason,
  });

  if (decision.allowed) {
    pendingPass.set(`${deviceId}:${gate}`, {
      uid,
      expiresAt: Date.now() + config.gatePassTimeoutSec * 1000,
    });
    await sendCommand(deviceId, 'OPEN_GATE', { gate });
  }
}

/** parking/{id}/telemetry/gate  { gate }  — IR xác nhận xe đã đi qua barrier */
async function onGatePass(deviceId, msg) {
  await touchDevice(deviceId);
  const gate = String(msg.gate || '').toUpperCase();
  const key = `${deviceId}:${gate}`;
  const pending = pendingPass.get(key);
  pendingPass.delete(key);

  if (!pending || pending.expiresAt < Date.now()) {
    await logEvent(deviceId, 'UNAUTHORIZED_PASS', { gate });
    realtime.emit('alert', {
      level: 'danger',
      deviceId,
      message: `Phát hiện xe qua cổng ${gate} khi chưa được cấp quyền`,
      at: new Date().toISOString(),
    });
    return;
  }

  if (!pending.uid) {
    // Nhân viên mở barrier bằng tay
    await logEvent(deviceId, 'MANUAL_PASS', { gate });
    return;
  }

  let session;
  if (gate === 'ENTRY') {
    try {
      ({ rows: [session] } = await db.query(
        `INSERT INTO parking_sessions (card_uid, entry_device) VALUES ($1, $2) RETURNING *`,
        [pending.uid, deviceId]
      ));
    } catch (err) {
      if (err.code === '23505') return logEvent(deviceId, 'DUPLICATE_ENTRY', { uid: pending.uid });
      throw err;
    }
    await logEvent(deviceId, 'VEHICLE_ENTERED', { uid: pending.uid, sessionId: session.id });
  } else {
    ({ rows: [session] } = await db.query(
      `UPDATE parking_sessions SET status = 'COMPLETED', time_out = now(), exit_device = $2
       WHERE card_uid = $1 AND status = 'ACTIVE' RETURNING *`,
      [pending.uid, deviceId]
    ));
    if (!session) return;
    await logEvent(deviceId, 'VEHICLE_EXITED', { uid: pending.uid, sessionId: session.id });
  }

  realtime.emit('session:update', session);
  await broadcastSummary();
}

/** parking/{id}/status  { status: online|offline }  (retained + LWT) */
async function onStatus(deviceId, msg) {
  const status = String(msg.status || '').toUpperCase();
  if (status === 'ONLINE') return touchDevice(deviceId);
  if (status === 'OFFLINE') return markOffline(deviceId, 'LWT');
}

/** parking/{id}/metadata  { name, type, location, hwVersion, fwVersion, sensors[], slots[] } */
async function onMetadata(deviceId, msg) {
  await touchDevice(deviceId);
  const { rows } = await db.query(
    `UPDATE devices SET
       name = COALESCE($2, name), type = COALESCE($3, type), location = COALESCE($4, location),
       hw_version = COALESCE($5, hw_version), fw_version = COALESCE($6, fw_version),
       metadata = $7::jsonb
     WHERE id = $1 RETURNING *`,
    [
      deviceId,
      msg.name ?? null,
      msg.type ?? null,
      msg.location ?? null,
      msg.hwVersion ?? null,
      msg.fwVersion ?? null,
      JSON.stringify({ sensors: msg.sensors || [], slots: msg.slots || [] }),
    ]
  );
  if (Array.isArray(msg.slots)) {
    for (const slotId of msg.slots) {
      await db.query(
        `INSERT INTO slots (id, device_id, label) VALUES ($1, $2, $1)
         ON CONFLICT (id) DO UPDATE SET device_id = EXCLUDED.device_id`,
        [String(slotId), deviceId]
      );
    }
  }
  realtime.emit('device:update', rows[0]);
}

/** parking/{id}/heartbeat  { uptime, rssi, ... } */
async function onHeartbeat(deviceId) {
  await touchDevice(deviceId);
}

/** parking/{id}/cmd/ack  { cmdId, success } */
async function onCommandAck(deviceId, msg) {
  await touchDevice(deviceId);
  if (!msg.cmdId) return;
  const { rows } = await db.query(
    `UPDATE commands SET status = $2, acked_at = now(), result = $3::jsonb
     WHERE id = $1 AND device_id = $4 RETURNING *`,
    [msg.cmdId, msg.success === false ? 'FAILED' : 'ACKED', JSON.stringify(msg), deviceId]
  );
  if (rows[0]) realtime.emit('command:update', rows[0]);
}

// ---------------------------------------------------------------- commands

/**
 * Gửi lệnh xuống thiết bị: parking/{id}/cmd  { cmdId, command, params, ts }
 * @param {{ manual?: boolean }} opts  manual=true khi nhân viên bấm trên web
 */
async function sendCommand(deviceId, command, params = {}, opts = {}) {
  if (!COMMANDS.includes(command)) {
    const err = new Error(`Unknown command "${command}". Allowed: ${COMMANDS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `INSERT INTO commands (device_id, command, params) VALUES ($1, $2, $3::jsonb) RETURNING *`,
    [deviceId, command, JSON.stringify(params)]
  );
  const cmd = rows[0];

  if (opts.manual && command === 'OPEN_GATE') {
    pendingPass.set(`${deviceId}:${String(params.gate || 'ENTRY').toUpperCase()}`, {
      uid: null,
      expiresAt: Date.now() + config.gatePassTimeoutSec * 1000,
    });
  }

  const ok = publish(`parking/${deviceId}/cmd`, {
    cmdId: Number(cmd.id),
    command,
    params,
    ts: new Date().toISOString(),
  });
  if (!ok) {
    await db.query(`UPDATE commands SET status = 'FAILED' WHERE id = $1`, [cmd.id]);
    cmd.status = 'FAILED';
  }
  realtime.emit('command:update', cmd);
  return cmd;
}

// ---------------------------------------------------------------- watchdog

async function checkDeviceTimeouts() {
  const { rows } = await db.query(
    `SELECT id FROM devices
     WHERE status = 'ONLINE' AND last_seen < now() - make_interval(secs => $1)`,
    [config.deviceTimeoutSec]
  );
  for (const r of rows) await markOffline(r.id, 'TIMEOUT');

  const now = Date.now();
  for (const [key, p] of pendingPass) if (p.expiresAt < now) pendingPass.delete(key);
}

module.exports = {
  COMMANDS,
  getSummary,
  broadcastSummary,
  sendCommand,
  checkDeviceTimeouts,
  // mqtt handlers
  onSlot,
  onRfid,
  onGatePass,
  onStatus,
  onMetadata,
  onHeartbeat,
  onCommandAck,
};

