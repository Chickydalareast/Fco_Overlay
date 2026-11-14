# FC Online Graphics Studio — v0.5C: BO State & TAKE Reliability

**Package:** `0.5.2` • **Yêu cầu baseline:** `v0.5B` / `0.5.1` • **Phạm vi:** logic Studio + server + test, không thay đổi giao diện đồ họa hay schema SQLite.

## Tóm tắt thay đổi

1. **Chọn đội để tạo BO mới**: khi Preview không còn trỏ tới BO đang LIVE, Studio tự đưa `GAME` về `1`, tỷ số BO của hai bên về `0–0`, số bàn từng game về `0–0`; 4 camera về OFF và gắn lại đúng hai tuyển thủ mỗi bên. Không reset Program khi chưa TAKE.
2. **Chọn nhầm rồi quay về đúng cặp đội LIVE**: nếu chưa nhấn nút PREPARE NEW BO, Studio khôi phục BO ID, game number, tỷ số, số bàn và camera của BO hiện hành (kể cả đã đổi thứ tự hai bên). Nếu đã chủ ý PREPARE NEW BO cùng hai đội, BO mới vẫn độc lập.
3. **Server chặn lỗi ở lớp cuối**: `program.take` tạo BO mới với `gameNumber != 1`, `seriesWins != 0` hoặc `gameGoals != 0` sẽ bị từ chối bằng `NEW_BO_NOT_RESET`. Không tạo BO mới, không kết thúc BO trước, không tăng revision khi bị từ chối.
4. **Rebase Preview theo BO identity**: trong thời gian chuẩn bị BO khác, thay đổi LIVE của BO hiện hành không thể chèn lại score/goals/game/roster/camera từ BO cũ. Những thay đổi graphic layer chưa chỉnh trong Preview vẫn có thể theo LIVE. Rebase trong cùng BO giữ quy tắc cũ: score LIVE được ưu tiên khi xung đột.
5. **Khóa TAKE khi đang xử lý**: cả hai vị trí nút TAKE (nếu xuất hiện) cùng bị khóa khi đã gửi lệnh. `command.ack` mới là xác nhận server đã tiếp nhận; chỉ khi nhận `program.state` có `commandId` trùng mới coi TAKE hoàn tất và reset Preview. `command.error`, mất kết nối hoặc timeout 4 giây mở khóa kèm thông báo; sau timeout cần **kiểm tra Program trước khi bấm lại**.

## Hành vi quan trọng

- **Chỉ chọn đội hoặc đổi Preview không làm thay đổi livestream**. VPS/SQLite vẫn là nguồn trạng thái Program chính thức; không có state on-air được ghi vào `localStorage`.
- **TAKE mở BO mới** sẽ cần xác nhận nếu đang có BO LIVE; phòng camera tuyển thủ sẽ chuyển sang session ID mới theo logic cũ. Vẫn chỉ có một phiên BO đang vận hành.
- **BO cùng hai đội nhưng phiên mới**: tiếp tục bấm `PREPARE NEW BO` nếu muốn chủ động tạo một BO khác.
- **BO score độc lập với Game History** như trước; không tự động tính thắng thua từ lịch sử trận.
- **Không thay đổi SQLite schema, không reset DB**; các trận và lịch sử cũ được bảo toàn.

## Kiểm thử tự động

- Thêm `tests/v05c-core.test.mjs`: **11** test chống hồi quy, gồm từ chối dữ liệu BO cũ, giữ lịch sử, swap sides cùng BO, chuẩn bị BO mới, rollback lựa chọn đội, Preview rebase và khóa TAKE/ACK.
- Cập nhật dữ liệu chuẩn của **4 file test cũ** (`bo-session`, `camera`, `v04d-btc-room`, `tournament-db`) để mở BO mới bắt đầu từ GAME 1 / tỷ số 0-0. Đây là thay đổi test fixture có chủ đích, không bỏ assertion cũ.
- Số lượng dự kiến trên máy có `ws`: **116 PASS / 0 FAIL** (`npm test`). Trên môi trường build không có `ws` và không thể truy cập npm registry: **109 PASS**, 2 test suite không import được (chưa xác minh đủ 115). TypeScript build và typecheck **PASS**.
- Kiểm tra UI bằng Chromium bị chặn truy cập local (`ERR_BLOCKED_BY_ADMINISTRATOR`); không tuyên bố đã chạy browser E2E hoặc OBS thực.

