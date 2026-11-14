# FC Online Graphics Studio — v0.3E: Performance & Hardening

Patch 05/05, áp dụng sau v0.3D (`package.json` version `0.3.3`). Đây vẫn là một project local/VPS giá rẻ, video đi qua **LiveKit Cloud SFU**, không đi qua VPS ứng dụng. Chưa phải benchmark thực tế 4 webcam trong OBS.

## 1. All Cameras trên sidebar trái

- Mặc định hiện **một hàng ALL PLAYER CAMERAS** thay vì bốn hàng camera chiếm chỗ.
- Checkbox **PREV** bật/tắt tất cả A1, A2, B1, B2 trong Preview; nếu bật một phần, checkbox có trạng thái trung gian. Cần **TAKE** mới đưa thay đổi Preview lên live.
- **LIVE** bật tất cả bốn slot bằng **một lệnh `camera.setAllVisible`**, một lần cập nhật Program revision. Nếu đang bật một phần thì nhấn LIVE sẽ bật đủ cả bốn; khi đang bật đủ thì nhấn sẽ tắt cả bốn.
- Nút `▸ / ▾` mở/đóng controls riêng A1, A2, B1, B2 (Assign, PREV, LIVE từng camera).
- Khi bật tất cả nhưng một hoặc nhiều nguồn chưa hoạt động, **slot vẫn ở đúng vị trí** và hiện placeholder. Nếu đội có một webcam hoạt động, receiver có thể dùng nguồn đó cho cả hai slot cùng đội; không tạo thêm luồng upload.
- Emergency Clear vẫn ẩn mọi graphic/webcam nhưng không xóa assignment hoặc kết quả game.

## 2. Media performance

- Camera Receiver dùng `autoSubscribe:false` và chỉ subscribe video camera của đội đang cần hiển thị trong Preview/Program; không subscribe mic/audio.
- Khi một camera của đội cần hiển thị, subscribe cả hai video track *đang published* của đội đó để same-team fallback hoạt động. Những người không thuộc BO không được phép hiển thị.
- Khi camera bị ẩn, giữ subscription **7 giây** để bật lại nhanh; sau đó unsubscribe. Đây là heuristic, có thể điều chỉnh sau benchmark.
- Một kết nối LiveKit Room **cho mỗi browser**; các stage trong cùng Studio dùng chung Room/track. Không relay webcam qua backend Node.js.
- Tắt element video không hiện lên stage để giảm công việc render, nhưng không hủy publisher webcam khi ẩn layer.
- Cấu hình capture Player Room v0.3C giữ nguyên (640×360, tối đa 20 FPS). Với các camera nhỏ, đây là xuất phát điểm phù hợp để benchmark, không phải cam kết chất lượng/độ trễ.

## 3. Realtime và HTTP

- WebSocket transport vẫn dependency-free, nhưng đã thêm: kiểm tra handshake/version, masked client frames, fragmentation của text frames, max message 64 KiB, max buffer 128 KiB, socket backpressure 256 KiB, ping heartbeat 25 giây và timeout ~65 giây.
- Giới hạn số kết nối/upgrade attempt, giới hạn JSON request body và dọn session/rate-limit stale. Đã thêm `GET /api/health` để VPS/proxy có thể kiểm tra tiến trình.
- HTTP static assets trả `ETag`; file không đổi nhận `304 Not Modified`, giảm truyền dữ liệu mà không giữ stale JS trong OBS. Do asset URL hiện chưa fingerprint, **không** dùng immutable 1 năm; đó là quyết định có chủ ý.
- Có CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` và `Permissions-Policy` cơ bản. Khi tích hợp graphic mới từ Claude cần kiểm tra lại CSP nếu có tài nguyên từ nguồn ngoài.
- Hỗ trợ `FC_PUBLIC_ORIGIN=https://...` cho HTTPS reverse proxy. Không tự tin `X-Forwarded-Proto` từ client để tạo đường dẫn mời/camera. `FC_PUBLIC_ORIGIN` phải là origin HTTPS hợp lệ khi public; local có thể để trống.

