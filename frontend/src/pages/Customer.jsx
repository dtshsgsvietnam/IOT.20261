import { SlotGrid, SummaryCards, fmtTime } from '../components.jsx';

export default function Customer({ summary, slots }) {
  return (
    <>
      <section>
        <h2>Tình trạng bãi xe</h2>
        <SummaryCards summary={summary} />
        <p className="muted">Cập nhật lúc: {fmtTime(summary?.updated_at)}</p>
      </section>
      <section>
        <h2>Sơ đồ ô đỗ</h2>
        <SlotGrid slots={slots} />
        <div className="legend">
          <span className="slot-dot free" /> Trống
          <span className="slot-dot occupied" /> Có xe
          <span className="slot-dot unknown" /> Không xác định
        </div>
      </section>
    </>
  );
}