## Checklist test thủ công trên Windows, với Studio + OBS

| Tình huống | Kết quả mong đợi |
|---|---|
| BO A vs B đang **2–1**, GAME 3; chọn cặp đội C vs D trong MATCH tab | Preview về **0–0 / GAME 1**, 4 cam Preview OFF; Program vẫn **2–1** |
| Thay đổi tỷ số LIVE A từ 2 → 3 khi đang chuẩn bị C vs D | Preview C vs D vẫn **0–0 / GAME 1** |
| Bấm TAKE khi chuyển C vs D | Có xác nhận mở BO; sau xác nhận Program là C vs D 0–0; BO cũ finished và lịch sử còn trong SQLite |
| Chọn nhầm C rồi chọn lại A (trước khi nhấn PREPARE NEW BO) | Preview trở lại BO A vs B với tỷ số/game/camera LIVE đúng |
| Chọn PREPARE NEW BO dù giữ A vs B | Preview chuẩn bị session mới 0–0; TAKE mở phiên BO khác |
| Thay tên sân/stage trong cùng BO, rồi tăng tỷ số LIVE | Thay đổi Preview vẫn giữ; tỷ số LIVE mới được theo khi xung đột |
| Nhấn TAKE nhanh nhiều lần khi server phản hồi chậm | Không gửi trùng TAKE; nút bị khóa tới Program state/error/timeout |
| Tắt Wi-Fi máy điều khiển sau khi gửi TAKE | Studio báo disconnect, khi reconnect phải đồng bộ Program mới từ VPS trước khi TAKE lại |
| OBS đang phát scoreboard rồi đổi BO | OBS nhận Program revision và render đội/tỷ số mới, không cần đọc `localStorage` máy điều khiển |

## Cài đặt

1. Dừng server project (`Ctrl+C`); đảm bảo port `4173` đã giải phóng.
2. Giải nén ZIP patch và chạy `APPLY_PATCH.ps1` với `-ProjectPath` + `-PatchRoot` theo `START_HERE_V05C_VI.txt`.
3. Khi script in `SUCCESS: v0.5C installed (package 0.5.2)` (và `npm test` đạt `# fail 0`), chạy lại `npm start`.
4. Mở lại Studio (`Ctrl+F5`) và refresh OBS Browser Source. Tiến hành checklist trên với trận test, không phải trận đang phát sóng thật.

**Rollback:** dùng `ROLLBACK.ps1` lưu trong thư mục `.backups/core_v05c_*` vừa tạo. Mặc định rollback chỉ source và giữ nguyên database. Không cần `-RestoreDatabase` vì patch này không thay schema.

## Changelog để cập nhật handoff

`v0.5C (package 0.5.2)` — Sửa tạo BO mới mang tỷ số cũ; Preview BO mới không bị score LIVE của BO trước ghi đè; khóa TAKE/ACK chờ Program snapshot; thêm 11 regression test, kỳ vọng 116 test với dependency đầy đủ.

**Ghi chú về baseline:** ZIP source người vận hành cung cấp không chứa thư mục `docs/handoff` (bộ handoff được gửi ở ZIP riêng). Để không làm hash guard thất bại trên máy đã hoặc chưa giải nén bộ handoff, patch này **không ghi đè** `docs/handoff/00_README_FIRST.md` và `07_PATCH_HISTORY.md`; nội dung delta ở trên là nguồn cập nhật cho bộ handoff nếu tích hợp sau.
