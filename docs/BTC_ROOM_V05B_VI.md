# v0.5B - Giao diện Phòng BTC mới (package 0.5.1)

Chỉ đổi giao diện Phòng BTC (`/admin-room`) cho cùng phong cách với Studio v0.5A. Logic giữ nguyên: xem cam bản nhỏ, mic + Space để nói, chuyển tiếp âm thanh Discord, cảnh báo 2 BTC cùng chuyển tiếp. Phòng BTC vẫn tiếng Việt.

## Thay đổi
- Nền đen trung tính, font Barlow Condensed in hoa giống Studio; khung dùng hết màn 1920, 4 cam luôn vừa chiều cao cửa sổ (không phải cuộn).
- Thanh trên: logo giải, PHÒNG BTC, trận đang đá, trạng thái kết nối dạng chấm (xanh = đã kết nối, vàng = đang kết nối, đỏ = lỗi).
- Cam: viền đỏ đội trái / cam đội phải (giống trên sóng) vẽ trên hình; nhãn P1/P2 màu đội, tên tuyển thủ in hoa, trạng thái có chấm màu: xanh = đang gửi hình, vàng = đang kết nối / tạm dừng (đang dọc), xám = chưa vào phòng.
- **Nút mic và chuyển tiếp: xám khi tắt, ĐỎ khi tuyển thủ đang nghe bạn** (trước đây nút mic luôn đỏ kể cả khi tắt).
- Thanh mức âm thanh xanh → vàng → đỏ; "Trong phòng" hiện 2 số lớn.

## Test và tiêu chí PASS
### A. Tự động
- `# pass 105`, `# fail 0`, dòng cuối `SUCCESS: v0.5B installed (package 0.5.1)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| B1 | `npm start`, Studio → BTC Room (Ctrl+F5) | Trang đăng nhập / phòng nền đen giống Studio; footer Studio `v0.5B` |
| B2 | Tuyển thủ bật cam | Ô cam có viền màu đội, nhãn `ĐANG GỬI HÌNH` chấm xanh |
| B3 | Bấm BẬT MIC | Nút chuyển đỏ `TẮT MIC`; tuyển thủ nghe được |
| B4 | Tắt mic, giữ Space | Nút đỏ `ĐANG NÓI (SPACE)` khi giữ, về xám khi thả |
| B5 | Bắt đầu chuyển tiếp | Nút đỏ `DỪNG CHUYỂN TIẾP`, thanh mức âm chạy |
| B6 | Bỏ tick XEM CAM | Cam ngừng tải hình (tiết kiệm quota) |

## Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\btc_v05b_<ngày giờ>_<mã>"` → quay về v0.5A. Không đổi database.
