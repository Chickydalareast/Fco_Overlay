# FC Online Graphics Studio — v0.3A Data Core

## Đã thêm

- SQLite database (`.runtime/fc-online.sqlite`) dùng `node:sqlite` của Node.js >=22.16; không cần `npm install` thêm SQLite driver.
- Dữ liệu seed chuẩn: 16 CLB, 16 đội C1–C16, 32 tuyển thủ, 8 cặp đấu vòng bảng A/B/C/D.
- 16 PNG logo **tham chiếu** tách từ ảnh bảng đấu của người dùng (144px, nền trong suốt, chất lượng nguồn thấp). Những logo này chỉ để lựa chọn đội trong admin; đồ họa full-HD cần thay bằng ảnh nguồn tốt hơn trước khi lên sóng.
- Studio có dropdown chọn Team A/Team B, mỗi đội có đúng hai tuyển thủ; nút TAKE phát dữ liệu từ Preview lên OBS như v0.2.
- Endpoint chỉ cho Admin `GET /api/tournament/registry`; trả dữ liệu liên kết team–club–players–fixtures.
- Program State chuyển dần từ `.runtime/program.json` sang bảng `program_state` của SQLite, tự import từ JSON cũ vào lần chạy đầu. JSON v0.2 **được giữ nguyên**, không xóa/ghi đè.

## QUAN TRỌNG: Tỷ số BO vẫn thao tác bằng tay

- Nút `+ / −` trên Studio vẫn thay đổi `seriesWins` ngay lập tức trên Program như v0.2.
- Chọn đội từ Tournament Registry **giữ nguyên** tỷ số BO và `gameGoals` hiện tại để tránh mất điểm vô ý.
- Tỷ số trận từng game chưa tự tính hoặc đồng bộ với BO; Game History sẽ được thêm ở v0.3B.
- Chọn đội và tuyển thủ từ bên phải chỉ thay Preview. Nhấn TAKE mới đưa lên livestream.

## Sau khi áp dụng ZIP patch

1. **Tắt** `npm start` đang chạy bằng `Ctrl + C`.
2. Áp dụng patch theo script PowerShell trong lời hướng dẫn.
3. Chạy `node --version` (yêu cầu Node >=22.16; Node 24 LTS khuyến nghị).
4. Chạy `npm start` — server mở SQLite và tự seed dữ liệu một lần.
5. Đăng nhập Studio tại `http://127.0.0.1:4173/studio`.
6. Panel bên phải: `TOURNAMENT REGISTRY · 16 TEAMS`. Chọn `C10 — FC Barcelona` bên trái và `C16 — Arsenal` bên phải; chọn tuyển thủ thuộc từng đội.
7. Kiểm tra Preview trước, sau đó TAKE. Nút tăng/giảm BO phải giữ nguyên cách hoạt động cũ.
8. Tắt server, chạy lại: hai đội/trạng thái Program sau TAKE vẫn còn trong SQLite.

## Bảo toàn dữ liệu và rollback

- `.env`, `.runtime/secrets.json`, `.runtime/program.json` và file `.runtime/fc-online.sqlite` **không nằm trong ZIP** và không bị ghi đè bởi installer.
- Lần đầu boot mới, SQLite đọc ảnh chụp Program từ `program.json` nếu SQLite chưa có state. Sau đó **SQLite là nguồn ghi mới duy nhất**.
- Nếu rollback code về v0.2, v0.2 vẫn đọc `program.json` cũ, KHÔNG đọc state mới trong SQLite. Hãy export/đối chiếu trạng thái mới trước khi rollback để tránh mất các điều chỉnh sau v0.3A.
- JSON seed trong `data/tournaments/fc-online-2026` chỉ dùng khi tạo registry ban đầu. Sửa seed sau khi SQLite đã tạo **không tự cập nhật DB**; lần sửa roster cần migration chính thức.
- Sao lưu cả `.runtime/fc-online.sqlite`, `.runtime/fc-online.sqlite-wal`, `.runtime/fc-online.sqlite-shm` khi server đang chạy là KHÔNG đủ an toàn nếu chỉ copy từng file tùy tiện. Khi muốn backup thủ công đơn giản, **dừng server trước**, sau đó copy các file này hoặc dùng lệnh backup SQLite.
- Node.js 22 có thể in `ExperimentalWarning` cho `node:sqlite`; đây là warning của phiên bản Node, không phải lỗi project.

## Đã kiểm thử

- 15 automated tests: kiểm tra seed/foreign-key links, pairing C10–C16, migration JSON cũ, persistence, Scoreboard manual, camera state compatibility.
- TypeScript build và typecheck thành công.
- Kiểm thử API admin-only và startup localhost bằng script HTTP riêng.
- **Chưa** test bằng OBS/LiveKit trên máy người dùng; v0.3A không thay đổi luồng WebRTC của v0.2.

## Phạm vi chưa làm (theo master plan)

- v0.3B: Match Manager, Swap Sides, BO Game History, xác nhận lưu/sửa, dữ liệu Fullscreen Result.
- v0.3C: Room theo matchId và roster giới hạn, identity/approval, camera fallback.
- v0.3D: Unified Layer Stack + gameplay reference Admin-only + diagnostics.
- v0.3E: WebSocket hardening, cache/reconnect/media optimization & stress tests.
