import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { socket } from '../socket';
import { Badge, SlotGrid, SummaryCards, fmtDuration, fmtTime } from '../components.jsx';

const upsertById = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item].sort((a, b) => a.id.localeCompare(b.id));
  const next = [...list];
  next[i] = item;
  return next;
};
const toIso = (v) => (v ? new Date(v).toISOString() : undefined);

export default function Staff({ summary, slots }) {
  const [devices, setDevices] = useState([]);
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState({ cardUid: '', from: '', to: '' });

  const loadSessions = useCallback(() => {
    api.sessions({ status: 'ACTIVE', limit: 200 }).then(setActive).catch(console.error);
    api
      .sessions({
        status: 'COMPLETED',
        cardUid: filter.cardUid,
        from: toIso(filter.from),
        to: toIso(filter.to),
        limit: 100,
      })
      .then(setHistory)
      .catch(console.error);
  }, [filter]);

  useEffect(() => {
    loadSessions();
    socket.on('session:update', loadSessions);
    return () => socket.off('session:update', loadSessions);
  }, [loadSessions]);

  useEffect(() => {
    api.devices().then(setDevices).catch(console.error);
    api.events({ limit: 50 }).then(setEvents).catch(console.error);

    const onDevice = (d) => setDevices((prev) => upsertById(prev, d));
    const onEvent = (e) => setEvents((prev) => [e, ...prev].slice(0, 50));
    const onAlert = (a) => setAlerts((prev) => [{ ...a, key: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 5));

    socket.on('device:update', onDevice);
    socket.on('event:new', onEvent);
    socket.on('alert', onAlert);
    return () => {
      socket.off('device:update', onDevice);
      socket.off('event:new', onEvent);
      socket.off('alert', onAlert);
    };
  }, []);

  const send = async (deviceId, command, params) => {
    try {
      await api.sendCommand(deviceId, command, params);
    } catch (e) {
      window.alert(`Gửi lệnh thất bại: ${e.message}`);
    }
  };

  return (
    <>
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a) => (
            <div key={a.key} className={`alert ${a.level}`}>
              <span>
                ⚠️ {a.message} <small>({fmtTime(a.at)})</small>
              </span>
              <button onClick={() => setAlerts((p) => p.filter((x) => x.key !== a.key))}>✕</button>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2>Tổng quan</h2>
        <SummaryCards summary={summary} staff />
        <SlotGrid slots={slots} />
      </section>

      <section>
        <h2>Thiết bị IoT</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Tên / Loại</th><th>Vị trí</th><th>FW</th><th>Trạng thái</th><th>Lần cuối</th><th>Điều khiển</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td><code>{d.id}</code></td>
                <td>{d.name}<br /><small className="muted">{d.type}</small></td>
                <td>{d.location}</td>
                <td>{d.fw_version}</td>
                <td><Badge value={d.status} /></td>
                <td>{fmtTime(d.last_seen)}</td>
                <td className="actions">
                  {d.type === 'GATE' && (
                    <>
                      <button onClick={() => send(d.id, 'OPEN_GATE', { gate: 'ENTRY' })}>Mở cổng vào</button>
                      <button onClick={() => send(d.id, 'OPEN_GATE', { gate: 'EXIT' })}>Mở cổng ra</button>
                      <button onClick={() => send(d.id, 'CLOSE_GATE')}>Đóng</button>
                      <button onClick={() => send(d.id, 'DISABLE_ENTRY')}>Khóa vào</button>
                      <button onClick={() => send(d.id, 'ENABLE_ENTRY')}>Mở vào</button>
                    </>
                  )}
                  <button onClick={() => send(d.id, 'REQUEST_STATUS')}>Status</button>
                  <button className="danger" onClick={() => send(d.id, 'RESTART_DEVICE')}>Restart</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Xe đang gửi ({active.length})</h2>
        <SessionTable rows={active} />
      </section>

      <section>
        <h2>Lịch sử xe vào / ra</h2>
        <div className="filters">
          <input
            placeholder="UID thẻ"
            value={filter.cardUid}
            onChange={(e) => setFilter({ ...filter, cardUid: e.target.value })}
          />
          <label>Từ <input type="datetime-local" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></label>
          <label>Đến <input type="datetime-local" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></label>
          <button onClick={() => setFilter({ cardUid: '', from: '', to: '' })}>Xóa lọc</button>
        </div>
        <SessionTable rows={history} showOut />
      </section>

      <section>
        <h2>Nhật ký sự kiện (realtime)</h2>
        <div className="event-log">
          {events.map((e) => (
            <div key={e.id} className="event">
              <small>{fmtTime(e.created_at)}</small>
              <code>{e.device_id}</code>
              <Badge value={e.type} />
              <span className="muted">{JSON.stringify(e.payload)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SessionTable({ rows, showOut = false }) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th><th>Thẻ</th><th>Chủ xe</th><th>Biển số</th><th>Giờ vào</th>
          {showOut && <th>Giờ ra</th>}
          <th>Thời gian</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td>{s.id}</td>
            <td><code>{s.card_uid}</code></td>
            <td>{s.owner_name || '—'}</td>
            <td>{s.plate_number || '—'}</td>
            <td>{fmtTime(s.time_in)}</td>
            {showOut && <td>{fmtTime(s.time_out)}</td>}
            <td>{fmtDuration(s.duration_sec)}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={showOut ? 7 : 6} className="muted">Không có dữ liệu</td></tr>
        )}
      </tbody>
    </table>
  );
}

