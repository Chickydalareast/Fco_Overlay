# FC Online v0.3D — Unified Studio & Layer Stack

## Phạm vi
- **Layer Stack bên trái**: 3 graphic layers (Scoreboard, Player Intro, BO History) + 4 webcam slots (A1, A2, B1, B2). Mỗi layer có PREV và LIVE độc lập.
- **Điều khiển BO +/−** đã được chuyển sang cột trái; vẫn nhập tay, không đồng bộ tự động từ Game History.
- **Nguồn camera** chọn ngay trong hàng layer ở trái. Bên dưới Studio chỉ hiển thị hàng chờ Approve/Reject, tình trạng webcam và thông báo SFU.
- **Ảnh gameplay 1920×1080 do người dùng cung cấp** làm reference của cả hai monitor Studio. OBS `/output` vẫn alpha transparent. Bật/tắt gameplay reference, grid, safe zones hoàn toàn cục bộ, không đi vào Program State.
- **BO History layer**: thêm visibility vào Program/Preview và luồng snapshot realtime cho dữ liệu từng game. Có placeholder kỹ thuật để test display. Đây **không phải** animation/graphic hoàn chỉnh; Claude có thể thay UI/CSS giữ nguyên dữ liệu & events.
- BO session, roster approval, camera fallback, migration SQLite và manual BO scores giữ nguyên.

## Điều khiển
- **PREV**: chỉ đổi draft ở Studio Preview, cần `TAKE PREVIEW → LIVE` để xuất lên OBS.
- **LIVE**: lệnh trực tiếp; không cần TAKE. Nút này áp dụng cho Scoreboard, Intro, BO History và A1/A2/B1/B2.
- **Cameras**: chọn nguồn camera bên trái là thay draft assignment; không tự đổi Program.
- **Emergency Clear**: ẩn tất cả graphic layers và bốn camera, không xóa dữ liệu trận hoặc camera assignments.
- **Reference toggles**: chỉ hiển thị trên monitor Studio, không bao giờ có DOM reference trong OBS renderer.

## Contract gửi cho Claude
- `Program.match`: chứa hai đội, tên CLB/logo, player và manual BO series score.
- `Program.layers`: `scoreboard`, `intro`, `history` (mỗi layer `{visible:boolean}`).
- `Program.cameras.slots`: `A1/A2/B1/B2` với `participantId` và `visible`.
- `ServerEvent.match.history.snapshot`: `{ matchId, leftTeamId, rightTeamId, games[] }`, mỗi game có `gameNumber,leftGoals,rightGoals,winnerTeamId,note,version`. Kết quả thuộc ID đội lịch sử, không tự gắn theo left/right hiển thị nếu Swap Sides.
- `client/stage.ts` là stage renderer dùng chung cho Preview, Program, Output. Graphic module **không tự mở WebSocket hoặc LiveKit**. Không đưa image reference vào output markup.
- BO score manual **không phụ thuộc** Game History. Save/Edit chỉ thay DB và gửi history snapshot.

## Migration / backward compatibility
- State v0.3C có hai layer flags; v0.3D thêm `history:{visible:false}` khi load và ghi lại vào SQLite nếu cần.
- Không xóa BO, game history, camera assignments hay cấu hình LiveKit.
- v0.3C client command thiếu `history` vẫn được server nhận và chuẩn hóa thành hidden để không crash khi cập nhật.

## Test thủ công sau khi apply
1. Mở Studio, kiểm tra đủ Scoreboard / Intro / BO History / A1–B2 và BO +/− ở cột trái.
2. Kiểm tra cả hai monitor có ảnh gameplay thật; bỏ tick Gameplay still để thấy nền trung tính; tick Grid/Safe zones để căn chỉnh.
3. Mở OBS Output. Bảo đảm **không có ảnh gameplay reference** (vẫn trong suốt).
4. Bật `PREV` Scoreboard, một camera và History; chỉ Preview đổi. TAKE để Program nhận.
5. Bấm `LIVE` từng layer; xác nhận layer vào/ra mà không reload Browser Source.
6. Kiểm tra các cam online trong Diagnostics, Approve/Reject và fallback cùng đội còn như v0.3C.
7. Nhập game history, xác nhận BO History update qua WebSocket; tỷ số BO manual giữ nguyên.
8. SWAP SIDES ở Preview; dữ liệu history vẫn gắn theo team ID và hiển thị đảo chiều đúng.
9. Emergency Clear ẩn hết, không mất kết quả game hoặc team assignment.
10. Restart server; lịch sử, BO manual và visibility phục hồi.

## Chưa nằm trong v0.3D
- Hiệu ứng đồ họa final (Claude đảm nhiệm).
- Selective LiveKit subscription, reconnect policy/ACK hardening và cache immutable (dự kiến v0.3E).
- Benchmark thực tế trên OBS của streamer và stress test 4 webcam.
