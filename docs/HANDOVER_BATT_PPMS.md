# Tài liệu Bàn giao Hệ thống BATT PPMS

**Hệ thống Quản lý Quy trình Sản xuất Viên gỗ nén Nội bộ (BATT Production Process Management System)**  
**Đơn vị áp dụng:** CÔNG TY CỔ PHẦN NĂNG LƯỢNG TÁI TẠO BATT

---

## 1. Tổng quan Kiến trúc & Công nghệ

- **Giao diện người dùng (Frontend):** React 19, TypeScript, React Router v7, Tailwind CSS v4, Lucide Icons. 100% tiếng Việt nghiệp vụ rõ ràng, tương thích responsive từ điện thoại hiện trường (`360px`) đến màn hình bàn làm việc (`1440px+`), không tràn ngang.
- **Máy chủ & API (Backend):** Node.js v22 + Express (`server.ts`, `/server/app.ts`) chạy đồng nhất trên cổng `3000`, phân quyền chặt chẽ ở cả cấp độ định tuyến giao diện và middleware API (`requireAuth`, `requireRoles`) kèm kiểm tra trạng thái tài khoản thời gian thực.
- **Cơ sở dữ liệu giao dịch:** SQLite tích hợp gốc của Node 22 (`node:sqlite` `DatabaseSync`) ở chế độ `WAL` + `FOREIGN KEYS = ON` + giao dịch nguyên tử `BEGIN IMMEDIATE` (`withTransaction`), lưu trữ bền vững tại `/data/batt_ppms.sqlite` và chứng từ đính kèm tại `/data/uploads/`.
- **Đồng bộ & Bảo mật Đám mây:** Đã tích hợp cấu hình Firebase (`firebase-applet-config.json`) và bộ quy tắc bảo mật `firestore.rules` tuân thủ kiểm định tĩnh ESLint và kiểm thử 12 tiêu chí bảo mật (Dirty Dozen).

---

## 2. Hướng dẫn Chạy, Đóng gói & Kiểm thử

```bash
# 1. Chạy môi trường phát triển (Express + Vite trên cổng 3000)
npm run dev

# 2. Kiểm tra kiểu tĩnh TypeScript trên toàn bộ dự án
npm run lint

# 3. Đóng gói bản dựng giao diện Production
npm run build

# 4. Khởi chạy máy chủ Production (Node 22 chạy trực tiếp server.ts + phục vụ dist/)
npm start

# 5. Chạy bộ kiểm thử tích hợp đa vai trò (tự tạo CSDL tạm độc lập, không ảnh hưởng dữ liệu thật)
npx tsx tests/batt_ppms.test.ts

# 6. Chạy kiểm định quy tắc bảo mật Firestore
npx eslint firestore.rules
npx tsx firestore.rules.test.ts
```

> **Biến môi trường tùy chọn:**
> - `BATT_DATA_DIR`: Thư mục lưu tệp CSDL SQLite và chứng từ tải lên (mặc định `./data`).
> - `BATT_DB_PATH`: Đường dẫn tệp SQLite cụ thể (mặc định `<BATT_DATA_DIR>/batt_ppms.sqlite`).

---

## 3. Danh sách Tài khoản Demo Nội bộ

Tất cả tài khoản mẫu dùng chung mật khẩu mặc định: **`Batt@2026`**  
*(Nhà cung cấp và Khách hàng là đối tác giao dịch bên ngoài, chỉ quản lý hồ sơ danh mục và chứng từ, không có tài khoản đăng nhập hệ thống).*

