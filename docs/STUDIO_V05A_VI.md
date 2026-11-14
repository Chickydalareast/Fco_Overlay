# v0.5A - Giao diện Studio mới (package 0.5.0)

Chỉ đổi giao diện Studio. Logic (lệnh gửi server, Preview/Program, TAKE, camera, Cam Focus, tỉ số, lưu kết quả game) giữ nguyên; đồ hoạ trên OBS không đổi. Màn chuẩn: 1920×1080.

## 1. Quy ước màu
| Màu | Nghĩa |
|---|---|
| **Đỏ** | Đang lên sóng (Program): ô layer tô đỏ, nút `ON AIR`, viền màn Program, nút TAKE |
| **Trắng** | Preview / đang chọn: nút `PREV` bật, viền màn Preview, đội đang chọn ở Cam Focus |
| **Vàng** | Cần kiểm tra: Preview khác Program (`UNPUBLISHED CHANGES`), mất kết nối, có yêu cầu vào cam |

## 2. Bố cục
- **Trên cùng:** logo giải, trạng thái CONTROL / OBS, số REV; nút BTC Room, Player Link, OBS URL, đăng xuất. Có tuyển thủ xin vào cam thì hiện nút vàng `CAM REQUESTS`.
- **Cột trái (điều khiển live):**
  - Scoreboard, Player Intro, BO History: `PREV` (đưa vào Preview) + nút LIVE lớn (`OFF` / `ON AIR`).
  - All cameras: bấm icon camera để mở A1–B2 từng cam.
  - Cam Focus: PREV, LIVE, 2 nút chọn đội.
  - BO Score: nút − / + lớn.
  - **HOLD TO CLEAR ALL:** phải **giữ chuột ~1 giây** (thanh đỏ chạy đầy) mới tắt toàn bộ; bấm nhanh không có tác dụng.
- **Giữa:** Preview | Program, thanh TAKE (một nút TAKE duy nhất, sáng đỏ khi Preview có thay đổi), bảng **BO RESULTS**: danh sách G1–G7 bên trái (bấm Enter / Edit để chọn game), ô nhập kết quả bên phải.
- **Cột phải (chuẩn bị trước trận), 3 tab, nhớ tab đang mở:**
  - **MATCH:** chọn đội A / B, Swap sides, BO, Match #, Game #, Stage / Round, Prepare new BO.
  - **CAMERAS:** trạng thái 4 tuyển thủ, duyệt yêu cầu vào cam, Revoke.
  - **SETTINGS:** vị trí scoreboard (X / Y / Scale).
- Đã bỏ khỏi giao diện (không còn hiện trên đồ hoạ): Competition, Portrait URL, Series wins ở cột phải (tỉ số BO chỉnh ở cột trái).

## 3. Test và tiêu chí PASS

### A. Tự động
- `# pass 104`, `# fail 0`, dòng cuối `SUCCESS: v0.5A installed (package 0.5.0)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| S1 | `npm start`, mở Studio (Ctrl+F5) | Terminal có `GRAPHICS STUDIO v0.5A`, trang đăng nhập nền đen logo giải, footer `v0.5A` |
| S2 | Bấm LIVE của Scoreboard | Ô chuyển đỏ `ON AIR`, OBS hiện scoreboard; bấm lại về `OFF` |
| S3 | Tick PREV BO History | Thanh TAKE chuyển vàng `UNPUBLISHED CHANGES`, nút TAKE đỏ; bấm TAKE → về `IN SYNC WITH PROGRAM` |
| S4 | − / + tỉ số | Số đổi ngay trên OBS |
| S5 | Mở All cameras, bật/tắt A1 | Dòng A1 viền đỏ khi lên sóng |
| S6 | Cam Focus chọn đội, LIVE | Nút đội đỏ, OBS chạy cảnh Focus |
| S7 | BO RESULTS: bấm Enter ở G1, nhập tỉ số, Save game | Dòng G1 hiện tỉ số, đếm `1/x saved` |
| S8 | Bấm nhanh HOLD TO CLEAR ALL | Không có gì xảy ra |
| S9 | Giữ HOLD TO CLEAR ALL ~1 giây | Mọi layer và cam về `OFF` |
| S10 | Đổi tab SETTINGS, F5 | Vẫn mở tab SETTINGS |

## 4. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\studio_v05a_<ngày giờ>_<mã>"` → quay về v0.4H_r2. Không đổi database.
