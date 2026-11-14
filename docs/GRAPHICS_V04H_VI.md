# v0.4H r2 - Cam Focus + Red Devil dày hơn (package 0.4.11)

## Thay đổi r2
- Mask nền Cam Focus mượt hơn: nền mờ dần từ 40% đến 90% chiều cao màn hình theo đường cong êm (14 điểm), không còn vạch cắt ngang, chuyển chéo liền vào game.
- Chỉnh độ cao vùng mờ: `CAMERA_FOCUS.mask` (`from`, `to`) trong `client/stage.ts`.

## 1. Cam Focus là gì
Khi một đội ghi bàn / ăn mừng, bấm Focus đội đó:
- 4 cam ở dải dưới mờ đi.
- Nền BO History trồi lên nhưng **chỉ hiện ở phần dưới màn hình** (mask), game vẫn thấy ở phía trên; dải `#ABUxOHMYCASHCUP` chạy ở đáy; Red Devil vẫn hiện ở các góc dưới.
- 2 cam của đội được focus hiện ở hàng trên, to hơn cam gốc một chút; 2 cam đội còn lại ở hàng dưới.
- Tắt: cảnh chạy ngược lại, 4 cam về dải dưới như cũ.

Video không bị nối lại khi chuyển (không đen hình), không tốn thêm quota LiveKit (cam to nhất 520 px, nhỏ hơn hình 640×360 tuyển thủ gửi lên).

| Hàng | Cam | Cỡ 2K | So với cam gốc 372×210 |
|---|---|---|---|
| Trên | Đội được focus | 520 × 293 | ×1,4 |
| Dưới | Đội còn lại | 430 × 242 | ×1,15 |

Thứ tự trong hàng giữ như dải dưới: A2 A1 | B1 B2. Thẻ tên nằm trên mỗi cam như cũ. Scoreboard vẫn nằm trên cùng.

## 2. Trong Studio (sidebar trái, ngay dưới CAMERAS)
| Nút | Tác dụng |
|---|---|
| **PREV** | Xem trước cảnh Focus trên màn Preview |
| **LIVE ON/OFF** | Bật / tắt Focus trên Program (bấm 1 lần là lên sóng, bấm lại là tắt) |
| **A · C1** / **B · C12** | Chọn đội được focus. Đang ON mà bấm đội kia thì 2 hàng đổi chỗ ngay |

- Đội đang chọn có viền tím; khi đang lên sóng thì viền đỏ, cả ô CAM FOCUS cũng viền đỏ.
- Dòng nhỏ dưới chữ CAM FOCUS: `On air: C1 on top` / `Ready: C1`.
- Focus cần **ít nhất 1 ô cam đang bật** (ô bật mà tuyển thủ chưa có hình vẫn tính, hiện logo mờ). Chưa bật cam nào thì nút mờ đi. Tắt hết cam khi đang Focus thì Focus tự tắt.
- EMERGENCY CLEAR tắt cả Focus.

## 3. Red Devil (BO History và nền Cam Focus)
- Mỗi lúc 2–3 con (trước 1–2), khoảng 0,6–1,6 giây lại có con mới (trước 1,2–3,2 giây).
- BO History: các góc và mép như cũ. Cam Focus: chỉ 2 góc dưới và 2 khoảng trống hai bên cụm cam, không bao giờ nằm sau cam.

## 4. Chỉnh nhanh
- Cỡ / vị trí cam Focus, độ cao mask: `CAMERA_FOCUS` trong `client/stage.ts`.
- Số lượng / tần suất Red Devil: `MASCOT` trong `client/history.ts` (`max`, `pause`, `minActive`, `joinChance`).

## 5. Test và tiêu chí PASS

### A. Tự động
- `# pass 102`, `# fail 0`, dòng cuối `SUCCESS: v0.4H_r2 installed (package 0.4.11)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| H1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4H r2`, footer Studio `v0.4H r2` |
| H1b | Bật Cam Focus, nhìn vùng giữa sân và đáy | Nền đỏ/đen mờ dần liền vào game, không thấy vạch ngang |
| H2 | Tắt hết cam | Ô CAM FOCUS hiện `Turn cameras on first`, nút LIVE mờ |
| H3 | Bật CAMERAS LIVE, chọn **A**, bấm LIVE của CAM FOCUS | OBS: cam dưới mờ đi, nền đỏ trồi lên ở đáy, 2 cam đội trái ở trên to hơn, đội phải ở dưới |
| H4 | Đang ON bấm **B** | 2 hàng đổi chỗ, đội phải lên trên |
| H5 | Bấm LIVE lần nữa | Cảnh ra, 4 cam về đúng vị trí dải dưới |
| H6 | Tick PREV | Preview hiện cảnh Focus, Program không đổi |
| H7 | Đang Focus, tắt hết cam | Focus tự tắt |
| H8 | Xem BO History 30 giây | Red Devil thường có 2–3 con cùng lúc |
| H9 | Refresh OBS khi đang Focus | Hiện ngay cảnh Focus, không chạy lại animation |

## 6. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04h_<ngày giờ>_<mã>"` → quay về bản trước đó. Không đổi database (trạng thái Focus nằm trong Program state, bản cũ bỏ qua trường này).