| STT | Tên đăng nhập | Họ và tên | Mã vai trò (`RoleCode`) | Tên hiển thị chuẩn | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `owner` | Nguyễn Quốc Bảo | `OWNER` | **Chủ doanh nghiệp** | Đang hoạt động |
| 2 | `manager` | Trần Minh Quản | `MANAGER` | **Quản lý xưởng** | Đang hoạt động |
| 3 | `purchasing1` | Lê Thị Thu Mua | `PURCHASING_STAFF` | **Nhân viên thu mua** | Đang hoạt động |
| 4 | `warehouse1` | Phạm Văn Kho | `WAREHOUSE_KEEPER` | **Thủ kho** | Đang hoạt động |
| 5 | `staff1` | Hoàng Văn Ca Một | `STAFF` | **Công nhân** | Đang hoạt động |
| 6 | `staff2` | Vũ Văn Ca Hai | `STAFF` | **Công nhân** | Đang hoạt động |
| 7 | `qc1` | Đỗ Thị Kiểm Định | `QC_STAFF` | **Nhân viên QC** | Đang hoạt động |
| 8 | `maint1` | Ngô Văn Bảo Trì | `MAINTENANCE_STAFF` | **Nhân viên bảo trì** | Đang hoạt động |
| 9 | `admin` | Bùi Hệ Thống | `ADMIN_SYSTEM` | **Quản trị hệ thống** | Đang hoạt động |
| 10 | `inactive_user` | Đặng Văn Ngừng Việc | `STAFF` | **Công nhân** | Ngừng sử dụng (dùng kiểm thử chặn đăng nhập) |

---

## 4. Ma trận Phân quyền Actor – Màn hình – Nghiệp vụ

Chú giải: **X** = Xem & Tra cứu | **T/S** = Tạo / Cập nhật theo trạng thái hợp lệ | **D** = Duyệt / Ra quyết định | **XN** = Xác nhận kho / Nghiệm thu | `—` = Không có quyền (ẩn menu & chặn HTTP `403`).

| Nhóm | Đường dẫn | Màn hình | Chủ DN (`OWNER`) | Quản lý xưởng (`MANAGER`) | NV thu mua (`PURCHASING_STAFF`) | Thủ kho (`WAREHOUSE_KEEPER`) | Công nhân (`STAFF`) | NV QC (`QC_STAFF`) | NV bảo trì (`MAINTENANCE_STAFF`) | Quản trị HT (`ADMIN_SYSTEM`) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Chung | `/tong-quan` | Tổng quan theo vai trò | X | X | X | X | X | X | X | X |
| Chung | `/tai-khoan-ca-nhan` | Hồ sơ & Đổi mật khẩu | X, T/S | X, T/S | X, T/S | X, T/S | X, T/S | X, T/S | X, T/S | X, T/S |
| Đối tác | `/nha-cung-cap` | Quản lý nhà cung cấp | X | X, T/S | X, T/S | — | — | — | — | — |
| Đối tác | `/khach-hang` | Quản lý khách hàng | X, T/S | X, T/S | — | — | — | — | — | — |
| Thu mua & Kho NVL | `/thu-mua-nvl` | Phiếu thu mua NVL | X, D | X, D | X, T/S | — | — | — | — | — |
| Thu mua & Kho NVL | `/nhan-nvl-vao-kho` | Nhận NVL vào kho | X | X | — | X, XN | — | — | — | — |
| Thu mua & Kho NVL | `/cap-nvl-san-xuat` | Cấp NVL cho sản xuất | X | X | — | X, T/S | — | — | — | — |
| Thu mua & Kho NVL | `/ton-kho-nvl` | Tồn kho & Sổ thẻ NVL | X | X | X | X | — | — | — | — |
| Sản xuất & QC | `/ke-hoach-san-xuat` | Kế hoạch & Giao việc ca | X | X, T/S | — | X | — | — | — | — |
| Sản xuất & QC | `/cong-viec-duoc-giao` | Công việc ca của tôi | — | — | — | — | X, XN | — | — | — |
| Sản xuất & QC | `/bao-cao-ca` | Báo cáo sản xuất cuối ca | X | X, D | — | — | X, T/S | — | — | — |
| Sản xuất & QC | `/qc-theo-ca` | Kiểm tra chất lượng ca | X | X | — | — | — | X, T/S | — | — |
| Kho TP | `/nhap-kho-thanh-pham` | Tiếp nhận thành phẩm | X | X | — | X, XN | — | — | — | — |
| Kho TP | `/ton-kho-thanh-pham` | Tồn kho & Truy xuất lô TP | X | X | — | X | — | X | — | — |
| Xuất hàng | `/yeu-cau-xuat-hang` | Yêu cầu xuất hàng (FIFO) | X | X, T/S | — | — | — | — | — | — |
| Xuất hàng | `/duyet-xuat-hang` | Duyệt xuất hàng | X, D | — | — | — | — | — | — | — |
| Xuất hàng | `/ban-giao-xuat-kho` | Xác nhận bàn giao xuất kho | X | X | — | X, XN | — | — | — | — |
| Bảo trì | `/su-co-may-moc` | Quản lý sự cố máy móc | X | X, D, XN | — | — | X (Báo sự cố) | — | X, T/S | — |
| Bảo trì | `/vat-tu-bao-tri` | Phiếu yêu cầu vật tư bảo trì | X | X, D | — | — | — | — | X, T/S | — |
| Tài chính & Báo cáo | `/cong-no-phai-tra` | Công nợ phải trả NCC | X, T/S | — | X (Chỉ xem) | — | — | — | — | — |
| Tài chính & Báo cáo | `/cong-no-phai-thu` | Công nợ phải thu KH | X, T/S | — | — | — | — | — | — | — |
| Tài chính & Báo cáo | `/doi-soat-chung-tu` | Đối soát chứng từ liên khâu | X | X (Phạm vi xưởng) | — | — | — | — | — | — |
| Tài chính & Báo cáo | `/bao-cao-thong-ke` | Báo cáo thống kê tổng hợp | X (Đủ 10 báo cáo) | X (Báo cáo xưởng) | — | — | — | — | — | — |
| Hệ thống | `/quan-tri-tai-khoan` | Tài khoản & Yêu cầu cấp lại MK | — | — | — | — | — | — | — | X, T/S, D |

