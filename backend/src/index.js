const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const db = require('./db');
const realtime = require('./realtime');
const mqttClient = require('./mqtt');
const parking = require('./parking');
const routes = require('./routes');

async function waitForDb(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await db.query('SELECT 1');
      console.log('[db] connected');
      return;
    } catch (err) {
      console.log(`[db] waiting (${i}/${retries})... ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Database not reachable');
}

async function main() {
  await waitForDb();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api', routes);
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[http]', err);
    res.status(err.status || 500).json({ error: err.message });
  });

  const server = http.createServer(app);
  realtime.init(server);

  // Sensor -> MQTT -> backend
  mqttClient.connect(
    {
      'telemetry/slot': parking.onSlot,
      'telemetry/rfid': parking.onRfid,
      'telemetry/gate': parking.onGatePass,
      status: parking.onStatus,
      metadata: parking.onMetadata,
      heartbeat: parking.onHeartbeat,
      'cmd/ack': parking.onCommandAck,
    },
    () => parking.broadcastSummary()
  );

  setInterval(() => parking.checkDeviceTimeouts().catch((e) => console.error('[watchdog]', e.message)), 5000);

  server.listen(config.port, () => console.log(`[http] listening on :${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

