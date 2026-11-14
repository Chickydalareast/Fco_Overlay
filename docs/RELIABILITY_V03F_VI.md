# FC Online Graphics Studio — v0.3F Reliability & Data Integrity

Version `package.json`: **0.3.5**. Cài trên v0.3E (0.3.4). Chưa có phần deploy VPS (để lượt v0.3G).

## 1. Thay đổi chính

| Mã | Thay đổi | File |
|---|---|---|
| A1 | Một lần ghi SQLite lỗi không còn làm hỏng mọi lệnh sau đó | `server/state.mjs` |
| A2/A3 | Ô cam gắn theo **playerId** (C10-P1), không theo identity LiveKit. TAKE tự điền A1=P1, A2=P2 của mỗi đội. Hai đồng đội online không bao giờ trùng hình | `state.mjs`, `camera-receiver.ts`, `contracts.ts` |
| A4 | Đổi đội rồi đổi lại / swap / đổi BO3-5-7 **không** tạo BO mới. TAKE mở BO mới phải xác nhận | `client/studio.ts`, `state.mjs`, `tournament-db.mjs` |
| A5 | Lỗi đọc file / lỗi request không làm tắt server | `server/index.mjs` |
| A6 | Sửa lỗi frame WebSocket 65,536 byte | `server/websocket.mjs` |
| A7 | Tắt cam: tile giữ khung hình cuối khi animation thoát (không nháy "WAITING FOR PLAYER"). Bật cam: báo sẵn sàng ở frame đầu | `camera-receiver.ts` |
| A8 | Ô Team name / code / color / player bị khoá khi đã chọn đội registry; bỏ ô "In-game goals" | `studio.ts` |
| A9 | +/- BO score: nút khoá tới khi server trả lời + server từ chối click thứ hai cùng giá trị | `studio.ts`, `state.mjs` |
| A10 | Phiên đăng nhập lưu SQLite (restart không phải login lại). Hết phiên thì hiện form login | `index.mjs`, `tournament-db.mjs` |
| A11 | TAKE bỏ field lạ ngoài contract | `state.mjs` |
| A12 | `/output.html` không có token → 403 | `index.mjs` |
| A13 | `.env` luôn đọc ở thư mục project | `server/load-env.mjs` |
| B | OBS/Studio đọc danh sách người phát **trực tiếp từ LiveKit SFU**. Duyệt cam lưu SQLite. Node restart: cam trên OBS vẫn chạy, tuyển thủ không phải xin duyệt lại | `camera-room.mjs`, `camera-receiver.ts`, `index.mjs` |
| P0.1 | Mỗi tuyển thủ chỉ 1 thiết bị được duyệt. Duyệt thiết bị mới = thay thiết bị cũ (LiveKit tự ngắt thiết bị cũ) | `camera-room.mjs` |
| P0.2 | Nút **REVOKE** trong Camera Diagnostics: huỷ duyệt + server gọi LiveKit `RemoveParticipant`. BO mới: server xoá room LiveKit cũ (`DeleteRoom`) | `camera-room.mjs`, `studio.ts` |
| P1.1 | Preview không còn STALE khi LIVE +/-: field bạn không sửa tự theo LIVE, field bạn sửa được giữ. Trùng sửa BO score thì luôn theo LIVE | `contracts.ts`, `studio.ts` |
| P1.2 | Tạo BO / kết thúc BO cũ / lưu Program nằm trong **một transaction** | `state.mjs`, `tournament-db.mjs` |
| UX | Toast lỗi không bị ghi đè; badge **CAM REQUESTS** + tiếng bíp; nhãn renderer (`&label=OBS`); số game trong Game History theo BO | `studio.ts`, `studio.css` |
| LiveKit | OBS/Studio chỉ vào room LiveKit khi có ô cam bật (hoặc PREV đang bật cam → báo OBS "prewarm"), tự rời sau 3 phút không dùng | `camera-receiver.ts`, `output.ts` |
| Backup | Tự sao lưu SQLite khi khởi động và khi mở BO mới: `.runtime/db-backups/` (giữ 20 bản) | `tournament-db.mjs`, `index.mjs` |
| Mật khẩu | Mặc định `admin123`. Muốn đổi: thêm `FC_ADMIN_PASSWORD=...` vào `.env` | `index.mjs` |

## 2. Migration dữ liệu

Lần `npm start` đầu tiên sau patch:
- SQLite thêm migration **v3**: bảng `admin_sessions`, `camera_requests`.
- Program đang lưu: ô cam cũ (`participantId: player-xxxx`) đổi thành `playerId` mặc định của đội (A1=P1, A2=P2…). Trạng thái bật/tắt ô giữ nguyên. Tỷ số, đội, Game History không đổi.
- Script patch đã backup `.runtime` trước khi chép file. Server còn tự backup thêm vào `.runtime/db-backups/`.

## 3. Cách test và tiêu chí PASS

### A. Tự động (script APPLY_PATCH chạy sẵn)
- `npm test` → cuối log có `# pass 51` và `# fail 0`.
- Nếu có TypeScript local: `npm run typecheck` không báo lỗi.
- Script in `SUCCESS: v0.3F installed`.