---

## 5. Lược đồ Cơ sở Dữ liệu (22 Bảng Quan hệ) & Bất biến Nghiệp vụ

### 5.1. Danh sách 22 bảng SQLite
1. `users`: Hồ sơ người dùng nội bộ, vai trò (`RoleCode`), trạng thái `ACTIVE`/`INACTIVE`, mật khẩu băm `scrypt`.
2. `sessions`: Phiên đăng nhập có thời hạn; thu hồi tức thì toàn bộ phiên khi khóa tài khoản hoặc đặt lại mật khẩu.
3. `password_reset_requests`: Yêu cầu hỗ trợ đặt lại mật khẩu gửi tới `ADMIN_SYSTEM`.
4. `suppliers`: Hồ sơ nhà cung cấp nguyên vật liệu (`ACTIVE`/`INACTIVE`).
5. `customers`: Hồ sơ khách hàng mua viên gỗ nén, cấp chất lượng chấp nhận (`Grade A` / `Grade B` / `BOTH`).
6. `purchasing_orders`: Phiếu thu mua `NVL`, lưu tách biệt `expected_weight_kg` (cân phiếu) và `received_weight_kg` (thực nhận kho).
7. `raw_inventory`: Tồn kho tổng `NVL` hợp nhất (`available_kg`).
8. `raw_inventory_ledger`: Sổ cái biến động nhập/xuất `NVL` kèm tồn sau giao dịch.
9. `production_plans`: Kế hoạch sản xuất ngày/ca (`Shift 1`, `Shift 2`, `Shift 3`), định mức tham chiếu và quy đổi gầu xúc lật (`~100 kg/gầu`).
10. `plan_assignments`: Phân công công nhân theo kế hoạch ca và trạng thái xác nhận nhận ca.
11. `raw_material_issues`: Phiếu Thủ kho xuất cấp `NVL` thực tế cho ca sản xuất.
12. `shift_reports`: Báo cáo cuối ca của công nhân, sinh mã lô bất biến `TP/YY/MM/DD-C{ca}-{stt}`.
13. `finished_batches`: Hồ sơ lô thành phẩm `Viên gỗ nén`, lưu tách biệt `inspection_result` và `grade` (`Grade A` / `Grade B`), trạng thái kho và `available_kg`.
14. `qc_inspections`: Biên bản `SHIFT_QC` (QC theo ca); không bao giờ ghi đè kết quả lịch sử.
15. `finished_goods_receipts`: Phiếu Thủ kho tiếp nhận lô thành phẩm đạt chuẩn vào kho.
16. `outbound_orders`: Yêu cầu xuất hàng của Quản lý xưởng, quyết định của Chủ doanh nghiệp, thông tin người nhận/biển số xe.
17. `outbound_allocations`: Phân bổ lô xuất theo nguyên tắc **FIFO** (ưu tiên ngày sản xuất cũ nhất còn tồn khả dụng và khớp `Grade`).
18. `outbound_dispatches`: Lịch sử từng đợt Thủ kho bàn giao thực tế (hỗ trợ giao 1 phần hoặc giao đủ).
19. `outbound_dispatch_items`: Chi tiết khối lượng xuất thực tế trên từng lô trong mỗi đợt bàn giao.
20. `machine_incidents`: Sự cố máy móc, gộp bước tiếp nhận + giao việc của Quản lý xưởng, kết quả sửa chữa và nghiệm thu.
21. `spare_part_requests` & `spare_part_request_items` *(cùng nhóm bảo trì)*: Phiếu đề xuất vật tư bảo trì nhiều dòng, hỗ trợ **duyệt/từ chối độc lập từng hạng mục**.
22. `payables`, `payable_payments`, `receivables`, `receivable_payments`, `attachments`, `audit_logs`, `notifications`: Công nợ phải trả/phải thu, lịch sử thanh toán từng đợt, chứng từ đính kèm, nhật ký kiểm toán và thông báo nội bộ.

