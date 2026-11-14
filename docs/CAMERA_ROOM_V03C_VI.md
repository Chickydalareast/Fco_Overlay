# FC Online Graphics Studio v0.3C — Camera Room & Identity + BO session workflow

## Mục tiêu
- Project tiếp tục từ **v0.3B**. Không chạm vào cấu hình `.env`, `.runtime` hoặc database hiện có khi apply patch.
- **Bỏ Match / Fixture selector khỏi giao diện**. Operator chọn hai đội từ Registry (C1–C16), chọn BO3/5/7 rồi TAKE. Nếu chưa có `matchId`, server tự cấp **ID phiên BO nội bộ**. Không cần tạo/chọn fixture. Đây chỉ là khóa lưu game history và room, không phải một bảng đấu phải tự quản lý.
- Tỷ số **BO vẫn điều chỉnh thủ công**; lưu Game History không tự cộng thắng game.
- Khi kết thúc BO, `EMERGENCY CLEAR` **chỉ ẩn** graphic/cam (không xóa dữ liệu). Chọn `PREPARE NEW BO (PREVIEW)` rồi TAKE để bắt đầu BO mới; lúc đó chỉ Preview được reset về 0–0, các slot cam được làm trống. Các game history BO cũ vẫn nằm trong SQLite.

## Trình tự dùng trong local
1. Tắt server đang chạy, áp dụng patch từ ZIP; chạy `npm start`.
2. Trong Studio, chọn hai team C1–C16 ở panel bên phải. Mặc định cả hai phải có teamId từ Registry.
3. `PREPARE NEW BO (PREVIEW)` nếu muốn BO mới/reset điểm. Xác nhận trước khi reset Preview.
4. Nhấn `TAKE PREVIEW → LIVE` để BO có ID nội bộ, chính thức hoạt động. Không cần tạo match/fixture.
5. Nhấn `Copy Player Room`, gửi link của **BO đang live** cho tuyển thủ. Link này có `invite` và `bo`; phải bảo mật, không đăng công khai.
6. Người chơi truy cập trang Camera Room, chỉ thấy hai đội hiện tại. Chọn một trong hai tuyển thủ hợp lệ của đội đó và chọn camera. `REQUEST CAMERA ACCESS`.
7. Studio: trong **Camera Room** xuất hiện join request; nhấn `APPROVE` hoặc `REJECT`.
8. Sau khi duyệt, người chơi được quyền kết nối WebRTC; khi có webcam online sẽ hiện tại Diagnostics/Camera Room.
9. Hệ thống tự điền người đã online vào slot Camera tương ứng **trong Preview** nếu slot trống. Chọn `Show in Preview` rồi TAKE. Hoặc dùng Live toggle tương ứng.
10. Nếu một tuyển thủ không có webcam, slot còn lại cùng phía có thể dùng cùng video track đang online. Không có thêm upload từ phía tuyển thủ. **Hai slot vẫn có nút Show/Hide độc lập**.
11. Khi đổi BO: `PREPARE NEW BO` rồi TAKE. Link room của BO cũ không hợp lệ cho BO mới; publisher của BO cũ được yêu cầu dừng phát.

## Quy ước UI
- `A1, A2` = hai người của đội ở **bên trái**; `B1, B2` = hai người của đội ở **bên phải**. Khi `SWAP SIDES`, hai đội và các slot đổi bên trong Preview, camera không phải kết nối lại.
- C1–C16 là mã đội và tên CLB hiển thị Scoreboard; tên người chơi từ Registry chỉ dành cho Player Intro, Camera Room và Game History.
- Dữ liệu room lấy theo **Program Live**, không phải Draft Preview. Điều này ngăn việc chuẩn bị BO kế tiếp làm thay đổi tuyển thủ hiện tại.

## Media / bảo mật / perf
- VPS Node.js chỉ ký token, kiểm tra roster, duyệt người chơi, lưu state và relay lệnh; 4 luồng webcam chạy qua LiveKit SFU.
- WebRTC token publisher có quyền `canPublishSources: ['camera']`, `canSubscribe: false`, TTL 10 phút khi join; LiveKit quản lý refresh cho kết nối đang hoạt động.
- Media room được phân tách bằng ID BO, không dùng chung một room LiveKit cho mọi BO.
- Player Room không gửi microphone. Trong trình duyệt, việc cấp quyền camera là hành động của người chơi.
- Operator xác nhận camera chỉ là **admission**; chưa có xác thực danh tính ngoài đời. Người cầm link có thể tự khai nhận là một tuyển thủ và cần operator kiểm tra trước khi duyệt.
- Approval và presence hiện ở RAM của Node; sau restart người chơi có thể phải request lại. Đây là beta, chưa phải hệ thống admission có durable persistence.
- Ở v0.3C, receiver vẫn dùng `autoSubscribe:true` cho 4 camera; tối ưu selective subscription, stale presence và đo tải OBS nằm trong v0.3E. Renderer không phải video encoder.
- Đổi BO không thay đổi cấu hình LiveKit và không xóa database hay lịch sử trận cũ.
- OBS Output giữ một URL nền trong suốt; không cần thêm Browser Source.

## Acceptance test
- Hai đội hợp lệ, mỗi đội hai người → đúng bốn lựa chọn.
- Player không thể chọn đội ngoài BO; server kiểm tra roster khi join.
- Join pending → người chơi **chưa có token LiveKit** → operator approve → nhận token camera-only.
- Camera online hiển thị dưới Diagnostics và đi vào slot Preview tương ứng; nếu trống video nguồn dùng fallback cùng đội.
- Link room trước khi TAKE hoặc link BO cũ đều không cho join.
- Tạo BO mới cùng hai đội: ID khác, game history mới trống, history cũ nguyên vẹn; BO manual score reset chỉ khi operator chuẩn bị BO mới và TAKE.
- Scoreboard vẫn hiển thị tên CLB/logo theo dữ liệu v0.3B, không phải tên tuyển thủ.
- Node test/typecheck/build pass; webcam LiveKit thực tế và FPS OBS cần người dùng kiểm thử.
