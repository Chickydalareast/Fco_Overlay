# v0.4B r2 - Scoreboard 2K (package 0.4.3)

## 1. Thay đổi
- Scoreboard dựng lại theo số đo trên khung FVPL 2K (đơn vị pixel 2K):
  - thân bar cao 57px (y 31 → 88);
  - cạnh dưới thân bar [140 → 833] trùng đúng độ rộng khung tỉ số của game [139 → 833], nằm song song ngay phía trên khung đó;
  - chỉ tab **GAME n** thò ra ngoài bên phải.
- Bố cục: `[BO đỏ] C1 [logo] [MATCH 1] [logo] C12 [BO trắng]   [GAME 2]`.
  - Giữa thân bar có rãnh, chữ vòng đấu (ô Stage / Round, ví dụ QUARTER FINAL) nằm trong rãnh và đè lên mép trên.
  - Plate MATCH thấp hơn thân bar như bản gốc.
- Lớp nền phía dưới (underlay) rộng hơn thân bar: hai mũi nhọn thò ra ở hai góc dưới (trái đỏ sẫm, phải xám), kèm một vạch mảnh dưới thân bar.
- Tên đội dùng **mã viết tắt** (Code: C1, C12…) giống "TKO" trên bản gốc. Đội nhập tay dùng ô Code (tối đa 9 ký tự, tự co chữ).
- Màu cố định: trái đỏ, phải trắng; plate giữa dùng gradient đen → đỏ của Intro.
- Font: Barlow Condensed (mã đội, số, MATCH, vòng đấu) + Inter (GAME). Font tự host.
- Logo dùng bản **trắng** `public/assets/teams/C1-white.png`. Thiếu file thì dùng logo CLB, thiếu nữa thì hiện mã đội.
- Tỉ số BO vẫn chỉnh tay, không phụ thuộc Game History.

## 2. Animation
- IN khoảng 1,15 giây: plate giữa mở xuống → thân bar mở từ giữa ra hai bên → lớp nền mở theo, hai mũi nhọn thò ra ở hai đầu → logo bật lên, mã đội trượt ra ngoài, ô tỉ số quét vào từ hai đầu, số rơi xuống → chữ vòng đấu trồi lên từ rãnh, tab GAME trượt ra → một vệt sáng quét qua.
- OUT khoảng 0,7 giây: đảo ngược lại, thu về giữa.
- Bật/tắt liên tục khi đang chạy vẫn đảo chiều mượt. Refresh OBS khi đang bật thì hiện ngay, không chạy lại.
- Khi bấm +/− tỉ số BO lúc scoreboard đang hiện: ô tỉ số loé sáng, số mới trượt vào.

## 3. Chỉnh vị trí (SCOREBOARD POSITION ở cột phải Studio)
- **X (px)**: + sang phải, − sang trái. **Y (px)**: + xuống, − lên. **Scale %**: 100 = kích thước thiết kế.
- Đơn vị là pixel hệ 2K. Output 1080p sẽ dịch 0,75 lần số đó.
- Mũi tên lên/xuống: ±1. Shift + mũi tên: ±10. **Reset** = 0 / 0 / 100.
- Chỉnh ở Preview rồi bấm TAKE (giống mọi thay đổi khác). Giá trị được lưu, không mất khi tắt bật scoreboard, EMERGENCY CLEAR hay khởi động lại server.
- Giới hạn: X −640..640, Y −360..360, Scale 50..200.
- Dùng khi khung tỉ số của game trên máy streamer lệch so với ảnh tham chiếu: bật Safe zones/Gameplay trong Studio, chỉnh cho bar nằm ngay trên khung của game.

## 4. Chỉnh nhanh trong code
Đầu file `client/scoreboard.ts`, hằng số `SB` (toàn bộ là toạ độ màn hình 2K đo từ bản gốc):
- `body`: mép trên/dưới, góc trái/phải, độ nghiêng. `notch`: rãnh giữa. `plate`: plate MATCH.
- `score`: ô tỉ số đỏ (ô trắng tự đối xứng). `code`, `logo`: vị trí mã đội, logo. `tab`: tab GAME.
- `under`: lớp nền dưới, hai góc dưới là hai mũi nhọn.
- `font`: cỡ chữ. `SCOREBOARD_STEPS`: bảng thời gian animation (giây).
Màu trong `public/assets/scoreboard.css`.

## 5. Test và tiêu chí PASS

### A. Tự động
- `# pass 71`, `# fail 0`, dòng cuối `SUCCESS: v0.4B_r2 installed (package 0.4.3)`.

### B. Trên Studio / OBS
| # | Thao tác | PASS khi |
|---|---|---|
| S1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4B r2`; footer Studio ghi v0.4B r2 |
| S2 | Tick PREV Scoreboard | Preview chạy animation IN, hiện đủ mã đội (C1, C12), logo, MATCH, chữ vòng đấu, GAME |
| S3 | LIVE Scoreboard | OBS chạy giống Preview; cạnh dưới bar song song và bằng đúng độ rộng khung tỉ số của game, chỉ tab GAME thò ra |
| S4 | LIVE lần nữa (tắt) | Animation OUT thu về giữa rồi biến mất |
| S5 | Bật rồi tắt ngay | Đảo chiều mượt, không giật |
| S6 | BO SCORE + / − | Ô tỉ số loé sáng, số mới trượt vào; Game History không đổi |
| S7 | Refresh OBS khi đang bật | Hiện ngay, không chạy lại animation |
| S8 | X=40, Y=10, Scale=110 → TAKE | Bar dịch phải/xuống và to hơn trên OBS; Reset → TAKE trả về như cũ |
| S9 | Đội nhập tay với Code 9 ký tự | Mã đội co lại vừa ô, không tràn |
| S10 | Browser Source 2560×1440 và 1920×1080 | Cả hai sắc nét, đúng vị trí |

## 6. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04b_<ngày giờ>_<mã>"` → quay về bản trước khi cài (v0.4A.1 hoặc v0.4B r1). Vị trí đã lưu (X/Y/Scale) được bản cũ bỏ qua, không gây lỗi.