### 5.2. Các bất biến nghiệp vụ cốt lõi được cưỡng chế ở tầng Giao dịch Backend
- **Tồn kho NVL:** Chỉ tăng đúng 1 lần khi `WAREHOUSE_KEEPER` xác nhận nhận hàng thực tế (`POST /api/purchasing/:id/receive`). Nếu khối lượng thực nhận khác khối lượng phiếu thu mua, bắt buộc nhập ghi chú chênh lệch và tuyệt đối giữ nguyên số cân gốc trên phiếu thu mua. Tồn kho `NVL` chỉ giảm khi `WAREHOUSE_KEEPER` lập phiếu cấp NVL (`<= available_kg`).
- **Mã lô & Tồn kho Thành phẩm:** Mã lô `TP/YY/MM/DD-C{ca}-{stt}` được cấp ngay khi gửi báo cáo ca lần đầu và giữ nguyên bất biến kể cả khi Quản lý xưởng trả lại yêu cầu chỉnh sửa. Tồn kho thành phẩm chỉ tăng đúng 1 lần khi hội đủ: Báo cáo ca `APPROVED` + QC ca `INSPECTED` (có ảnh bằng chứng và xếp hạng `Grade A`/`Grade B`) + Thủ kho xác nhận tiếp nhận vào kho.
- **Xuất hàng FIFO (dựa trên QC theo ca) & Bàn giao kho:** Tạo đơn xuất tự động đề xuất các lô cũ nhất theo FIFO đã đạt `QC theo ca` (`INSPECTED` + `IN_STOCK`) khớp `Grade` khách nhận và chặn tạo đơn nếu thiếu tồn khả dụng. Đơn xuất sau khi tạo được đính kèm hồ sơ `QC theo ca` của các lô phân bổ và chuyển thẳng cho `OWNER` quyết định (`APPROVE` / `REJECT`), không qua bước QC trước xuất hàng. Phê duyệt của `OWNER` không trừ kho; tồn kho chỉ bị trừ khi `WAREHOUSE_KEEPER` xác nhận bàn giao thực tế.
- **Công nợ tự động & trung thực:** Công nợ phải trả phát sinh từ khối lượng `NVL` thực nhận tại kho; công nợ phải thu chỉ phát sinh/cập nhật theo khối lượng thành phẩm đã bàn giao thực tế với `paid_amount = 0` (`UNPAID`) cho đến khi `OWNER` ghi nhận thanh toán.