### B. Local, không cần webcam (khoảng 10 phút)

| # | Thao tác | PASS khi |
|---|---|---|
| B1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.3F` và `Password: admin123`, không có dòng `Error`. Có file mới trong `.runtime\db-backups\` |
| B2 | Mở `/studio`, đăng nhập `admin123` | Vào được Studio, REV đúng số trước patch, đội và tỷ số như cũ |
| B3 | Ctrl+C, `npm start` lại, **không** reload trang | Trong ~10 giây Studio tự về `CONTROL CONNECTED`, không hỏi mật khẩu |
| B4 | Bấm đúp thật nhanh nút **+** của đội A | Tỷ số chỉ tăng **1**. Bấm **−** để trả lại |
| B5 | Sửa ô *Stage / Round* (chưa TAKE), rồi bấm LIVE **+** hoặc **−** | Cờ Preview là `MODIFIED` (không phải `STALE DRAFT`), nút TAKE bấm được. TAKE xong: stage mới lên Program, tỷ số đúng bằng giá trị LIVE |
| B6 | Đổi đội A sang đội khác | Có toast/footer `⚠ … TAKE will OPEN A NEW BO`. Đổi lại đúng đội cũ → `Same BO as live` |
| B7 | Khi đang khác đội, bấm TAKE | Hiện hộp xác nhận "OPEN A NEW BO". Bấm Cancel → không có gì thay đổi |
| B8 | Đổi Best of BO5 → BO7, TAKE | Hỏi "Change the CURRENT BO format". Dòng *Current BO session* giữ nguyên ID |
| B9 | Xem panel phải | Ô Full team name / Team code / Brand color / Player name bị mờ (khoá); không còn ô In-game goals |
| B10 | Copy OBS URL, mở trong tab mới | URL có `&label=OBS`. Studio: topbar `OBS ONLINE`, footer `OBS: ✓ rev N` |
| B11 | Mở `http://127.0.0.1:4173/output.html` (không token) | Báo `Output token is missing or invalid` |
| B12 | Expand ALL PLAYER CAMERAS | Mỗi ô chỉ có 2 lựa chọn là 2 tuyển thủ đúng đội bên đó |
| B13 | EMERGENCY CLEAR | Mọi layer và cam tắt. Đội, tỷ số, lựa chọn cam giữ nguyên |

### C. Có webcam / LiveKit (2–4 thiết bị: điện thoại/laptop làm tuyển thủ)

| # | Thao tác | PASS khi |
|---|---|---|
| C1 | Tuyển thủ gửi yêu cầu | Studio có badge `CAM REQUESTS 1` nháy + tiếng bíp + toast. Approve được |
| C2 | Cả 2 tuyển thủ đội A online, bật LIVE A1 + A2 | Hai ô là **hai người khác nhau**, đúng thứ tự P1/P2 |
| C3 | Tuyển thủ A2 bấm STOP | Ô A2 chuyển sang hình A1 (cùng đội). **Không bao giờ** hiện người đội B |
| C4 | Đang có cam trên OBS, **Ctrl+C rồi `npm start`** | Ô cam trên OBS **vẫn có hình** suốt lúc Node tắt/bật. Tuyển thủ **không** phải xin duyệt lại |
| C5 | Bấm REVOKE một tuyển thủ | Tab tuyển thủ báo *The operator stopped your camera*. Ô OBS đổi sang đồng đội/placeholder trong vài giây |
| C6 | Tuyển thủ đang online, cùng tên xin từ máy khác | Báo lỗi *already online… REVOKE first*. Sau khi REVOKE máy cũ thì xin được |
| C7 | Tắt wifi máy tuyển thủ ~10 giây rồi bật lại | Tab hiện *Reconnecting camera automatically…* rồi tự về `CAMERA ONLINE`, không phải bấm gì |
| C8 | Tắt LIVE một ô cam | Ô trượt ra với khung hình cuối, không nháy chữ *WAITING FOR PLAYER* |
| C9 | Tắt hết cam ở cả Preview và Program, chờ 3 phút | Dòng media status: *Camera SFU idle — disconnected to save minutes*. LiveKit dashboard bớt viewer |
| C10 | Tick PREV ALL PLAYER CAMERAS, chờ 2–3 giây, rồi bấm LIVE ALL | Cam lên OBS gần như ngay (OBS đã kết nối trước) |
| C11 | PREPARE NEW BO → TAKE (xác nhận) | Tab tuyển thủ cũ báo *BO ended*. Room LiveKit cũ biến mất trên dashboard |

Ghi lại các mục FAIL (số mục + mô tả + ảnh) để sửa tiếp.

## 4. Rollback

Dừng server (Ctrl+C) rồi chạy `ROLLBACK.ps1` (script APPLY in sẵn lệnh). Script chép lại source v0.3E và **database trước patch**. Dữ liệu nhập sau patch (Game History, tỷ số) sẽ mất, nhưng vẫn còn các bản trong `.runtime\db-backups\`.
