# v0.5F — Performance Optimization & Final Stability

Package **0.5.5** · cài trên **v0.5E / package 0.5.4**.

## Phạm vi thay đổi

1. **Studio viewer:** `CameraReceiver` hỗ trợ `videoQuality`. Studio yêu cầu LiveKit simulcast **LOW**, trong khi OBS Output yêu cầu **HIGH** trên kết nối LiveKit riêng. Publisher hiện phát simulcast 320×180 và khoảng 640×360; nếu LiveKit thực sự cung cấp hai lớp thì Studio giảm mức dữ liệu nhận so với bản cũ. Việc giảm lưu lượng thực tế phải kiểm tra trong LiveKit dashboard.
2. **Studio ở background:** khi `document.hidden` true, Studio ngắt riêng receiver LiveKit và giải phóng subscription ngay, không gửi lệnh nào cho VPS, không ngắt camera tuyển thủ hay OBS. Khi quay về tab, Studio kết nối lại theo BO và Preview/LIVE gần nhất. Nếu đang theo dõi camera, giữ tab Studio hiện lên foreground.
3. **CSS animations:** tắt wave lặp của Intro trong hai monitor Studio; tạm dừng hiệu ứng nền Cam Focus khi OFF, và loại bỏ loops trong Studio monitor. Hiệu ứng trên OBS khi đang LIVE giữ nguyên.
4. **SQLite:** `VACUUM INTO` khi đổi BO và bản backup daily chạy trong worker thread, tránh chặn main HTTP/WebSocket event loop. **Startup backup vẫn đồng bộ**, không thay đổi cơ chế lưu Program và schema. Worker chạy có hàng đợi, tránh 2 backup xung đột tên file; log lỗi nếu không backup được. Tệp backup vẫn nằm `.runtime/db-backups/` và giới hạn 20 bản.
5. **Game History:** ngăn **tạo mới** Game 3 khi BO3 đã được quyết định sau Game 2. Không chỉnh tỷ số BO thủ công; cho phép sửa kết quả đã có và backfill một bản ghi thiếu theo kiểu cũ.

## Test và giới hạn

- `npm run build` và `npm run typecheck` phải PASS.
- `node --test tests/v05f-performance.test.mjs` có **9 regression test mới**.
- `npm test` khi đã có đủ dependency kỳ vọng **148 PASS / 0 FAIL**.
- Môi trường xây dựng không cài được `ws` từ npm; do đó chỉ xác minh **141 PASS**, **2 suite không thể khởi động** do `ERR_MODULE_NOT_FOUND: ws`. Đây là giới hạn kiểm thử, không được diễn giải là full suite đã PASS.
- Chưa kiểm tra LiveKit Cloud với 4 camera thật, quota, Chromium/CEF trong OBS hoặc CPU/GPU máy streamer. Việc `setVideoQuality(LOW)` được kiểm tra với mock SDK.

### Benchmark SQLite synthetic (không sử dụng DB của người vận hành)

Chạy trong project: `node scripts/benchmark-v05f.mjs`. Benchmark tạo DB giả khoảng **9.93 MB**, không truy cập `.runtime`.

| Giá trị | Mẫu kết quả (máy kiểm thử) |
|---|---:|
| VACUUM INTO đồng bộ | 20.95 ms (một lần chạy; lần khác ~58.92 ms) |
| Chờ backup bằng worker (wall-clock) | 77.81 ms |
| Main thread timer trong lúc worker chạy | 5.36 ms |

**Lưu ý:** worker không nhất thiết làm backup *hoàn tất* nhanh hơn, nhưng tránh đóng băng main event loop trong thời gian đó. Số này không phải số đo FPS, GPU, bitrate LiveKit hoặc kết quả trên VPS thực tế.

## Nghiệm thu trên máy thật

1. Đứng ở `E:\Project\Fco\fc-overlay-phase1`; dừng `npm start`; áp dụng patch với `APPLY_PATCH.ps1 -ProjectPath (Get-Location).Path -PatchRoot "$tmp\patch"`.
2. Chạy `npm test`, kiểm tra `# pass 148`, `# fail 0`, và `SUCCESS: v0.5F installed (package 0.5.5).`
3. Mở Studio và OBS với hai đội đang LIVE. Studio xem 4 cam LOW, OBS vẫn nhận HIGH và không đen hình.
4. Ẩn tab Studio, kiểm tra dashboard LiveKit: không còn participant/viewer Studio sau khi ngắt, trong khi camera trên OBS vẫn hiện. Mở lại Studio: các monitor tự khôi phục.
5. Test Intro, BO History, Cam Focus trong Studio và khi TAKE lên OBS: animation đang LIVE phải giống trước đây, monitor không tự chạy wave liên tục.
6. Test BO3: Game 1/2 đều thắng bên A, tạo Game 3 phải bị chặn; trường hợp 1–1 vẫn lưu Game 3 được; scoreboard BO không đổi do ghi lịch sử.
7. Mở/tắt các BO khi OBS đang kết nối, kiểm tra không tụt WS; `.runtime/db-backups` vẫn có bản `bo-change` và startup/daily chạy theo lịch.
8. Quan sát Task Manager máy operator, OBS (CPU/GPU), LiveKit analytics (data transfer + participant minutes), và độ trễ TAKE. Ghi số đo trước/sau thực tế nếu muốn đánh giá quota.

## Rollback

Sử dụng `ROLLBACK.ps1` trong ZIP với đường dẫn backup mà script APPLY đã in. Chỉ rollback source; v0.5F **không migration database**. Giữ nguyên `.runtime`, `.env`, logo và ảnh của người vận hành.

## Giới hạn cần nhớ

- Nếu người xem chạy Studio trên máy có Chromium/OBS cũ, LiveKit SDK vẫn phụ thuộc khả năng chọn layer và browser; trong một số mạng, LOWER quality có thể làm hình Studio kém rõ hoặc chuyển layer chậm.
- Việc ẩn tab Studio chỉ tiết kiệm băng thông của **Studio**; vẫn phải giữ nguyên máy streamer OBS để có hình. Participant minutes ở OBS không giảm.
- Backup worker có thể hoàn tất sau lệnh TAKE, nên phải kiểm tra log nếu có cảnh báo `[db] Backup skipped`. Dữ liệu Program chính vẫn lưu trong SQLite transaction như cũ.
