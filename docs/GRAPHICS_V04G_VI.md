# v0.4G - Nền BO History + chữ esports (package 0.4.9)

## 1. Nền BO History
- Bỏ 2 vệt cọ đỏ/trắng còn lại (góc trên phải, dưới trái). Nền giờ gồm: grid chạy, tia lửa, đốm lửa, ngôi sao, quầng gradient đỏ ở 4 góc, dải hashtag ở đáy.
- **Sóng nhẹ** trong phần mờ ở đáy mỗi dải ảnh tuyển thủ: các vệt sáng mảnh trôi lên liên tục (cùng kiểu sóng của Intro), chỉ hiện ở nửa dưới, mờ dần lên trên.
- **Linh vật** (`public/assets/brand/bg-mascot.png`, bản này là Red Devil):
  - Hiện / ẩn ngẫu nhiên, mờ dần vào rồi mờ dần ra (mỗi lần 4,5–6,5 giây).
  - Lúc 1 con, lúc 2 con, không bao giờ 2 con cùng một chỗ.
  - Chủ yếu ở 4 góc (khoảng 80%), thỉnh thoảng ở mép trái / phải.
  - Cỡ nhỏ (130–190 px ở 2K), nghiêng ngẫu nhiên tối đa ±30°.
  - Nằm sau panel, hàng game và tiêu đề nên không che chữ.
  - Đổi linh vật: thay file `bg-mascot.png` (PNG tách nền, vuông). Xoá file thì không hiện gì.
- Tất cả tự dừng khi BO History tắt; màn Preview/Program của Studio không chạy linh vật và sóng (đỡ CPU).

## 2. Chữ esports toàn bộ đồ hoạ on-air
Font Barlow Condensed đậm (tự host, đủ dấu tiếng Việt), tự in hoa.

| Layout | Chữ | Trước | Sau (2K) |
|---|---|---|---|
| Intro | Tên đội "C1 - AC MILAN" | Inter 31 px | 50 px (tự co tối thiểu 28) |
| Intro | MATCH / GAME | Inter 42 / 30 px | 54 / 36 px |
| Scoreboard | Mã đội / Stage / GAME | 46 / 25 / 22 px | 48 / 28 / 28 px |
| Cam | Thẻ tên | 26 px, cao 36 | 31 px, cao 40 |
| BO History | Tên tuyển thủ | Inter 30 px | 44 px (tự co, không cắt chữ) |
| BO History | Tên CLB trong hàng | 26–34 px | 30–56 px theo BO (BO3 to nhất) |
| BO History | Dòng PEN / HIỆP PHỤ / GAME n | 15% hàng | 28% hàng |

Tên dài vẫn tự co để không tràn khung. Chỉnh cỡ: `INTRO.nameFont`, `SB.font`, `CAMERA_TAG`, `BH.text`.

## 3. Test và tiêu chí PASS

### A. Tự động
- `# pass 95`, `# fail 0`, dòng cuối `SUCCESS: v0.4G installed (package 0.4.9)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| G1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4G`, footer Studio `v0.4G` |
| G2 | LIVE BO History, xem OBS 30 giây | Không còn vệt đỏ/trắng; Red Devil hiện mờ ở góc, lúc 1 lúc 2 con, nghiêng nhẹ |
| G3 | Nhìn đáy dải ảnh tuyển thủ | Có vệt sáng mảnh trôi lên nhẹ, không thấy nét cắt |
| G4 | Intro, Scoreboard, cam, BO History | Tên đội / tuyển thủ in hoa, to hơn, đủ dấu (Ễ, Ị, Ả…) |
| G5 | Đặt tên đội dài (vd "C11 - Atlético de Madrid") | Chữ tự co, không tràn khỏi khung |
| G6 | Tắt BO History | Linh vật biến mất, không còn chạy ngầm |

## 4. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04g_<ngày giờ>_<mã>"` → quay về v0.4F_r2. Không đổi database.
