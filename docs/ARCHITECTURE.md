# Smart Parking – Kiến trúc kỹ thuật & API contract

```text
Cảm biến IR / RFID ──> ESP32 ──MQTT──> Mosquitto ──> Backend (Node.js) ──> PostgreSQL
                         ▲                              │
                         └──────── MQTT (cmd) ──────────┤
                                                        └──REST + Socket.IO──> Frontend (React)
```

## 1. Stack đề xuất

| Tầng | Công nghệ | Lý do chọn |
|---|---|---|
| Thiết bị | **ESP32** + Arduino/PlatformIO (`PubSubClient`, `ArduinoJson`, `MFRC522`, `LiquidCrystal_I2C`, `ESP32Servo`) | Có sẵn Wi-Fi, rẻ, nhiều thư viện, đúng mục 6 README |
| Broker | **Eclipse Mosquitto 2** | Nhẹ, chuẩn MQTT 3.1.1/5, hỗ trợ LWT + retained (để biết thiết bị mất kết nối) |
| Backend | **Node.js 20 + Express + mqtt.js + Socket.IO** | Event-driven, hợp với MQTT; cùng ngôn ngữ JS với frontend → nhóm dễ làm chung |
| Database | **PostgreSQL 16** | Dữ liệu chủ yếu có quan hệ (thẻ ↔ phiên gửi ↔ thiết bị), cần transaction + ràng buộc (mỗi thẻ chỉ 1 phiên ACTIVE). Có `JSONB` để lưu telemetry linh hoạt |
| Frontend | **React 18 + Vite**, build ra static, serve bằng **Nginx** | Nhẹ, Socket.IO client cập nhật realtime |
| Triển khai | **Docker Compose** | 1 lệnh chạy cả hệ thống |

**Phương án thay thế** (nếu nhóm quen hơn):

- Backend Python: **FastAPI + paho-mqtt (hoặc aiomqtt) + SQLAlchemy + WebSocket** – tương đương.
- Backend Java: **Spring Boot + Spring Integration MQTT** – nặng hơn, phù hợp nếu môn học yêu cầu Java.
- Telemetry khối lượng lớn: thêm extension **TimescaleDB** vào chính Postgres (đổi image thành `timescale/timescaledb:latest-pg16`) thay vì tách InfluxDB.
- Không nên dùng MongoDB cho bài này: phiên gửi xe cần ràng buộc/transaction, quan hệ rõ ràng.

## 2. Chạy thử

```bash
cp .env.example .env            # (Windows: copy .env.example .env) – tùy chọn
docker compose --profile sim up --build   # có simulator giả lập ESP32
# hoặc khi đã có ESP32 thật:
docker compose up --build
```

| Dịch vụ | URL |
|---|---|
| Web khách hàng | http://localhost:8080 |
| Web nhân viên | http://localhost:8080/#/staff |
| REST API | http://localhost:3000/api/health |
| MQTT broker | `mqtt://<IP-máy>:1883` (ESP32 dùng IP LAN của máy chạy Docker) |
| PostgreSQL | `localhost:5432` user/pass `parking` / `parking` |

Reset DB (chạy lại `init.sql`): `docker compose down -v`.