**Giới hạn an toàn:** WebSocket implementation vẫn là transport nội bộ chưa được security audit độc lập; chưa nên coi nó tương đương thư viện `ws` được bảo trì. Trước khi mở dịch vụ public cho giải quan trọng, nên thay phần này bằng package mature hoặc có vòng penetration/reliability testing, thiết lập Caddy/Nginx, HTTPS, firewall, giới hạn traffic và bảo vệ account. Các API invite/OBS URL cũng cần thay token nếu từng chia sẻ công khai.

## 4. Test thủ công cần làm trên Windows

1. Dừng `npm start`; áp dụng patch; `npm test` và `npm start`.
2. Studio sidebar trái mặc định hiển thị **ALL PLAYER CAMERAS**; bốn hàng con bị thu gọn.
3. Bấm `PREV` nhóm: Preview hiện đủ 4 slot; Program/OBS chưa đổi. Slot offline hiện placeholder.
4. Bấm `TAKE`: Program hiện cả 4 slot; kiểm tra placeholder và fallback cùng đội nếu có một webcam.
5. Bấm `LIVE` nhóm: cả 4 slot tắt cùng lúc; bấm lần nữa cả 4 bật cùng lúc.
6. Nhấn mũi tên mở rộng; tắt riêng B2 bằng LIVE; group LIVE hiện `3/4`, nhấn group LIVE lần tiếp sẽ đưa về `4/4`.
7. Preview toggle một camera khiến checkbox tổng thành indeterminate, không tự làm thay đổi Program.
8. Chuyển phiên BO, reconnect camera và refresh `/output` — media không dùng lại từ BO cũ, manual BO score và Game History không bị thay.
9. Khi cache hoạt động: Network tab, tải lại logo hoặc `/build/studio.js`, xác nhận `ETag` / `304` khi browser gửi `If-None-Match`.
10. Kiểm tra OBS Browser Source nền alpha và camera không làm khựng graphics khi mất kết nối.

## 5. Benchmark thực tế (chưa hoàn thành trong patch)

- OBS Stats: skipped frames due to encoding/rendering lag, CPU/GPU, FPS; so sánh cùng scene Discord crop cũ.
- 4 webcam trên 4 máy khác nhau chạy liên tục ≥2 giờ; thử mất mạng, refresh, người chơi tắt video, đổi BO.
- Thời gian từ LIVE click đến bắt đầu animation, độ trễ WebRTC và số lần camera bị đen khi bật lại.
- Mạng của từng tuyển thủ (upload/jitter/packet loss), băng thông LiveKit và quota.

Với ngân sách VPS nhỏ, nguồn bottleneck thường nằm ở máy OBS/đường truyền và LiveKit quota chứ không phải DB/WS control. Không có bảo đảm “zero lag” trước stress test.

## 6. Hướng dẫn vận hành public VPS

- Dùng Node.js 22.16+ (khuyến nghị Node 24 LTS) và chạy server dưới systemd/PM2.
- Dùng Caddy/Nginx terminate HTTPS. Khi có domain, đặt `FC_PUBLIC_ORIGIN=https://ten-mien-cua-ban`, `HOST=127.0.0.1`, `PORT=4173`; reverse proxy về `127.0.0.1:4173`.
- Firewall chỉ mở 80/443; không expose trực tiếp TCP 4173. WebSocket qua WSS phải được proxy hỗ trợ.
- Tạo mật khẩu Admin mạnh, thay output token đã từng lộ; cất `.env` và `.runtime/secrets.json` ngoài Git/ZIP.
- Backup nhất quán SQLite (`fc-online.sqlite`, có thể có `-wal/-shm`) khi server dừng hoặc dùng SQLite Online Backup. Test restore thực tế.
- Nếu dùng LiveKit SDK từ CDN, có thể chạy `scripts/cache-livekit-sdk.ps1` trong root để lưu bản JS và phục vụ local khi đã kiểm tra checksum/version.

## 7. Ranh giới với graphic layer của Claude

Claude được thay bố cục/animation trong `client/stage.ts` và `public/assets/stage.css`, nhưng không tự tạo một kết nối LiveKit/WebSocket mới cho mỗi graphic. Các graphic đọc data contract hiện có từ `Program` và `match.history.snapshot`; camera group command và selective subscription thuộc Core.
