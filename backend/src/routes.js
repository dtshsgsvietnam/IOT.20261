// REST API cho frontend
const express = require('express');
const db = require('./db');
const parking = require('./parking');
const { isConnected } = require('./mqtt');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const limitOf = (v, def = 50, max = 500) => Math.min(Math.max(parseInt(v, 10) || def, 1), max);
const orNull = (v) => (v === undefined || v === '' ? null : v);

// ---------- Hệ thống ----------
router.get('/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, db: true, mqtt: isConnected(), time: new Date().toISOString() });
}));

// ---------- Khách hàng ----------
router.get('/summary', wrap(async (req, res) => {
  res.json(await parking.getSummary());
}));

router.get('/slots', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM slots ORDER BY id`);
  res.json(rows);
}));

// ---------- Thiết bị ----------
router.get('/devices', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM devices ORDER BY id`);
  res.json(rows);
}));

router.get('/devices/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM devices WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Device not found' });
  res.json(rows[0]);
}));

router.get('/devices/:id/commands', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM commands WHERE device_id = $1 ORDER BY id DESC LIMIT $2`,
    [req.params.id, limitOf(req.query.limit, 20)]
  );
  res.json(rows);
}));

// Body: { "command": "OPEN_GATE", "params": { "gate": "ENTRY" } }
router.post('/devices/:id/commands', wrap(async (req, res) => {
  const { command, params } = req.body || {};
  const { rows } = await db.query(`SELECT id FROM devices WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Device not found' });
  const cmd = await parking.sendCommand(req.params.id, command, params || {}, { manual: true });
  res.status(202).json(cmd);
}));

// ---------- Phiên gửi xe / lịch sử ----------
// GET /api/sessions?status=ACTIVE|COMPLETED&cardUid=...&from=ISO&to=ISO&limit=50
router.get('/sessions', wrap(async (req, res) => {
  const { status, cardUid, from, to } = req.query;
  const { rows } = await db.query(
    `SELECT s.*, c.owner_name, c.plate_number,
            EXTRACT(EPOCH FROM (COALESCE(s.time_out, now()) - s.time_in))::int AS duration_sec
     FROM parking_sessions s
     LEFT JOIN cards c ON c.uid = s.card_uid
     WHERE ($1::text IS NULL OR s.status = $1)
       AND ($2::text IS NULL OR s.card_uid ILIKE '%' || $2 || '%')
       AND ($3::timestamptz IS NULL OR s.time_in >= $3)
       AND ($4::timestamptz IS NULL OR s.time_in <= $4)
     ORDER BY s.time_in DESC
     LIMIT $5`,
    [orNull(status), orNull(cardUid), orNull(from), orNull(to), limitOf(req.query.limit)]
  );
  res.json(rows);
}));

// GET /api/events?type=RFID_SCAN&deviceId=gate-01&limit=50
router.get('/events', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM events
     WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR device_id = $2)
     ORDER BY id DESC LIMIT $3`,
    [orNull(req.query.type), orNull(req.query.deviceId), limitOf(req.query.limit)]
  );
  res.json(rows);
}));

// ---------- Thẻ RFID ----------
router.get('/cards', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM cards ORDER BY created_at DESC`);
  res.json(rows);
}));

// Body: { "uid": "A1B2C3D4", "ownerName": "...", "plateNumber": "..." }
router.post('/cards', wrap(async (req, res) => {
  const { uid, ownerName, plateNumber } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid is required' });
  try {
    const { rows } = await db.query(
      `INSERT INTO cards (uid, owner_name, plate_number) VALUES ($1, $2, $3) RETURNING *`,
      [String(uid).toUpperCase(), ownerName || null, plateNumber || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Card already exists' });
    throw err;
  }
}));

// Body: { "active": false } | { "ownerName": "..." } | { "plateNumber": "..." }
router.patch('/cards/:uid', wrap(async (req, res) => {
  const { active, ownerName, plateNumber } = req.body || {};
  const { rows } = await db.query(
    `UPDATE cards SET active = COALESCE($2, active), owner_name = COALESCE($3, owner_name),
            plate_number = COALESCE($4, plate_number)
     WHERE uid = $1 RETURNING *`,
    [req.params.uid.toUpperCase(), active ?? null, ownerName ?? null, plateNumber ?? null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Card not found' });
  res.json(rows[0]);
}));

module.exports = router;

