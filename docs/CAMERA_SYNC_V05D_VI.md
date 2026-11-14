# FC Online Graphics Studio — v0.5D: Camera Reconnect & OBS Synchronization

**Phiên bản:** v0.5D / `package.json` 0.5.3  
**Yêu cầu:** đã cài thành công v0.5C / package 0.5.2  
**Không thay đổi:** database schema, tỷ số/BO logic v0.5C, các asset giải đấu, phông nền, camera của Phòng BTC, mật khẩu/`.env`, API LiveKit trên VPS.

## 1. Mục tiêu và thay đổi

### A. Reconnect / subscription LiveKit

- `client/camera-receiver.ts` không nhớ subscription bằng `(identity, trackSid)` qua nhiều Room nữa. Cache dùng đối tượng `RemoteTrackPublication`, được reset khi full disconnect/teardown, và được yêu cầu lại khi ICE reconnect.
- Khi LiveKit báo **Reconnecting**, trạng thái video tạm về *chờ frame*, không hiển thị *ready* giả. Khi **Reconnected**, receiver yêu cầu subscription và chờ frame mới.
- Cơ chế fallback hai thành viên cùng đội, cấu hình HIGH cho OBS, giai đoạn giữ frame khi exit và auto-retry giữ nguyên.

### B. Prewarm video thật, tự hết hạn

- Khi Preview của **BO hiện đang LIVE** chứa các camera sắp TAKE, Studio gửi `camera.prewarm {boId,playerIds}`. VPS chỉ chuyển tiếp các ID tuyển thủ thuộc BO đang hoạt động.
- OBS nhận hint, kết nối LiveKit và **thực sự subscribe** các `Camera` publication được chỉ định. Không subscribe camera đội không liên quan.
- Prewarm hết hạn sau **45 giây**. Nếu camera vẫn chưa LIVE, receiver rời room để không tiêu thêm participant minutes; nếu đã LIVE, giữ room. Khi Preview còn cần hỗ trợ, một thao tác mới hoặc WS reconnect có thể gửi hint mới (giới hạn 30 giây giữa các hint).
- **Giới hạn:** chưa thể prewarm session của một BO *chưa TAKE* vì LiveKit room/session của BO đó chưa có. Subscribe trước cũng không bảo đảm hình lên ngay nếu nguồn của tuyển thủ chưa publish/đang mute hoặc OBS/CEF chưa nhận frame.

### C. Hai tầng trạng thái trên Studio

`renderer.ready` và `renderer.media` là hai tín hiệu khác nhau:

| Trạng thái | Ý nghĩa chính xác |
|---|---|
| `OBS OFFLINE` | Không có output WebSocket với label `OBS` |
| `OBS SYNC PENDING` | Output `OBS` chưa ACK đúng revision Program hiện tại |
| `OBS CAMERA WAIT` | Đã nhận layout revision hiện hành, nhưng một hay nhiều camera LIVE chưa có frame đã decode (hoặc chưa có media report) |
| `OBS SYNCED` | Output `OBS` đã ACK revision hiện hành; camera đang LIVE đã báo frame đầu (hoặc không có camera nào bật) |

Dòng dưới cùng liệt kê từng renderer, revision và `camera n/N frames`, `media ?` hoặc `cameras OFF`. Đây **không phải** bằng chứng Twitch/YouTube đã nhận pixel hình ảnh cuối cùng; chỉ là xác nhận trên trình duyệt OBS.

`server/renderer-sync.mjs`: VPS chỉ công nhận renderer ACK đúng revision đang LIVE; media report phải cùng revision và có đủ các camera slot đang bật, không nhận report cũ/mẫu thiếu.

### D. Khi mất kết nối

- OBS WS reconnect nhận lại `program.state` từ VPS, render đúng Program đang phát và ACK lại. Không phụ thuộc `localStorage` máy Studio.
- Nếu LiveKit mất kết nối trong khi WS vẫn còn, camera chuyển sang WAIT cho tới khi lại có frame.
- Không tự TAKE, không phát lại lệnh cũ, không thay đổi tỷ số hay lịch sử.