---

## 6. Kết quả Kiểm thử Tự động Thực tế

### 6.1. Kiểm thử tích hợp đa vai trò (`npx tsx tests/batt_ppms.test.ts` — **6/6 PASS**)
| Mã TC | Kịch bản kiểm thử đầu-cuối (End-to-End API) | Kết quả thực tế |
| :--- | :--- | :--- |
| **TC-01** | Đăng nhập toàn bộ 8 vai trò nội bộ (9 tài khoản `ACTIVE`) và kiểm tra chặn tài khoản `inactive_user` (`INACTIVE`). | **PASS** — 9 tài khoản đăng nhập HTTP `200`, đúng `RoleCode` & nhãn tiếng Việt; `inactive_user` bị chặn HTTP `403`. |
| **TC-02** | Kiểm tra phân quyền RBAC chéo: chặn người dùng tự đổi `role`/`status`, chặn `ADMIN_SYSTEM` truy cập dữ liệu sản xuất/tài chính, chặn `MANAGER` vào công nợ & phê duyệt xuất hàng của `OWNER`, thu hồi phiên ngay khi `ADMIN_SYSTEM` khóa tài khoản. | **PASS** — Toàn bộ truy cập trái quyền trả về HTTP `403`; phiên đang mở của tài khoản vừa khóa bị từ chối ngay với HTTP `401`. |
| **TC-03** | Luồng Thu mua `NVL`: `PURCHASING_STAFF` tạo phiếu 10.000 kg kèm ảnh cân -> `MANAGER` duyệt (kiểm tra tồn kho chưa tăng) -> `WAREHOUSE_KEEPER` nhận thực tế 9.850 kg (kiểm tra bắt buộc ghi chú chênh lệch, tăng tồn đúng +9.850 kg, giữ nguyên cân phiếu 10.000 kg, chặn nhận trùng lần 2, tự tạo công nợ phải trả `UNPAID`). | **PASS** — Tồn NVL giữ nguyên `10.400 kg` khi duyệt phiếu, tăng lên `20.250 kg` đúng thời điểm Thủ kho nhận, chặn nhận trùng HTTP `409`. |
| **TC-04** | Luồng Sản xuất & QC Ca: `MANAGER` lập kế hoạch & phân công -> `STAFF` nhận ca -> `WAREHOUSE_KEEPER` cấp NVL -> `STAFF` gửi báo cáo ca sinh mã lô `TP/26/10/25-C1-01` -> `MANAGER` từ chối -> `STAFF` sửa & gửi lại (kiểm tra bảo toàn mã lô) -> `MANAGER` duyệt -> `QC_STAFF` lập QC ca `Grade A` kèm ảnh -> `WAREHOUSE_KEEPER` tiếp nhận thành phẩm. | **PASS** — Mã lô `TP/26/10/25-C1-01` bất biến qua chu trình trả lại/gửi lại; tồn thành phẩm tăng đúng 1 lần `+4.200 kg` khi Thủ kho tiếp nhận. |
| **TC-05** | Luồng Xuất hàng FIFO & Công nợ phải thu: `MANAGER` tạo yêu cầu xuất 3.000 kg (tự phân bổ FIFO dựa trên các lô đã đạt `QC theo ca`, chuyển thẳng sang `PENDING_OWNER` kèm hồ sơ QC theo ca) -> `OWNER` phê duyệt (tồn chưa giảm) -> `MANAGER` cập nhật người nhận & biển số xe -> `WAREHOUSE_KEEPER` bàn giao đợt 1 (`1.200 kg` -> `PARTIALLY_DISPATCHED`) và đợt 2 (`1.800 kg` -> `DISPATCHED`). | **PASS** — Tồn thành phẩm chỉ giảm khi Thủ kho bàn giao đủ 2 đợt (`-3.000 kg`); công nợ phải thu tạo tự động ở trạng thái `UNPAID` (`paidAmount = 0`). |
| **TC-06** | Luồng Bảo trì & Vật tư: `STAFF` báo sự cố -> `MANAGER` tiếp nhận + giao việc gộp 1 bước cho `MAINTENANCE_STAFF` -> lập phiếu đề xuất 2 hạng mục vật tư -> `MANAGER` duyệt độc lập (Mục 1 `APPROVED`, Mục 2 `REJECTED`) -> cập nhật hoàn thành sửa chữa -> chặn `MAINTENANCE_STAFF` tự nghiệm thu -> `MANAGER` nghiệm thu đóng sự cố. | **PASS** — Trạng thái phiếu vật tư ghi nhận `PARTIALLY_APPROVED` với từng dòng độc lập; chặn tự nghiệm thu HTTP `403`; nghiệm thu hợp lệ HTTP `200`. |

