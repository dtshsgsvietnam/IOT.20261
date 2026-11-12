export const fmtTime = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');

export const fmtDuration = (sec) => {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};

export function SummaryCards({ summary, staff = false }) {
  if (!summary) return <div className="cards">Đang tải...</div>;
  return (
    <div className="cards">
      <div className="card">
        <span>Tổng số chỗ</span>
        <b>{summary.total}</b>
      </div>
      <div className="card free">
        <span>Còn trống</span>
        <b>{summary.available}</b>
      </div>
      <div className="card occupied">
        <span>Ô có xe (cảm biến)</span>
        <b>{summary.occupied}</b>
      </div>
      {staff && (
        <>
          <div className="card">
            <span>Xe đang gửi</span>
            <b>{summary.cars_inside}</b>
          </div>
          <div className="card unknown">
            <span>Ô không xác định</span>
            <b>{summary.unknown}</b>
          </div>
        </>
      )}
    </div>
  );
}

const SLOT_LABEL = { FREE: 'Trống', OCCUPIED: 'Có xe', UNKNOWN: 'Không rõ' };

export function SlotGrid({ slots }) {
  return (
    <div className="slot-grid">
      {slots.map((s) => (
        <div key={s.id} className={`slot ${s.state.toLowerCase()}`} title={`Cập nhật: ${fmtTime(s.updated_at)}`}>
          <b>{s.label || s.id}</b>
          <span>{SLOT_LABEL[s.state] || s.state}</span>
        </div>
      ))}
      {!slots.length && <p className="muted">Chưa có ô đỗ nào.</p>}
    </div>
  );
}

export function Badge({ value }) {
  return <span className={`badge ${String(value).toLowerCase()}`}>{value}</span>;
}

