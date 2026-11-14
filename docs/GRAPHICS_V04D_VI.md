# v0.4D - Phòng BTC + nói với tuyển thủ + chuyển tiếp âm thanh Discord (package 0.4.5)

## 1. Phòng BTC
- Mở bằng nút **Phòng BTC** trên thanh trên cùng của Studio (mở tab mới), hoặc link riêng `http://<máy chủ>:4173/admin-room`.
- Đăng nhập bằng mật khẩu Studio (admin123). Đã đăng nhập Studio trên cùng trình duyệt thì vào thẳng.
- Không giới hạn số BTC. Phòng BTC là **cùng phòng** với 4 tuyển thủ của BO hiện tại; đổi BO (TAKE trận mới) thì trang tự chuyển sang phòng mới trong vòng 20 giây.
- Xem 4 cam bản nhỏ 320×180 (tiết kiệm quota LiveKit). Mỗi ô ghi tên tuyển thủ và trạng thái: Đang gửi hình / Tạm dừng (đang dọc) / Đang kết nối / Chưa vào phòng.
- Bỏ tick "Xem cam" để chỉ nghe/nói, không tốn băng thông xem hình.

## 2. Nói với tuyển thủ
- Chọn micro → bấm **Bật mic** (bấm lại để tắt), hoặc **giữ phím Space** để nói nhanh.
- Thanh đo âm lượng hiện khi mic đang mở.
- Tuyển thủ nghe qua tab Phòng camera của họ: có đèn "BTC đang nói", nút Tắt tiếng, thanh âm lượng (nhớ theo máy).
- Nếu trình duyệt của tuyển thủ chặn tự phát âm thanh, tab của họ hiện nút "Bấm để bật âm thanh".
- **Không lên stream**: OBS không bao giờ nhận âm thanh. Phòng BTC cũng không phát âm thanh của ai (không bị vọng).

## 3. Chuyển tiếp âm thanh Discord cho tuyển thủ
Cách A, khuyên dùng với Discord app (VB-Cable, miễn phí):
1. Cài **VB-Audio Virtual Cable**, khởi động lại máy.
2. Discord → Cài đặt → Giọng nói & Video → Thiết bị đầu ra: **CABLE Input**.
3. Để bạn vẫn nghe Discord: Windows Sound → Recording → **CABLE Output** → Properties → Listen → tick "Listen to this device", chọn tai nghe của bạn.
4. Trong Phòng BTC, mục "Chuyển tiếp âm thanh" chọn **CABLE Output** (trang tự chọn sẵn nếu tìm thấy) → **Bắt đầu chuyển tiếp**.

Cách B, Discord mở trên Chrome/Edge: chọn nguồn "Âm thanh tab / màn hình" → chọn tab Discord → tick **Chia sẻ âm thanh tab**.

- Kênh chuyển tiếp giữ nguyên âm thanh gốc (tắt khử ồn, khử vọng, tự cân âm lượng), 64 kbps.
- Hai BTC cùng chuyển tiếp thì trang hiện cảnh báo (tuyển thủ sẽ nghe 2 nguồn).
- Âm thanh OBS cũng dẫn được: OBS → Advanced Audio Properties → Audio Monitoring = Monitor Only, Settings → Audio → Monitoring Device = CABLE Input.

## 4. Thay đổi kỹ thuật
- Cam tuyển thủ gửi 2 lớp: 640×360 (OBS dùng, giữ nguyên chất lượng cũ) và 320×180 (Phòng BTC). Lớp nhỏ tự dừng khi không có BTC nào xem.
- Quyền tuyển thủ: được nhận (để nghe BTC); trang tuyển thủ chỉ nhận âm thanh của BTC, không nhận cam người khác.
- Quyền BTC: chỉ gửi micro và âm thanh chuyển tiếp, không gửi cam.
- Chỉ trang Phòng BTC được xin quyền micro / chia sẻ âm thanh; các trang khác bị trình duyệt chặn micro.
- Quota LiveKit: mỗi BTC đang mở trang tính thêm 1 kết nối (khoảng 60 phút kết nối mỗi giờ). Đóng tab Phòng BTC khi không cần.

## 5. Test và tiêu chí PASS

### A. Tự động
- `# pass 79`, `# fail 0`, dòng cuối `SUCCESS: v0.4D installed (package 0.4.5)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| D1 | `npm start`, mở Studio | Terminal có `GRAPHICS STUDIO v0.4D`; thanh trên có nút "Phòng BTC" |
| D2 | Bấm Phòng BTC | Tab mới "PHÒNG BTC", trạng thái "Đã kết nối", tên 2 đội |
| D3 | 1–2 tuyển thủ vào phòng camera | Ô tương ứng hiện hình nhỏ + "Đang gửi hình" |
| D4 | Tuyển thủ xoay dọc | Ô đó "Tạm dừng (đang dọc)" |
| D5 | Bật mic, nói | Tab tuyển thủ: đèn đỏ "Âm thanh từ BTC" sáng, nghe rõ tiếng |
| D6 | Giữ Space nói, thả ra | Chỉ nghe khi đang giữ |
| D7 | Chuyển tiếp CABLE Output, phát tiếng trên Discord | Tuyển thủ nghe tiếng Discord |
| D8 | Nghe stream / OBS | **Không** có tiếng BTC hay Discord trên stream |
| D9 | OBS bật 4 cam | Hình cam trên OBS vẫn nét như trước (640×360) |
| D10 | Mở Phòng BTC trên máy thứ 2 | Cả 2 cùng vào được; cùng chuyển tiếp thì hiện cảnh báo |

## 6. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04d_<ngày giờ>_<mã>"` → quay về v0.4C. Không đổi database.