### 6.2. Kiểm định Quy tắc Bảo mật Firestore (`firestore.rules.test.ts` — **12/12 PASS**)
- Đã kiểm tra bằng `@firebase/eslint-plugin-security-rules` (`0 errors`) và kịch bản kiểm định 12 quy tắc bảo mật (chặn truy cập ẩn danh, chặn leo thang đặc quyền `role`/`status`, khóa nhật ký kiểm toán bất biến, kiểm tra kiểu dữ liệu & giới hạn kích thước tài liệu).

---

## 7. Các Hạng mục Chờ Doanh nghiệp Xác nhận thêm & Lưu ý Triển khai

1. **Tỷ lệ hao hụt chuẩn theo từng công đoạn nhỏ** *(nghiền -> sấy -> ép viên -> làm nguội -> đóng bao)*: Hiện hệ thống chỉ hiển thị chênh lệch khối lượng trung thực giữa **Tổng NVL thực cấp** và **Tổng thành phẩm nhập kho**, không tự áp đặt ngưỡng phần trăm hao hụt giả định cho từng công đoạn khi chưa có định mức chính thức từ Ban Giám đốc/Kỹ thuật BATT.
2. **Ngưỡng số học cứng cho chỉ tiêu QC** *(độ ẩm %, tỷ lệ vụn %, khối lượng riêng)*: Hiện biên bản QC lưu trữ trung thực nhận xét thực tế, ảnh bằng chứng bắt buộc, kết quả đạt/không đạt và phân loại `Grade A` / `Grade B` độc lập do Nhân viên QC xác định. Khi BATT ban hành bảng tiêu chuẩn số học cố định cho từng cấp `Grade`, có thể cấu hình cảnh báo tự động trên biểu mẫu QC.
3. **Công thức tính Lợi nhuận ròng / Giá thành sản xuất toàn diện:** Báo cáo hiện tổng hợp trung thực doanh thu xuất kho thực tế, giá trị thu mua thực nhận và dư nợ phải thu/phải trả thực tế; chưa tự suy diễn khấu hao máy móc, điện năng và nhân công ca vào công thức lợi nhuận ròng.
4. **Rà soát bảo mật trước khi vận hành chính thức:** Trước khi đưa hệ thống lên môi trường Production thực tế của doanh nghiệp, đội ngũ quản trị cần đổi toàn bộ mật khẩu mặc định (`Batt@2026`), cấu hình sao lưu định kỳ thư mục `/data/` và rà soát/siết chặt lại bộ quy tắc bảo mật `firestore.rules` cùng danh sách quản trị viên theo đúng chính sách nội bộ của Công ty Cổ phần Năng lượng Tái tạo BATT.
