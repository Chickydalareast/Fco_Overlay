# FC Online Graphics Studio — v0.3B (Patch 02/05)

## Trọng tâm bản này

1. **Sửa đúng scoreboard**: hiển thị **tên CLB/đội** và **logo CLB** tại `/assets/clubs/*.png`, không hiển thị tên cá nhân. Tên người chơi vẫn xuất hiện trong **Player Intro**.
2. **Match Manager**: sử dụng 8 fixture seed đã có; hoặc tạo trận riêng từ hai mã C1–C16 và BO3/BO5/BO7.
3. **SWAP SIDES**: hoán đổi hai đội cùng tỷ số BO và slot camera A1↔B1, A2↔B2 trong **Preview**; chỉ có hiệu lực trên OBS sau TAKE.
4. **Game History**: lưu kết quả từng game vào SQLite, lựa chọn đội thắng (cần thiết khi tỷ số hòa/penalty), cho sửa và ghi lịch sử trước/sau vào bảng audit; mỗi lần lưu/sửa đều hiện hộp thoại xác nhận.
5. **BO scoreboard vẫn NHẬP TAY (+/−)**, không tự tính hoặc thay đổi khi lưu/sửa lịch sử game. Bản này không thay đổi cách thao tác tỷ số BO đã quen thuộc.

## Chạy thử sau khi apply patch

1. Tắt `npm start`. Chạy script áp dụng patch. Rồi chạy `npm start` lại.
2. Vào Studio, đăng nhập. Tại **Match Manager & Game History**, chọn fixture `C10 Barcelona vs C16 Arsenal` rồi **PREPARE MATCH**.
3. Preview phải có tên CLB `FC Barcelona` và `Arsenal FC`, cùng logo tương ứng ở scoreboard khi Scoreboard đang được bật. Player Intro vẫn có tên tuyển thủ, ví dụ `TANK`.
4. Nhấn **SWAP SIDES (PREVIEW)**. Đội và tỷ số BO đi cùng nhau, không đổi lịch sử game đã lưu. Nhấn lần nữa để trả lại vị trí ban đầu.
5. Chọn Game 1, nhập `2` cho C10, `1` cho C16, chọn winner C10, nhấn **CONFIRM & SAVE GAME**. Xác nhận hộp thoại. Hàng Game 1 phải hiện `2–1`.
6. Chọn `EDIT` hàng Game 1, sửa thành `1–2`, đổi winner C16 và xác nhận. Bấm **View Edit Audit** để xem hai bản ghi create/edit.
7. Xác nhận nút `+/-` tỷ số BO phía dưới vẫn cập nhật Program như trước; kết quả `1–2` của Game 1 **không tự cập nhật BO**.
8. Bấm TAKE để đưa fixture mới và vị trí hai bên lên Program; nếu không TAKE thì OBS không thay đổi dữ liệu đội.
9. Khởi động lại server, xem game history đã lưu vẫn còn trong SQLite.

## Thiết kế dữ liệu

- Thêm migration SQLite v2: `broadcast_matches`, `game_results`, `game_result_audit`.
- `matchId` được thêm tùy chọn vào Program Match. Trận được tạo từ fixture có ID `match-GROUP-A-1` ...; trận tự tạo có ID UUID ổn định.
- History gắn theo hai `teamId` ổn định trong DB (`left_team_id`,`right_team_id` lúc tạo trận), KHÔNG gắn theo vị trí màn hình đang swap.
- Mỗi kết quả có `version` để chống ghi đè khi hai tab admin cùng sửa. Trả lỗi `409 STALE_GAME_VERSION` nếu version cũ.
- Winner được xác nhận rõ ràng. Với tỷ số hòa 0–0, có thể chọn winner theo penalty; dùng `note` ghi chú tỷ số penalty.
- Kết quả history được commit ngay sau khi xác nhận; chỉ riêng bố cục, tên/đội, camera và lớp graphic mới dùng Preview→TAKE.
- Những trận trong DB không được tự xóa nếu đang có history.

## API (backend)

- `GET /api/matches` — Admin, danh sách trận.
- `POST /api/matches` — Admin, tạo trận với `{leftTeamId,rightTeamId,bestOf}`.
- `GET /api/matches/:matchId/games` — Admin hoặc OBS read-only token; payload phục vụ layer Match Result sau này.
- `PUT /api/matches/:matchId/games` — Admin, lưu/sửa `{gameNumber,leftGoals,rightGoals,winnerTeamId,note,expectedVersion}`.
- `GET /api/matches/:matchId/audit` — Admin duy nhất.
- WebSocket event `match.history.changed` thông báo dữ liệu game thay đổi; không ghi đè Program State hoặc tỷ số BO.

## Giới hạn và lưu ý

- Đây là **core + Studio UI** cho Match History. **Fullscreen Result graphic** chưa được dựng; Claude sẽ làm graphics sau, còn tích hợp layer vào Unified Studio thuộc patch v0.3D.
- Hình logo trong source vẫn là ảnh PNG tham chiếu tách từ bảng đấu (độ phân giải nguồn thấp). Khi dùng output lên livestream chính thức nên thay bằng assets chính thức, rõ nét và phù hợp quyền sử dụng.
- Bản này không thay đổi Camera Room/LiveKit. Tính năng room giới hạn theo fixture và fallback webcam thuộc v0.3C.
- **Database** `.runtime/fc-online.sqlite` sẽ chạy migration v2 khi server khởi động sau patch; script patch tạo bản sao lưu trước khi sửa source. **Không** đè `.env`, `.runtime` hoặc secrets.
- Khi rollback code về v0.3A, DB đã nâng schema v2 vẫn có thể mở bởi code cũ (không downgrade); v0.3A không có UI nhập/xem game history, nhưng các bản ghi history vẫn nằm trong DB. Nếu cần rollback đầy đủ dữ liệu, dừng server rồi restore bản sao lưu SQLite trước khi khởi động phiên bản cũ.
- Script patch sẽ **dừng an toàn** nếu phát hiện file source v0.3A có chỉnh sửa riêng so với baseline, tránh ghi đè thay đổi của người dùng/Claude.
- `node:sqlite` yêu cầu Node >=22.16, Node 24 khuyến nghị.

## Chỉ số test tại thời điểm xuất patch

- 22/22 Node tests PASS, TypeScript build/typecheck PASS.
- HTTP smoke PASS: auth, match listing, tạo match, game save, conflict 409, audit và output read-only token.
- **Chưa nghiệm thu UI trực quan trong OBS trên máy streamer**. Browser automation trong môi trường đóng gói bị chặn truy cập localhost, nên cần thực hiện checklist chạy tay sau apply.
