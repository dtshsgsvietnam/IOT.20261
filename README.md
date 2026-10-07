# Smart Parking – IoT-Based Smart Parking System

## 1. Giới thiệu

**Smart Parking** là mô hình bãi đỗ xe thông minh ứng dụng IoT, hướng tới việc tự động hóa quá trình giám sát ô đỗ và quản lý xe vào/ra.

Các chức năng chính của hệ thống:

- Theo dõi trạng thái **trống / có xe** của từng ô đỗ.
- Quản lý xe **vào / ra** bằng thẻ RFID.
- Điều khiển barrier tại cổng.
- Hiển thị số chỗ còn trống.
- Cập nhật dữ liệu lên hệ thống trung tâm.
- Cung cấp giao diện web cho khách hàng và nhân viên quản lý.
- Lưu lịch sử các phiên gửi xe.
- Theo dõi trạng thái kết nối của thiết bị IoT.

---

## 2. Ý tưởng hệ thống

Hệ thống được chia thành ba khu vực chính.

### 2.1. Khu vực cổng vào / ra

Tại cổng sử dụng:

- **RFID Reader** để đọc thẻ gửi xe.
- **Cảm biến IR** để phát hiện xe và xác định xe đã đi qua cổng.
- **Cảm biến IR an toàn** để phát hiện vật cản trong vùng hoạt động của barrier.
- **Barrier** để kiểm soát xe vào / ra.
- **LCD** để hiển thị số chỗ còn trống và thông báo trạng thái.

Khi xe vào, hệ thống kiểm tra thẻ RFID và số chỗ còn trống. Nếu điều kiện hợp lệ, barrier được mở và hệ thống ghi nhận một phiên gửi xe.

Khi xe ra, hệ thống kiểm tra phiên gửi xe tương ứng với thẻ RFID. Nếu hợp lệ, barrier được mở và phiên gửi xe được kết thúc sau khi xe đi qua cổng.

---

### 2.2. Khu vực ô đỗ

Mỗi ô đỗ sử dụng cảm biến IR để xác định trạng thái:

- `FREE`: ô đang trống.
- `OCCUPIED`: ô đang có xe.
- `UNKNOWN`: không xác định được trạng thái.

Khi trạng thái ô đỗ thay đổi, thiết bị IoT xử lý và gửi thông tin về hệ thống trung tâm.

---

### 2.3. Máy chủ và giao diện web

Máy chủ tiếp nhận dữ liệu từ thiết bị IoT và quản lý:

- trạng thái các ô đỗ;
- số chỗ còn trống;
- số xe đang có trong bãi;
- các phiên gửi xe;
- lịch sử xe vào / ra;
- trạng thái hoạt động của thiết bị.

#### Giao diện khách hàng

Khách hàng có thể:

- xem tổng số chỗ;
- xem số chỗ còn trống;
- xem trạng thái từng ô đỗ.

#### Giao diện nhân viên quản lý

Nhân viên có thể:

- theo dõi trạng thái toàn bãi;
- xem số xe đang gửi;
- theo dõi các phiên gửi xe;
- tra cứu lịch sử xe vào / ra;
- theo dõi trạng thái kết nối của thiết bị;
- nhận cảnh báo khi thiết bị mất kết nối.

---

## 3. Kiến trúc tổng quát

```text
Cảm biến IR ───────┐
                   │
RFID Reader ───────┼────> Thiết bị IoT
                   │          │
                   │          ├────> Barrier
                   │          │
                   │          └────> LCD
                   │
                   └───────────────> Wi-Fi / Internet
                                         │
                                         v
                                      Server
                                         │
                              ┌──────────┴──────────┐
                              │                     │
                              v                     v
                           Database              Web App
```

Luồng dữ liệu chính:

```text
Cảm biến / RFID
       ↓
Thiết bị IoT
       ↓
Wi-Fi / Internet
       ↓
Server
       ↓
Database + Web App
```

Ngoài việc gửi dữ liệu lên server, hệ thống cũng hỗ trợ truyền dữ liệu theo chiều ngược lại để gửi lệnh điều khiển xuống thiết bị IoT.

---

## 4. Ví dụ luồng xe vào

