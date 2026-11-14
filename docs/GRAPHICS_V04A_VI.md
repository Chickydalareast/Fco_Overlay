# v0.4A — Team Intro (2v2) + nền đồ họa 2K

Version `package.json`: **0.4.0**. Cài trên v0.3G (0.3.6). Không đổi database.

## 1. Thay đổi

| Phần | Nội dung |
|---|---|
| Khung thiết kế | Stage gốc **2560×1440**. OBS ở 1080p tự thu nhỏ ×0.75 (đặt Browser Source đúng độ phân giải của scene: 2560×1440 hoặc 1920×1080). Scoreboard cũ, BO History và ô camera giữ nguyên hình, chỉ quy đổi toạ độ (sẽ làm lại ở v0.4B) |
| Team Intro | Làm lại theo FVPL: logo giải, plate MATCH/GAME, thanh tên trái đỏ / phải trắng, ô logo đội, 2 tuyển thủ mỗi bên, cột đèn. Animation IN 1.78 s / OUT 1.38 s, đo từng frame từ video |
| Bộ animation | `client/motion.ts`, dùng Web Animations API của trình duyệt (không thêm thư viện). Tắt giữa lúc đang hiện → đảo ngược mượt. OBS refresh → hiện ngay trạng thái cuối, không chạy lại |
| Font | Inter 500/800, có tiếng Việt, nằm local (`public/assets/fonts`, giấy phép OFL) |
| Studio | Bỏ ô "Intro player" (intro tự lấy cả 2 người của đội); thay bằng dòng tên 2 tuyển thủ dưới ô chọn đội |
| OBS cũ | Code phía OBS không dùng `structuredClone` hay tính năng CSS mới, chạy được trên OBS 27+ |

## 2. Quy cách asset (bạn thay file, giữ đúng tên)

### Ảnh tuyển thủ — `public/assets/players/C1-P1.png` … `C16-P2.png`
- PNG nền trong suốt, khung **1900×2000 px**.
- **Đỉnh đầu ở y ≈ 360**, **đường thắt lưng / eo ở y ≈ 1644** (phần dưới eo bị thanh tên che).
- Người đặt giữa khung theo chiều ngang (tâm thân ở x ≈ 980). Dung lượng ≤ 2 MB.
- Lưu ý: 2 ảnh mẫu bạn gửi cắt ngang ngực ở y 1644, nên trên intro trông **to hơn** FVPL. Ảnh thật cần lấy tới eo, người sẽ gọn như FVPL.
- Chưa có file → tự hiện hình bóng `unknown.svg` cùng khung.
- **P1 đứng trước** (gần giữa), **P2 đứng sau** (lệch ra ngoài, xuất hiện trước 0.12 s).

### Logo đội — `public/assets/teams/C1-white.png`, `C1-red.png` … `C16-…`
- PNG nền trong suốt, **512×512**, logo nằm trong vùng ~80% ở giữa.
- `-white`: logo trắng, dùng trên nền đỏ (đội trái) và scoreboard nền đen (v0.4B).
- `-red`: logo đỏ, dùng trên nền trắng (đội phải).
- File hiện tại là **giữ chỗ** tự sinh từ logo CLB cũ — chép đè là xong, không cần sửa code.

### Logo giải — `public/assets/brand/league-logo.png`
- Đang dùng logo ABUXOHMYCASH CUP bạn gửi, thu về 1200×407. Thay file mới thì giữ **cùng tỉ lệ 1200:407** (nếu khác, báo để chỉnh hằng số `LOGO_ASPECT`).

## 3. Chỉnh sửa nhanh (cho lượt góp ý)

Tất cả số nằm ở đầu `client/intro.ts`:
- `INTRO.logo` — độ rộng / vị trí dọc của logo giải.
- `INTRO.players` — vị trí ngang người trước / sau; `INTRO.portrait.raiseBack` — người sau cao hơn bao nhiêu.
- `INTRO.side.outerX` — mép ngoài thanh tên + ô logo (bên phải tự đối xứng). Số càng nhỏ, thanh càng dài.
- `INTRO.beam.top` — đỉnh cột sáng phía sau (số càng nhỏ, cột càng cao). Hai cạnh cột sáng và mũi thanh tên được tính theo đường cạnh plate nên luôn thẳng hàng.
- `INTRO.beam.waveOpacity` — độ đậm của lớp sóng loop (0 = tắt sóng, 1 = mặc định).
- `INTRO_STEPS` — bảng thời gian: mỗi dòng có `start` / `duration` (giây) cho IN, `outTiming` / `out` cho OUT.

## 3b. v0.4A.1 (chỉnh theo góp ý)
- Mũi nhọn của 2 thanh tên nằm đúng trên đường cạnh plate MATCH/GAME (trước đó lệch khoảng 10px).
- Thanh tên + ô logo kéo dài ra ngoài (mép ngoài 581 → 400 ở hệ 2K) để phủ cả 2 player.
- Cột sáng phía sau rộng bằng cả thanh, cao hơn (đỉnh 520 → 180), nghiêng song song mũi thanh.
- Lớp sóng loop rất nhẹ chạy lên trong cột sáng (2 lớp 5.4 s và 8.7 s), tự dừng khi intro tắt.
- Chỉnh trong CSS: `public/assets/intro.css`, các dòng `.wave-1` / `.wave-2`.

## 4. Test và tiêu chí PASS

### A. Tự động (APPLY_PATCH chạy sẵn)
- `npm test` → `# pass 65`, `# fail 0`. Dòng cuối `SUCCESS: v0.4A.1 installed (package 0.4.1)`.

### B. Trên Studio / OBS
| # | Thao tác | PASS khi |
|---|---|---|
| I1 | `npm start`, mở Studio | Terminal có `GRAPHICS STUDIO v0.4A.1`; Preview/Program hiển thị bình thường |
| I2 | Tick PREV "Player Intro" | Preview chạy intro: logo lật + bóng mờ → plate → thanh tên → 2 người mỗi bên trồi lên (người sau trước) → ô logo → cột đèn |
| I3 | Bấm "Test Intro" | Intro chạy lại từ đầu trong Preview |
| I4 | Bấm LIVE Player Intro trên OBS URL | OBS chạy đúng như Preview, chữ "C1 - AC Milan" và "MATCH x / GAME y" đúng |
| I5 | Bấm LIVE lần nữa (tắt) | Chạy animation thoát: đèn tắt → người chìm → ô logo rút → màu quét ngược → thanh rút → logo trượt xuống → plate co lại |
| I6 | Bật rồi tắt ngay khi đang chạy | Đảo ngược mượt, không giật, không kẹt |
| I7 | Đang hiện intro, refresh OBS source | Hiện ngay trạng thái cuối, không chạy lại intro |
| I8 | Đặt Browser Source 2560×1440 và 1920×1080 | Cả hai đều sắc nét, đúng vị trí, nền trong suốt |
| I9 | Chép thử 1 ảnh `C1-P1.png` theo quy cách | Ảnh thay cho hình bóng, đúng vị trí người đứng trước bên trái |
| I10 | Đổi đội ở Preview rồi TAKE khi intro đang ON | Tên / logo / ảnh đổi ngay, không chạy lại animation |

## 5. Rollback
Dừng server, chạy lệnh `ROLLBACK.ps1` mà APPLY in ra. Không đổi database nên không mất dữ liệu.
