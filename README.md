Smart Parking – IoT-Based Smart Parking System
1. Giới thiệu
Smart Parking là mô hình bãi đỗ xe thông minh ứng dụng IoT, hướng tới việc:
- Theo dõi trạng thái trống / có xe của từng ô đỗ.
- Quản lý xe vào / ra bằng thẻ RFID.
- Tự động điều khiển barrier tại cổng.
- Cập nhật số chỗ còn trống theo thời gian thực.
- Cung cấp giao diện web cho khách hàng và nhân viên quản lý.
- Lưu lịch sử các phiên gửi xe và theo dõi trạng thái thiết bị.
Dự án phù hợp với mô hình thử nghiệm cho bãi đỗ xe trong nhà như bãi xe tại trường học, văn phòng hoặc trung tâm thương mại.
2. Ý tưởng hệ thống
Hệ thống được chia thành ba phần chính:
A. Khu vực cổng vào / ra
- RFID dùng để nhận diện thẻ gửi xe.
- Cảm biến IR phát hiện xe tại cổng và xác định xe đã đi qua hay chưa.
- Barrier tự động mở khi yêu cầu hợp lệ.
- Barrier không đóng nếu vẫn phát hiện vật cản.
- Màn hình LCD hiển thị các thông tin như:
  - số chỗ còn trống;
  - “Mời vào”;
  - “Bãi đầy”;
  - trạng thái thẻ.
B. Khu vực ô đỗ
Mỗi ô đỗ có cảm biến IR để xác định:
- FREE – ô đang trống;
- OCCUPIED – ô đang có xe;
- UNKNOWN – không xác định được trạng thái do lỗi hoặc mất kết nối.
Các thay đổi trạng thái được gửi về hệ thống trung tâm.
C. Máy chủ và giao diện web
Máy chủ nhận dữ liệu từ các thiết bị IoT qua mạng, lưu trạng thái bãi xe và lịch sử các phiên gửi xe.
Có thể xây dựng hai giao diện:
Khách hàng
- Xem tổng số chỗ.
- Xem số chỗ còn trống.
- Xem trạng thái từng ô đỗ.
Nhân viên quản lý
- Theo dõi trạng thái toàn bãi.
- Xem các phiên gửi xe đang hoạt động.
- Tra cứu lịch sử xe vào / ra.
- Theo dõi tình trạng kết nối của thiết bị.
- Nhận cảnh báo khi thiết bị mất kết nối.
3. Luồng hoạt động cơ bản
Cảm biến IR ─────┐
                 │
RFID Reader ─────┼──> Thiết bị IoT ───> Wi-Fi / Internet ───> Server
                 │          │                                  │
                 │          ├──> Barrier                       ├──> Database
                 │          └──> LCD                           └──> Web App
Ví dụ luồng xe vào
Xe tới cổng
   ↓
Quét RFID
   ↓
Kiểm tra thẻ + kiểm tra còn chỗ
   ↓
Hợp lệ?
 ┌───────┴────────┐
Có               Không
 ↓                  ↓
Mở barrier      Không mở barrier
 ↓                  ↓
Xe đi qua       Hiển thị thông báo lỗi
 ↓
Cảm biến xác nhận xe đã qua
 ↓
Ghi nhận thời gian vào
 ↓
Cập nhật số chỗ còn trống
4. Dữ liệu IoT
Thiết bị có thể trao đổi bốn nhóm dữ liệu chính:
Metadata
Thông tin mô tả thiết bị:
- Device ID
- vị trí lắp đặt
- phiên bản phần cứng / phần mềm
- danh sách cảm biến
- các ô đỗ mà thiết bị quản lý
Telemetry
Dữ liệu và sự kiện theo thời gian:
- trạng thái cảm biến IR;
- thời điểm xe vào / ra;
- UID RFID;
- thời điểm thay đổi trạng thái ô đỗ.
State
Trạng thái hiện tại của hệ thống:
- trạng thái từng ô đỗ;
- số chỗ còn trống;
- số xe trong bãi;
- trạng thái barrier;
- trạng thái kết nối của thiết bị.
Commands
Lệnh từ server gửi xuống thiết bị, ví dụ:
OPEN_GATE
CLOSE_GATE
ENABLE_ENTRY
DISABLE_ENTRY
SET_REPORT_INTERVAL
REQUEST_STATUS
RESTART_DEVICE
5. Kiến trúc dự kiến
[ Sensors / RFID ]
        │
        ▼
[ IoT Controller ]
        │
        │ Wi-Fi
        ▼
[ Backend / Server ]
        │
   ┌────┴─────┐
   ▼          ▼
Database    Web App
Trong bản demo, Wi-Fi phù hợp vì hệ thống hoạt động trong phạm vi bãi xe, có nguồn điện cố định và cần trao đổi dữ liệu hai chiều với máy chủ.
6. Phạm vi phiên bản đầu
MVP tập trung vào các chức năng cốt lõi:
- [ ] Phát hiện trạng thái từng ô đỗ.
- [ ] Đọc RFID tại cổng.
- [ ] Quản lý phiên xe vào / ra.
- [ ] Điều khiển barrier.
- [ ] Hiển thị số chỗ trống trên LCD.
- [ ] Gửi dữ liệu từ thiết bị lên server.
- [ ] Dashboard hiển thị trạng thái bãi xe.
- [ ] Lưu lịch sử xe vào / ra.
- [ ] Cảnh báo khi thiết bị mất kết nối.
7. Hướng phát triển
Sau khi MVP hoạt động ổn định, hệ thống có thể mở rộng thêm:
- nhận diện biển số xe bằng camera;
- tính phí tự động theo thời gian gửi;
- thanh toán điện tử;
- quản lý nhiều tầng / nhiều khu vực;
- thống kê mức sử dụng bãi đỗ;
- đặt chỗ trước;
- thông báo vị trí ô trống gần nhất.
8. Cấu trúc repo dự kiến
smart-parking/
├── README.md
├── firmware/
├── backend/
├── frontend/
├── docs/
└── hardware/
Cấu trúc cụ thể sẽ được điều chỉnh khi nhóm chốt phần cứng, framework backend và frontend.
9. Trạng thái dự án
Hiện tại dự án đang ở giai đoạn thiết kế ý tưởng và kiến trúc hệ thống.
Mục tiêu tiếp theo là chốt:
1. phần cứng điều khiển;
2. sơ đồ kết nối cảm biến;
3. giao thức giữa thiết bị IoT và server;
4. database;
5. giao diện web;
6. kịch bản kiểm thử toàn hệ thống.
