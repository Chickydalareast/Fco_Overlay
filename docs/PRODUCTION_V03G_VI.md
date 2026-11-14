# FC Online Graphics Studio — v0.3G (Studio gọn + Production readiness)

Version `package.json`: **0.3.6**. Cài trên v0.3F (0.3.5).

## 1. Thay đổi

**Studio UI (chỉ phần thao tác, chưa phải UI final)**
- Bỏ các dòng mô tả, eyebrow, subtitle, ô ghi chú, tem "SINGLE OUTPUT", chữ dưới monitor.
- Topbar thấp hơn. Monitor Preview/Program lớn hơn. Cờ `IN SYNC` / `REV` nằm ngay trên đầu monitor.
- Gameplay / Grid / Safe zones gộp vào thanh TAKE.
- Game History hiện dạng ô nhỏ G1–G7. Cameras: dòng `x/4 online` + 4 thẻ trạng thái.
- Panel phải: chọn đội + người chơi Intro ngay cạnh logo. Ô Code / Color / Team name / Player chỉ hiện với đội custom (không phải C1–C16).

**Production**
| | Thay đổi |
|---|---|
| WebSocket | Đổi sang thư viện `ws` 8.x (dependency đầu tiên của project). Script patch tự chạy `npm ci --omit=dev` |
| LiveKit SDK | Tải từ server (`/public/vendor/`), có SRI `integrity`, không còn phụ thuộc jsDelivr CDN. CSP chỉ cho script `'self'` |
| Cache | File trong `/vendor/` được cache 1 năm (tên file có version) |
| Proxy | `FC_TRUST_PROXY=1`: rate limit login/join theo IP thật khi đứng sau Caddy/Nginx |
| Log | `FC_HIDE_SECRETS=1` (tự bật khi có `FC_PUBLIC_ORIGIN`): không in token OBS ra log |
| Health | `/api/health` kiểm tra SQLite, LiveKit, số kết nối, RAM. Trả 503 khi DB lỗi |
| Backup | Thêm backup SQLite mỗi 24 giờ khi server chạy liên tục |
| Deploy | `deploy/Caddyfile.example`, `deploy/fc-studio.service`, `deploy/env.production.example`, `docs/DEPLOY_VPS_VI.md` (chưa deploy) |

## 2. Test và tiêu chí PASS

### A. Tự động (APPLY_PATCH chạy sẵn)
- `npm ci` cài `ws`. Log có `added 1 package`, hoặc tương tự, không có `ERR!`.
- `npm test` → `# pass 55`, `# fail 0`.
- Dòng cuối: `SUCCESS: v0.3G installed (package 0.3.6)`.

### B. Local (khoảng 5 phút)
| # | Thao tác | PASS khi |
|---|---|---|
| G1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.3G`, không có `Error` |
| G2 | Mở `/studio`, đăng nhập | Giao diện gọn, không còn các dòng mô tả. Topbar có `CONTROL CONNECTED` |
| G3 | Ngắt mạng Internet máy bạn, tải lại Studio | Vẫn vào được. Dòng media không báo `LiveKit SDK unavailable` (SDK nằm local) |
| G4 | Bấm đúp +1, bật/tắt Intro LIVE, TAKE | Hoạt động như v0.3F (WebSocket mới) |
| G5 | Mở OBS URL trong OBS hoặc tab | Studio hiện `OBS ONLINE`, footer `OBS: ✓ rev N` |
| G6 | Mở `http://127.0.0.1:4173/api/health` | Có `"status":"ok"`, `"database":"ok"`, `"version":"0.3.6"` |
| G7 | Chọn đội C1–C16 ở panel phải | Không còn ô Code/Color/Team name/Player; chỉ còn Series wins + Portrait URL |
| G8 | Có webcam: làm lại C2, C4, C5 của v0.3F | Kết quả như v0.3F |

## 3. Rollback
Dừng server, chạy lệnh `ROLLBACK.ps1` mà APPLY in ra. Trả về v0.3F. Database không đổi ở lượt này, nên không mất dữ liệu.
