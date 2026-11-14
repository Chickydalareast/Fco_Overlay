# FC Online Graphics Studio — v0.5E: BTC Room Lite & Audio Reliability

**Phiên bản:** v0.5E / package `0.5.4`  
**Yêu cầu:** đã cài v0.5D / package `0.5.3`.  
**Phạm vi:** chỉ Phòng BTC (`/admin-room`), bộ điều khiển mic và audio meter; thay số phiên bản chung. **Không thay đổi SQLite schema, Program/Preview/TAKE, OBS output hoặc camera player.**

## 1. Xem camera BTC theo nhu cầu

- Phòng BTC **mặc định TẮT nhận video**, kể cả khi browser mới mở hoặc vừa reload. Tùy chọn này chỉ tồn tại trong tab đang mở, **không dùng `localStorage` hay VPS để lưu**.
- Nút **BẬT XEM 4 CAM / TẮT XEM 4 CAM** ở ngay tiêu đề Camera tuyển thủ. Bật: subscribe những camera thuộc roster hiện tại và yêu cầu `VideoQuality.LOW`; tắt: unsubscribe, detach các thẻ video, không còn nhận video riêng cho BTC.
- Tắt xem vẫn thấy 4 tên, đội, slot và trạng thái online / đang gửi / tạm dừng. Các ô chuyển thành dạng danh sách gọn, nhường chỗ cho phần điều khiển âm thanh.
- Khi danh sách tuyển thủ thay đổi, subscriber của BTC cũng unsubscribe camera không còn thuộc roster. Khi LiveKit reconnect, cache subscription được làm mới để request lại đúng trạng thái.
- Tắt video BTC **không dừng camera của tuyển thủ, không ảnh hưởng OBS**, cũng không thay đổi participant-minutes của kết nối BTC. Nó chỉ giúp giảm **downstream video của riêng tab BTC**.

## 2. Micro / Push-to-talk

- Bộ điều khiển `client/btc-mic-controller.ts` tuần tự hóa thao tác: xin quyền micro, publish, unmute, mute, đổi thiết bị. Không còn nhiều lệnh async cùng chạy đối nghịch khiến việc nhả Space bị đảo sau lệnh bật.
- **Nhả Space / mất focus / tab bị ẩn**: lập tức vô hiệu hóa track âm thanh ở máy BTC, trước cả khi LiveKit ACK. Nếu hộp xin quyền micro còn chờ và người dùng đã thả phím, track trả về sẽ không được publish.
- Nút mic vẫn hỗ trợ chế độ bật cố định: nếu đã bật cố định, nhả Space sẽ **không** tắt mic. Nếu chưa bật cố định, nhả Space sẽ tắt.
- Đổi thiết bị micro trong lúc phát: tắt gate, unpublish nguồn cũ, stop track cũ, xin đúng thiết bị mới rồi publish lại nếu vẫn muốn nói.
- Trên nút, `Đang bật micro…` nghĩa là đã yêu cầu nhưng **chưa xác nhận đang phát**; nút đỏ chỉ khi đã publish và track thực sự enabled. Lỗi xin quyền hiển thị ngay dưới nút, không ngụy trang thành lỗi kết nối tới VPS.

## 3. Audio meter

- Thay `requestAnimationFrame` chạy vô hạn bằng vòng RAF chỉ chạy khi tồn tại ít nhất một meter và tab còn hiển thị.
- Khi stop relay / đổi mic: ngắt `MediaStreamAudioSourceNode` và `AnalyserNode`, reset thanh đo. `pagehide` đóng tài nguyên audio và media.
- Giữ nguyên logic chuyển tiếp Discord/VB-Cable, lựa chọn thiết bị relay và cảnh báo hai BTC cùng chuyển tiếp; không phát audio BTC ra loa và không đẩy audio lên OBS.

## 4. Test và giới hạn xác minh

- Thêm `tests/v05e-btc-lite.test.mjs`: **10 bài test** cho ON/OFF subscription, mute khi chờ permission, publish chưa xong, unmute chưa xong, ON/OFF nhanh, đổi thiết bị, đổi room khi publish pending và lifecycle meter.
- `npm run build` và `npm run typecheck`: PASS. Trong môi trường đóng gói chỉ **132 test assertion PASS**; **hai suite không khởi động** vì thiếu package `ws` (`performance-hardening`, `v03g-production`). Không có fail do assertion.
- Trên máy đã cài `npm ci` đầy đủ, mục tiêu **139 PASS / 0 FAIL**. Đây **không phải kết quả đã được xác nhận ở môi trường đóng gói**.
- Headless Chromium bị giới hạn điều hướng; chưa xác minh camera LiveKit Cloud thật, microphone thật, OBS và giao diện chạy trực tiếp trong Chrome/Edge. Các bước dưới đây cần bạn test.

## 5. Nghiệm thu thao tác thực tế

| ID | Thử nghiệm | PASS nếu |
|---|---|---|
| E1 | Mở `/admin-room` sau khi cài, Ctrl+F5 | Nút BẬT XEM 4 CAM, 4 player dạng danh sách gọn, không hiện video |
| E2 | Có 4 tuyển thủ phát camera, BTC vẫn OFF | OBS có hình bình thường; Phòng BTC không tải hình |
| E3 | BTC bật xem | Có 4 video bản nhỏ; nút chuyển thành TẮT XEM 4 CAM |
| E4 | BTC tắt xem | 4 video biến mất, subscription riêng của BTC được hủy; OBS không đổi |
| E5 | Bật/tắt liên tiếp 4–5 lần | Không tự bật lại cam, không còn video đang chạy sau OFF |
| E6 | Giữ Space khi chưa cấp quyền mic rồi nhả trước khi chấp nhận | Không truyền tiếng sau khi cấp quyền muộn |
| E7 | Bấm bật mic rồi bấm tắt nhanh | Tuyển thủ không nghe tiếng khi UI báo OFF |
| E8 | Giữ Space rồi mất focus/chuyển tab | Mic tự ngắt nếu không bật mic cố định |
| E9 | Bật mic cố định, giữ rồi nhả Space | Mic vẫn phát cho tới khi chủ động bấm Tắt mic |
| E10 | Chọn mic khác khi đang bật | Mic cũ tắt, mic mới hoạt động, không bị âm thanh kép |
| E11 | Bật/tắt relay âm thanh Discord | Người chơi nghe như trước; meter dừng sau khi tắt |
| E12 | Đổi BO hoặc reconnect LiveKit | BTC vào đúng phòng mới, trạng thái cam OFF mặc định không tự subscribe; mic bật cố định được khôi phục theo ý người vận hành |
| E13 | Kiểm tra OBS và Studio | Program, camera LIVE, scoreboard và Game History không đổi |

## 6. Cài đặt và rollback

Giải nén `FC_Online_BTC_Lite_Patch_v0.5E.zip`, chạy `APPLY_PATCH.ps1 -ProjectPath <project> -PatchRoot <extracted>/patch` như trong file START_HERE. Script kiểm tra SHA-256 theo đúng source v0.5D, tự backup trước khi copy, kiểm tra Node >=22.16, build/test, kiểm tra TypeScript nếu có. **Dừng `npm start` trước khi patch.**

Sau cài: chạy lại `npm start`, Ctrl+F5 Phòng BTC. Không cần refresh OBS vì output không đổi. Khi cần rollback, dừng server và chạy `ROLLBACK.ps1` ở thư mục backup in ra bởi APPLY; không cần sửa database.