```text
Xe tới cổng
    ↓
Quét thẻ RFID
    ↓
Kiểm tra thẻ
    ↓
Kiểm tra số chỗ còn trống
    ↓
Thẻ hợp lệ và còn chỗ?
    │
    ├── Có
    │    ↓
    │  Mở barrier
    │    ↓
    │  Xe đi qua cổng
    │    ↓
    │  Cảm biến xác nhận xe đã qua
    │    ↓
    │  Ghi nhận thời gian vào
    │    ↓
    │  Cập nhật trạng thái hệ thống
    │
    └── Không
         ↓
       Không mở barrier
         ↓
       Hiển thị thông báo
```

---

## 5. Dữ liệu IoT

Hệ thống sử dụng bốn nhóm dữ liệu chính.

### Metadata

Thông tin mô tả thiết bị:

- Device ID.
- Vị trí lắp đặt.
- Loại thiết bị.
- Danh sách cảm biến.
- Danh sách các ô đỗ mà thiết bị quản lý.
- Phiên bản phần cứng / phần mềm.

### Telemetry

Các dữ liệu và sự kiện phát sinh theo thời gian:

- tín hiệu cảm biến IR;
- thời điểm thay đổi trạng thái ô đỗ;
- sự kiện xe vào / ra;
- UID của thẻ RFID;
- thời điểm quét RFID.

### State

Trạng thái hiện tại của hệ thống:

- trạng thái từng ô đỗ;
- số chỗ còn trống;
- số xe đang có trong bãi;
- trạng thái barrier;
- trạng thái kết nối của thiết bị;
- thời điểm cập nhật gần nhất.

### Commands

Một số lệnh có thể được server gửi xuống thiết bị:

```text
OPEN_GATE
CLOSE_GATE
ENABLE_ENTRY
DISABLE_ENTRY
SET_REPORT_INTERVAL
REQUEST_STATUS
RESTART_DEVICE
```

---

## 6. Công nghệ truyền thông

Trong phiên bản hiện tại, hệ thống dự kiến sử dụng **Wi-Fi** để kết nối thiết bị IoT với máy chủ.

Wi-Fi phù hợp vì:

- Bãi đỗ xe có phạm vi tương đối giới hạn.
- Có thể bố trí router hoặc access point.
- Hệ thống có nguồn điện cố định.
- Dữ liệu cần được cập nhật nhanh lên giao diện web.
- Hệ thống cần truyền dữ liệu hai chiều giữa thiết bị và server.
- Không cần triển khai thêm gateway chuyên dụng.

---

## 7. Phạm vi phiên bản đầu

Các chức năng dự kiến của phiên bản MVP:

- [ ] Phát hiện trạng thái từng ô đỗ.
- [ ] Đọc thẻ RFID tại cổng.
- [ ] Quản lý xe vào.
- [ ] Quản lý xe ra.
- [ ] Điều khiển barrier.
- [ ] Phát hiện vật cản tại barrier.
- [ ] Hiển thị số chỗ còn trống trên LCD.
- [ ] Gửi dữ liệu lên server.
- [ ] Hiển thị trạng thái bãi xe trên web.
- [ ] Lưu lịch sử xe vào / ra.
- [ ] Theo dõi trạng thái thiết bị.

---

## 8. Hướng phát triển

Sau khi các chức năng cơ bản hoạt động ổn định, hệ thống có thể mở rộng thêm:

- Nhận diện biển số bằng camera.
- Liên kết biển số với phiên gửi xe.
- Tính phí gửi xe tự động.
- Thanh toán điện tử.
- Quản lý nhiều khu vực hoặc nhiều tầng.
- Thống kê mức độ sử dụng bãi đỗ.
- Hỗ trợ tìm kiếm vị trí đỗ xe.

---

## 9. Cấu trúc repository dự kiến

```text
smart-parking/
│
├── README.md
│
├── firmware/
│   └── Code cho thiết bị IoT
│
├── backend/
│   └── Server và API
│
├── frontend/
│   └── Giao diện web
│
├── hardware/
│   └── Sơ đồ phần cứng
│
└── docs/
    └── Tài liệu dự án
```

Cấu trúc này chỉ là định hướng ban đầu và có thể được thay đổi trong quá trình phát triển.

---

## 10. Trạng thái dự án

Dự án hiện đang ở giai đoạn **thiết kế ý tưởng và kiến trúc hệ thống**.

Các bước tiếp theo:

1. Chốt phần cứng sử dụng.
2. Thiết kế sơ đồ kết nối cảm biến.
3. Hoàn thiện giao tiếp giữa thiết bị IoT và server.
4. Thiết kế database.
5. Xây dựng backend.
6. Xây dựng giao diện web.
7. Tích hợp và kiểm thử toàn hệ thống.
