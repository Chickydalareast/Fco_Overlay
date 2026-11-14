# v0.4C - Camera 2K + Phòng camera tuyển thủ (package 0.4.4)

## 1. Camera trên sóng
- 4 ô camera dựng trên hệ 2K, vị trí và kích thước đo trên khung FVPL (1080p × 4/3):

| Ô | Slot | Vị trí 2K (x, y) | Ghi chú |
|---|---|---|---|
| 1 | A2 | 48, 1028 | trái, ngoài (trên thanh tên cầu thủ của game) |
| 2 | A1 | 693, 1164 | trái, trong (cạnh minimap) |
| 3 | B1 | 1495, 1164 | phải, trong (cạnh minimap) |
| 4 | B2 | 2144, 1028 | phải, ngoài |

- Mỗi ô 372×210 (16:9), viền 5px. Đội trái khung **đỏ #FF4242**, đội phải khung **cam #FE9500**.
- Player 1 ở ô trong, Player 2 ở ô ngoài (giống Intro). Studio vẫn đổi người cho từng ô như cũ.
- Không hiện tên tuyển thủ trên sóng. Trong Studio Preview, ô trống có nhãn A1/A2/B1/B2 để dễ nhận biết (không có trên OBS).
- Animation: ô mở ra từ đường giữa như màn trập (0,42 giây), tắt thì đóng lại. Ô trong chậm hơn ô ngoài 70ms. Refresh OBS thì hiện ngay.

### Khi không có hình
| Tình huống | Trên sóng |
|---|---|
| Đang kết nối / chưa có khung hình đầu | Logo giải mờ |
| Tuyển thủ xoay dọc điện thoại (camera tạm dừng) | Logo giải mờ (không lấy cam đồng đội) |
| Tuyển thủ rời phòng hẳn (mất kết nối, tắt tab) | Cam của **đồng đội** (2 ô giống nhau) |
| Cả hai tuyển thủ của đội đều không có hình | Logo giải mờ |
| Không bao giờ | Cam của đội đối diện |

## 2. Phòng camera tuyển thủ (link Player Room)
- Giao diện mới, toàn bộ tiếng Việt, màu đỏ / trắng / đen.
- Các bước: **Bật camera** (xem trước 16:9) → chọn **Đội** → chọn **Tuyển thủ** → **Gửi yêu cầu vào phòng** → chờ BTC duyệt.
- Trạng thái hiện rõ: Đang chờ BTC duyệt / Đã kết nối / Camera tạm dừng / Mất kết nối, đang tự nối lại.
- **Bắt buộc camera ngang:**
  - Camera đang dọc thì không gửi được yêu cầu, màn xem trước hiện "Xoay ngang điện thoại".
  - Đang trên sóng mà xoay dọc: camera tự tạm dừng (OBS hiện logo), xoay ngang lại thì tự chạy tiếp.
  - Máy tính dùng webcam luôn là ngang.
- Điện thoại được giữ sáng màn hình khi đã kết nối (nếu trình duyệt hỗ trợ).
- Vẫn chỉ gửi hình, không micro. Chất lượng gửi giữ như cũ: 640×360, 20 hình/giây, tối đa 700 kbps.

## 3. Test và tiêu chí PASS

### A. Tự động
- `# pass 75`, `# fail 0`, dòng cuối `SUCCESS: v0.4C installed (package 0.4.4)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| C1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4C`; footer Studio ghi v0.4C |
| C2 | Copy link Player Room, mở trên điện thoại | Giao diện tiếng Việt, logo giải, nút "Bật camera" |
| C3 | Bật camera khi cầm dọc | Hiện "Xoay ngang điện thoại", nút gửi yêu cầu bị khoá |
| C4 | Xoay ngang, chọn đội + tên, gửi yêu cầu | "Đang chờ BTC duyệt…"; Studio thấy yêu cầu |
| C5 | Studio duyệt | Phòng báo "Đã kết nối"; tag xem trước đổi thành ĐÃ KẾT NỐI (đỏ) |
| C6 | Bật LIVE 4 cam | OBS: 4 ô đúng vị trí ảnh gốc, trái viền đỏ, phải viền cam, không có tên |
| C7 | Tuyển thủ xoay dọc khi đang live | Ô đó hiện logo mờ; xoay ngang lại thì có hình |
| C8 | Tuyển thủ đóng tab | Ô đó hiện cam đồng đội (2 ô giống nhau) |
| C9 | Tắt 1 cam | Ô đóng lại như màn trập |
| C10 | Refresh OBS khi cam đang bật | Cam hiện lại ngay, không chạy animation |

## 4. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04c_<ngày giờ>_<mã>"` → quay về v0.4B r2. Không đổi database.
