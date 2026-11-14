# FC Online Graphics Studio — Camera Room Beta v0.2

## Trạng thái

Mã nguồn Phase 1 (scoreboard + intro) được GIỮ NGUYÊN. v0.2 thêm Camera Room 4 slot, một OBS Output URL, Studio Preview / Program, Show/Hide có animation.

**Đã xác nhận:** TypeScript build; 8 Node tests; trạng thái v0.1 được migrate; luật phân quyền camera-only/viewer-only; các route HTTP cơ bản.

**Chưa xác nhận:** stream LiveKit thực tế, FPS OBS, tương thích OBS Browser Source trên máy streamer, chất lượng khi live 4 camera đồng thời. KHÔNG coi bản beta là đã đạt chuẩn production.

## Đường dẫn

- Studio: `http://127.0.0.1:4173/studio`
- OBS output: copy từ nút **Copy OBS URL** (không tạo URL thứ hai).
- Player Room: copy từ nút **Copy Player Room** rồi gửi cho tuyển thủ. Link sẽ có token invite riêng.

**QUAN TRỌNG:** Link localhost chỉ dùng được TRÊN MÁY BẠN. Người chơi ở máy khác phải truy cập domain/VPS đã cấu hình **HTTPS (wss://)**; `getUserMedia` sẽ bị browser chặn trên HTTP công khai.

## Cấu hình LiveKit Cloud

1. Tạo project trên LiveKit Cloud.
2. Copy `.env.example` thành `.env` tại project root.
3. Điền `LIVEKIT_URL` (dạng `wss://...`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` của project LiveKit.
4. KHÔNG đẩy `.env` lên Git / gửi cho tuyển thủ. Secret được dùng để ký JWT phía server, chỉ token giới hạn quyền mới được trả về client.
5. Khởi động lại `npm start` (hoặc `start-windows.bat`).
6. Login Studio. Nếu phần Camera Manager báo `MEDIA CONFIGURED`, nhấn Copy Player Room.
7. Người chơi mở link HTTPS, nhập tên, chọn đội, cho phép browser truy cập camera, nhấn Start Camera & Join.
8. Trong Studio thấy người chơi online, chọn người cho slot A1/A2/B1/B2, bật `Show in Preview`, xem thử; nhấn TAKE để phát. `TOGGLE LIVE CAM` là bật/tắt trực tiếp (không qua TAKE).

## Quy tắc camera / tài nguyên

- Người chơi: chỉ publish CAMERA, không publish microphone hoặc subscribe camera của các tuyển thủ khác.
- Admin và OBS: subscriber nhận video trực tiếp từ LiveKit SFU. VPS KHÔNG nhận, mix hay encode video.
- Camera capture gợi ý: 640×360, max 20 FPS, max 700 kbps; actual bitrate/quality phụ thuộc mạng và thiết bị.
- Không reconnect khi Show/Hide: WebRTC track giữ kết nối, CSS animation vào/ra. Hai màn Studio sử dụng chung một receiver trên máy admin.
- Bản beta giữ subscription dù tile đang ẩn để bật lại nhanh; tối ưu tạm unsubscribe khi không cần có thể làm sau khi benchmark.
- Không có audio, không có GOAL animation trong v0.2; Phase 2 mới làm celebration layout.
- Renderer Preview và Program dùng cùng stage component, nhưng hai trạng thái riêng.
- Mỗi slot hiển thị placeholder nếu chưa nhận được track; không làm mất scoreboard.

## Kiểm thử thực tế bắt buộc trước giải

1. Tuyển thủ ở máy KHÁC vào Player Room trên HTTPS. Kiểm tra permission, chọn camera, nhận feed.
2. OBS Browser Source 1920×1080, 60 FPS; dùng URL Copy OBS URL. Overlay trong suốt, source nằm dưới streamer cam nếu cần.
3. 4 máy chơi FC Online + webcam, xem OBS Stats trong 1–2 giờ. Đo render/encode lag, CPU/GPU, camera freeze.
4. Test rớt mạng, refresh Room, refresh OBS source, TAKE khi camera rớt mạng, Emergency Clear.
5. So sánh với Discord crop trên cùng máy để quyết định 360p/480p, preset FPS và bitrate.

## Giới hạn beta và an toàn

- **Một giải/room chính** (`FC_LIVEKIT_ROOM`, mặc định `fc-online-camera-primary`). Nhiều giải/room phân biệt và phân quyền slot sâu hơn chưa có.
- Join invite là link bí mật dùng chung. Người có link có thể vào room; operator phải gán slot thủ công. Chưa có approval queue, kick/ban, token expiry cho link, rate limit phân tán hay quản lý từng trận.
- Room roster nằm trong memory server; restart server sẽ mất presence (slot assignment của program vẫn lưu). Tuyển thủ kết nối lại bằng cùng browser sẽ giữ identity localStorage.
- WebSocket ở v0.1 là implementation tối giản cho local spike, CHƯA HARDEN để public internet. Trước khi deploy phải chuyển sang thư viện WS đã kiểm chứng, thêm bảo mật reverse proxy, HTTPS, giới hạn socket/rate, logs, cập nhật token.
- LiveKit client script v2.23.0 đang tải qua jsDelivr theo mặc định. Để tránh phụ thuộc CDN khi live, chạy `powershell -ExecutionPolicy Bypass -File .\scripts\cache-livekit-sdk.ps1` trên máy có internet. Script tải bản cố định vào `public/vendor/` và đổi 3 trang HTML sang link local. Không chạy script khi chưa xác minh URL/cấu hình nếu môi trường hạn chế outbound network.
- Chỉ dùng livestream thật sau khi người chơi đồng ý phát webcam và đã test trên OBS.

## Lệnh dev

```
node --version
npm start
npm test
npm run build  # cần TypeScript devDependency cài bằng npm install nếu máy chưa có
```

## Lộ trình tiếp theo

v0.2: Camera Room Beta, 4 slot, preview, one OBS URL (đợt này).
v0.3: Test LiveKit/OBS thật, improve join reconnect + timeouts, admin approval, 4-spot crop/position presets, server hardening.
Phase 2: GOAL celebration — phóng camera của người ghi bàn trên cùng video track + animation; không reconnect.
