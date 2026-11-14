# v0.4F r2 - BO History 2K (package 0.4.8)

## Thay đổi r2
- Bỏ toàn bộ tia sét, vết nứt, loé sáng, chấm bi và 2 vệt cọ đỏ/trắng góc trên trái, dưới phải. Giữ grid chạy, tia lửa, đốm lửa, ngôi sao, quầng gradient.
- Thêm 4 quầng gradient đỏ ở 4 góc, "thở" và trôi chậm (11 giây/chu kỳ).
- Dải đen chạy ngang dưới cùng: `#ABUxOHMYCASHCUP` xen kẽ đỏ/xám, tốc độ vừa phải (`BH_TICKER.speed`).
- Ảnh tuyển thủ tự căn: với PNG tách nền, hệ thống đọc vùng có hình để căn giữa theo đầu, đầu cách mép trên ~45 px, thân chạm khối tên. Đáy dải ảnh mờ dần thành màu đội nên không thấy nét cắt. Ảnh có nền (không tách nền) thì phủ kín dải.
- Thẻ tên trên cam to hơn: cao 36 px, chữ 26 px (2K).

## 1. Bố cục (theo bảng "Vòng đồng đội" của FVPL, đổi sang màu giải)
| Thành phần | Vị trí 2K | Nội dung |
|---|---|---|
| Logo | giữa, trên cùng | chỉ logo giải (`public/assets/brand/league-logo.png`) |
| Panel đội trái | x 164–691, y 151–1229 | 2 dải ảnh tuyển thủ (P1 trái, P2 phải) + khối đỏ ghi tên 2 tuyển thủ |
| Panel đội phải | x 1869–2396 | như trên, khối trắng chữ đen |
| Các hàng game | giữa | hộp trái tên CLB ("AC Milan"), giữa kết quả, hộp phải tên CLB |
| Tiêu đề | dưới cùng | ô **Stage / Round** (font Anton, đỏ) |

### Mỗi hàng
| Trạng thái | Chữ lớn | Dòng nhỏ |
|---|---|---|
| Đã đá | `2 - 1` | `- GAME 1 -` |
| Đã đá, luân lưu | `2 - 2` | `- PEN 4-3 -` |
| Đã đá, hiệp phụ | `1 - 3` | `- HIỆP PHỤ -` |
| Game kế tiếp | `NEXT` (đỏ) | `- GAME 3 -` |
| Game sau nữa | `GAME 4` | |

- Số hàng theo BO đang chọn (BO3 / BO5 / BO7). BO3 đúng khoảng cách bản gốc; BO5, BO7 tự thu gọn.
- Khi một đội đã thắng đủ (2 trận BO3, 3 trận BO5, 4 trận BO7) theo Game history, các hàng chưa đá tự ẩn.
- Tỉ số lấy từ **Game history** của BO hiện tại (đúng chiều trái/phải kể cả khi Swap sides). Tỉ số BO tay trên scoreboard không hiện ở đây (giống bản gốc).
- Ảnh tuyển thủ: dùng chung với Intro, `public/assets/players/C1-P1.png`, `C1-P2.png`… (nên là PNG tách nền, chỉ 1 người, cỡ bất kỳ; tự căn theo đầu). Thiếu ảnh thì hiện hình unknown.
- Tên tuyển thủ: lấy từ danh sách đã đăng ký của BO. Tên CLB / tiêu đề dài tự co chữ.

## 2. Nền động (không dùng video)
- Nền đen, quầng đỏ giữa, 4 quầng gradient đỏ ở góc trôi chậm, vệt cọ đỏ/trắng ở góc trên phải và dưới trái, đường tốc độ chạy chéo.
- Tia lửa 4 cánh / ngôi sao (vàng, trắng, đỏ), đốm lửa bay lên.
- Dải hashtag chạy ngang dưới cùng.
- Luôn có chuyển động. Chỉ dùng transform/opacity (không blur động) nên rất nhẹ.
- Tự **dừng hẳn** khi BO History tắt. Màn Preview/Program của Studio hiện nền tĩnh (đỡ CPU máy vận hành); xem chuyển động trên OBS.

## 3. Animation
- IN khoảng 1,15 giây: nền hiện → 2 panel trượt vào từ 2 bên → logo rơi xuống → các hàng hiện lần lượt → tiêu đề mở từ giữa.
- OUT khoảng 0,7 giây: đảo ngược.
- BO History nằm trên cùng, che scoreboard và cam khi bật; tắt thì mọi thứ phía dưới hiện lại như cũ.

## 4. Chỉnh nhanh
`client/history.ts`, hằng số `BH`: vị trí panel, logo, hàng (`rows`), tiêu đề, khoảng cách đầu tới mép trên (`portrait.headGap`). Dải hashtag: `BH_TICKER` (chữ, tốc độ). Cỡ thẻ tên cam: `CAMERA_TAG` trong `client/stage.ts`. Màu: `public/assets/history.css`.

## 5. Test và tiêu chí PASS

### A. Tự động
- `# pass 92`, `# fail 0`, dòng cuối `SUCCESS: v0.4F_r2 installed (package 0.4.8)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| F1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4F r2`, footer Studio `v0.4F r2` |
| F2 | Tick PREV BO History | Preview hiện bảng (nền tĩnh), đúng tên CLB, tên tuyển thủ, tiêu đề theo Stage / Round |
| F3 | LIVE BO History | OBS: animation vào, không còn tia sét / chấm bi; góc đỏ trôi nhẹ, dải `#ABUxOHMYCASHCUP` chạy ở đáy |
| F3b | Nhìn dải ảnh tuyển thủ | Không còn khoảng hở trên khối tên; đáy ảnh mờ liền vào khối tên |
| F3c | Bật cam có người | Thẻ tên trên cam to hơn bản trước, vẫn không che cam |
| F4 | Game có luân lưu / hiệp phụ | Dòng nhỏ hiện `PEN 4-3` / `HIỆP PHỤ` |
| F5 | Lưu thêm kết quả khi bảng đang hiện | Hàng cập nhật ngay, `NEXT` chuyển xuống game sau |
| F6 | Đổi BO3 / BO5 / BO7 | Số hàng đổi theo, không đè logo / tiêu đề |
| F7 | Một đội thắng đủ | Các hàng chưa đá biến mất |
| F8 | Swap sides | Tên, ảnh, tỉ số đổi bên đúng |
| F9 | Tắt BO History | Animation ra; scoreboard, cam hiện lại |
| F10 | Refresh OBS khi đang bật | Hiện ngay, không chạy lại animation vào |

## 6. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04f_<ngày giờ>_<mã>"` → quay về bản trước đó (v0.4F). Không đổi database.
