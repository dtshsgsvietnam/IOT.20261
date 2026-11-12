import { useEffect, useState } from 'react';
import { api } from './api';
import { socket } from './socket';
import Customer from './pages/Customer.jsx';
import Staff from './pages/Staff.jsx';

const getPage = () => (window.location.hash === '#/staff' ? 'staff' : 'customer');

export default function App() {
  const [page, setPage] = useState(getPage);
  const [connected, setConnected] = useState(socket.connected);
  const [summary, setSummary] = useState(null);
  const [slots, setSlots] = useState([]);

  useEffect(() => {
    const onHash = () => setPage(getPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Dữ liệu dùng chung cho cả 2 giao diện: summary + trạng thái ô đỗ
  useEffect(() => {
    const load = () => {
      api.summary().then(setSummary).catch(console.error);
      api.slots().then(setSlots).catch(console.error);
    };
    const onSlot = (slot) =>
      setSlots((prev) => {
        const i = prev.findIndex((s) => s.id === slot.id);
        if (i === -1) return [...prev, slot].sort((a, b) => a.id.localeCompare(b.id));
        const next = [...prev];
        next[i] = slot;
        return next;
      });
    const onConnect = () => {
      setConnected(true);
      load();
    };
    const onDisconnect = () => setConnected(false);

    load();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('slot:update', onSlot);
    socket.on('summary:update', setSummary);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('slot:update', onSlot);
      socket.off('summary:update', setSummary);
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>🅿️ Smart Parking</h1>
        <nav>
          <a href="#/" className={page === 'customer' ? 'active' : ''}>Khách hàng</a>
          <a href="#/staff" className={page === 'staff' ? 'active' : ''}>Nhân viên</a>
        </nav>
        <span className={`conn ${connected ? 'on' : 'off'}`}>
          {connected ? '● Realtime' : '○ Mất kết nối'}
        </span>
      </header>
      <main>
        {page === 'staff' ? (
          <Staff summary={summary} slots={slots} />
        ) : (
          <Customer summary={summary} slots={slots} />
        )}
      </main>
    </div>
  );
}