## 2. Các file chính

- `client/camera-receiver.ts` + `public/build/camera-receiver.js`
- `client/output.ts` + `public/build/output.js`
- `client/studio.ts` + `public/build/studio.js`
- `client/contracts.ts`, `client/realtime.ts` (protocol typing)
- `server/index.mjs`, `server/renderer-sync.mjs`
- `tests/v05d-media.test.mjs` (13 regression tests mới)

## 3. Tự động kiểm thử

1. Dừng Node server/OBS output trước khi áp dụng patch.
2. Cài patch bằng `APPLY_PATCH.ps1 -ProjectPath <project> -PatchRoot <patch-folder>`.
3. Lệnh `npm test` phải có **`# pass 129`, `# fail 0`** sau khi máy đã cài `node_modules/ws`; TypeScript typecheck PASS.
4. Bản kiểm tra đóng gói trên Linux chỉ chạy được **122 test PASS**; 2 suite khác không khởi động được do sandbox không thể tải dependency `ws` (`EAI_AGAIN`). Typecheck/build PASS. Không ghi 129/129 là đã thử trong sandbox.

## 4. Test thao tác thực tế — Windows / OBS / LiveKit Cloud

| Thử nghiệm | Kết quả cần thấy |
|---|---|
| Có 4 camera LIVE, REFRESH Studio | LIVE Program giữ nguyên; camera vẫn xuất hiện trên OBS; Studio nhận revision từ VPS |
| Tắt mạng máy streamer 10–20s rồi bật lại | OBS reconnect WS và/hoặc LiveKit; LIVE revision tự đồng bộ; camera báo WAIT rồi lên frame (không cần TAKE lại) |
| Camera tuyển thủ tắt/bật hoặc đổi chiều | Camera chờ frame mới, không báo ready khi mute |
| OBS Browser Source khởi động chậm | Studio hiện `OBS SYNC PENDING` cho tới ACK revision hiện hành |
| OBS nhận Program, nhưng nguồn camera chưa publish | Studio hiện `OBS CAMERA WAIT` và `camera 0/N frames`; không hiển thị `OBS SYNCED` sớm |
| Khi camera thực sự có frame | `camera n/N frames` tăng; tất cả đã sẵn sàng mới hiển thị `OBS SYNCED` |
| Chỉ bật camera Preview của BO LIVE và đợi rồi không TAKE | OBS prewarm các nguồn sắp dùng; sau 45s rời SFU nếu không có camera LIVE |
| Chọn chuẩn bị BO kế tiếp | Không prewarm nhầm sang BO cũ, không thay thế video đang LIVE |
| Mở 2 output với label khác nhau | Studio phân biệt renderer tên `OBS` và các output kiểm tra; mỗi output có revision/media riêng |

Để kiểm chứng LiveKit trên thực tế cần bật **4 trình duyệt/điện thoại phát camera**; test mock chỉ kiểm tra logic, không thay thế được mạng thực và OBS CEF.

## 5. Lưu ý vận hành và rollback

- Giữ `?label=OBS` trong URL Browser Source được copy từ Studio. Nếu thay label khác, Studio vẫn liệt kê output trong footer nhưng không coi đó là streamer OBS chính.
- Prewarm chỉ hỗ trợ giảm thời gian chờ nếu tuyển thủ đã publish camera; không tạo video khi chưa có luồng từ người chơi.
- Không có sửa đổi database hay runtime data. Rollback source qua `ROLLBACK.ps1` trong thư mục backup được script in ra khi cài; **dừng Node server** trước khi rollback.
- Nếu Windows báo file hash khác baseline v0.5C, **không ép copy**: gửi log và file đã chỉnh để kiểm tra. Không xóa `.runtime`.

## 6. Phạm vi dành cho v0.5E / v0.5F

- **v0.5E:** Phòng BTC (nút xem/tắt camera, mic push-to-talk và audio meter).
- **v0.5F:** quality LOW/MEDIUM trong Studio thay vì HIGH; đo CPU/GPU/bandwidth ở OBS; animation/timer/backup DB.