Dev không Docker cho từng phần: `cd backend && npm i && npm run dev`, `cd frontend && npm i && npm run dev` (http://localhost:5173), `cd simulator && npm i && npm start`.

Debug MQTT: dùng **MQTT Explorer** kết nối `localhost:1883`, hoặc
`docker exec -it sp-mosquitto mosquitto_sub -t 'parking/#' -v`.

## 3. MQTT contract

Tất cả payload là JSON UTF-8, QoS 1. `{id}` = Device ID (vd `gate-01`, `node-01`). `ts` (ISO-8601) là tùy chọn.

### 3.1. Thiết bị → Server

| Topic | Retain | Payload ví dụ | Ý nghĩa |
|---|---|---|---|
| `parking/{id}/status` | ✔ | `{"status":"online"}` | Publish khi connect. **Đặt LWT** cùng topic với `{"status":"offline"}` |
| `parking/{id}/metadata` | ✔ | `{"name":"Cổng chính","type":"GATE","location":"Cổng A","hwVersion":"esp32-v1","fwVersion":"0.1.0","sensors":["RFID","IR_ENTRY"],"slots":[]}` | Metadata thiết bị |
| `parking/{id}/heartbeat` | | `{"uptime":123,"rssi":-55}` | Mỗi 10s. Server không nhận gì trong `DEVICE_TIMEOUT_SEC` → OFFLINE + cảnh báo |
| `parking/{id}/telemetry/slot` | | `{"slotId":"A1","state":"OCCUPIED"}` | Khi trạng thái ô đỗ đổi (`FREE`/`OCCUPIED`/`UNKNOWN`) |
| `parking/{id}/telemetry/rfid` | | `{"uid":"A1B2C3D4","gate":"ENTRY"}` | Quẹt thẻ tại cổng (`ENTRY`/`EXIT`) |
| `parking/{id}/telemetry/gate` | | `{"gate":"ENTRY"}` | IR xác nhận xe **đã đi qua** barrier (chỉ gửi sau khi barrier được mở) |
| `parking/{id}/cmd/ack` | | `{"cmdId":12,"command":"OPEN_GATE","success":true}` | Xác nhận đã thực thi lệnh |

### 3.2. Server → Thiết bị

| Topic | Retain | Payload ví dụ | Ý nghĩa |
|---|---|---|---|
| `parking/{id}/rfid/response` | | `{"uid":"A1B2C3D4","gate":"ENTRY","allowed":false,"reason":"FULL","message":"Bai da het cho","available":0}` | Kết quả kiểm tra thẻ → hiển thị LCD |
| `parking/{id}/cmd` | | `{"cmdId":12,"command":"OPEN_GATE","params":{"gate":"ENTRY"}}` | Lệnh điều khiển |
| `parking/broadcast/summary` | ✔ | `{"total":6,"free":2,"occupied":4,"cars_inside":3,"available":3}` | Số chỗ còn trống cho LCD |

`reason`: `OK`, `INVALID_CARD`, `ALREADY_INSIDE`, `FULL`, `NO_ACTIVE_SESSION`.

Commands: `OPEN_GATE {gate}`, `CLOSE_GATE`, `ENABLE_ENTRY`, `DISABLE_ENTRY`, `SET_REPORT_INTERVAL {intervalMs}`, `REQUEST_STATUS`, `RESTART_DEVICE`.

### 3.3. Luồng xe vào (sequence)

```text
ESP32                    Backend                       DB
  | telemetry/rfid  ---->  |                            |
  |                        | kiểm tra thẻ, phiên, chỗ -->|
  | <---- rfid/response    |                            |
  | <---- cmd OPEN_GATE    | (pending 20s)              |
  | mở barrier             |                            |
  | cmd/ack ------------>  |                            |
  | telemetry/gate ----->  | INSERT parking_sessions -->|
  |                        | ── Socket.IO ──> Web       |
  | <---- broadcast/summary (LCD cập nhật)              |
  | IR an toàn thông → tự đóng barrier                  |
```

Luồng ra giống hệt, `gate = EXIT`, backend `UPDATE parking_sessions SET status='COMPLETED', time_out=now()`.

> Barrier tự đóng do **firmware** quyết định (khi IR an toàn không còn vật cản) để đảm bảo an toàn kể cả khi mất mạng; server chỉ gửi `CLOSE_GATE` khi nhân viên chủ động.

## 4. REST API (`/api`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Trạng thái DB + MQTT |
| GET | `/summary` | `{total, free, occupied, unknown, cars_inside, available}` |
| GET | `/slots` | Danh sách ô đỗ + trạng thái |
| GET | `/devices` | Danh sách thiết bị + ONLINE/OFFLINE + `last_seen` |
| GET | `/devices/:id` | Chi tiết thiết bị |
| GET | `/devices/:id/commands` | Lịch sử lệnh đã gửi |
| POST | `/devices/:id/commands` | Body `{"command":"OPEN_GATE","params":{"gate":"ENTRY"}}` → 202 |
| GET | `/sessions?status=&cardUid=&from=&to=&limit=` | Phiên gửi xe / lịch sử vào-ra |
| GET | `/events?type=&deviceId=&limit=` | Nhật ký telemetry/sự kiện |
| GET | `/cards` | Danh sách thẻ |
| POST | `/cards` | Body `{"uid","ownerName","plateNumber"}` |
| PATCH | `/cards/:uid` | Body `{"active":false}` để khóa thẻ |

## 5. Socket.IO events (server → web)

| Event | Data |
|---|---|
| `summary:update` | object summary |
| `slot:update` | row `slots` |
| `device:update` | row `devices` |
| `session:update` | row `parking_sessions` |
| `event:new` | row `events` |
| `command:update` | row `commands` |
| `alert` | `{level, deviceId, message, at}` – mất kết nối, xe qua cổng trái phép |

## 6. Database

Xem [`database/init.sql`](../database/init.sql): `devices`, `slots`, `cards`, `parking_sessions`, `events`, `commands` + seed 2 thiết bị, 6 ô đỗ (A1–A6), 5 thẻ (`DEADBEEF` bị khóa; `FFFFFFFF` không tồn tại để test).

## 7. Việc cần làm trước khi production

- Mosquitto: tắt `allow_anonymous`, thêm `password_file` + ACL (mỗi thiết bị chỉ publish topic của mình), bật TLS (8883).
- Thêm đăng nhập (JWT) cho các API nhân viên (`/devices/*/commands`, `/sessions`, `/cards`).
- Dùng migration tool (vd `node-pg-migrate`/Prisma) thay cho `init.sql` khi schema thay đổi.

