-- =========================================================
-- Smart Parking - PostgreSQL schema + seed data
-- Chạy tự động lần đầu khi container postgres khởi tạo volume
-- =========================================================

-- ---------- Metadata thiết bị ----------
CREATE TABLE devices (
    id          VARCHAR(64) PRIMARY KEY,           -- Device ID, vd: gate-01
    name        VARCHAR(128),
    type        VARCHAR(32),                       -- GATE | SLOT_NODE
    location    VARCHAR(128),
    hw_version  VARCHAR(32),
    fw_version  VARCHAR(32),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb, -- danh sách cảm biến, ô đỗ quản lý...
    status      VARCHAR(16) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE')),
    last_seen   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- State: trạng thái ô đỗ ----------
CREATE TABLE slots (
    id          VARCHAR(32) PRIMARY KEY,           -- vd: A1
    device_id   VARCHAR(64) REFERENCES devices(id) ON DELETE SET NULL,
    label       VARCHAR(32),
    state       VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN' CHECK (state IN ('FREE', 'OCCUPIED', 'UNKNOWN')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Thẻ RFID ----------
CREATE TABLE cards (
    uid           VARCHAR(32) PRIMARY KEY,         -- UID HEX in hoa, vd: A1B2C3D4
    owner_name    VARCHAR(128),
    plate_number  VARCHAR(20),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Phiên gửi xe ----------
CREATE TABLE parking_sessions (
    id            BIGSERIAL PRIMARY KEY,
    card_uid      VARCHAR(32) NOT NULL REFERENCES cards(uid),
    entry_device  VARCHAR(64),
    exit_device   VARCHAR(64),
    time_in       TIMESTAMPTZ NOT NULL DEFAULT now(),
    time_out      TIMESTAMPTZ,
    status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED'))
);
-- Mỗi thẻ chỉ có tối đa 1 phiên đang ACTIVE
CREATE UNIQUE INDEX uq_active_session_per_card ON parking_sessions(card_uid) WHERE status = 'ACTIVE';
CREATE INDEX idx_sessions_time_in ON parking_sessions(time_in DESC);

-- ---------- Telemetry / lịch sử sự kiện ----------
CREATE TABLE events (
    id          BIGSERIAL PRIMARY KEY,
    device_id   VARCHAR(64),
    type        VARCHAR(32) NOT NULL,              -- SLOT_CHANGED, RFID_SCAN, ACCESS_GRANTED, VEHICLE_ENTERED, DEVICE_OFFLINE...
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_device ON events(device_id, created_at DESC);

-- ---------- Commands gửi xuống thiết bị ----------
CREATE TABLE commands (
    id          BIGSERIAL PRIMARY KEY,
    device_id   VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command     VARCHAR(32) NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      VARCHAR(16) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'ACKED', 'FAILED')),
    result      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    acked_at    TIMESTAMPTZ
);

-- =========================================================
-- Seed data (dữ liệu giả định)
-- =========================================================
INSERT INTO devices (id, name, type, location, hw_version, fw_version, metadata) VALUES
    ('gate-01', 'Cổng chính', 'GATE',      'Cổng A', 'esp32-v1', '0.1.0',
        '{"sensors": ["RFID", "IR_ENTRY", "IR_EXIT", "IR_SAFETY"]}'),
    ('node-01', 'Node ô đỗ khu A', 'SLOT_NODE', 'Khu A', 'esp32-v1', '0.1.0',
        '{"sensors": ["IR_A1","IR_A2","IR_A3","IR_A4","IR_A5","IR_A6"], "slots": ["A1","A2","A3","A4","A5","A6"]}');

INSERT INTO slots (id, device_id, label) VALUES
    ('A1', 'node-01', 'A1'), ('A2', 'node-01', 'A2'), ('A3', 'node-01', 'A3'),
    ('A4', 'node-01', 'A4'), ('A5', 'node-01', 'A5'), ('A6', 'node-01', 'A6');

INSERT INTO cards (uid, owner_name, plate_number, active) VALUES
    ('A1B2C3D4', 'Nguyễn Văn An',  '29A-123.45', TRUE),
    ('11223344', 'Trần Thị Bình',  '30E-678.90', TRUE),
    ('55667788', 'Lê Văn Cường',   '29B-111.22', TRUE),
    ('99AABBCC', 'Phạm Thị Dung',  '30F-333.44', TRUE),
    ('DEADBEEF', 'Thẻ bị khóa',    NULL,         FALSE);
-- Thẻ 'FFFFFFFF' cố ý không có trong DB để test "thẻ lạ"

