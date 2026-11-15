# v0.5G - Tứ kết ABUxOHMYCASH CUP: ĐÚNG 8 đội

Nguồn: ảnh sơ đồ tứ kết người vận hành cung cấp ngày 15/11/2026.

## Bốn cặp tứ kết (theo thứ tự từ trên xuống của ảnh)

| Trận | Đội trái | Đội phải |
|---|---|---|
| Tứ kết 1 | C16 - Arsenal | C8 - Borussia Dortmund |
| Tứ kết 2 | C15 - Liverpool | C2 - Manchester United |
| Tứ kết 3 | C11 - Atlético Madrid | C7 - Manchester City |
| Tứ kết 4 | C14 - Real Madrid | C1 - AC Milan |

**Tổng: 8 đội duy nhất**: `C16, C8, C15, C2, C11, C7, C14, C1`.
**8 đội bị loại khỏi danh sách lựa chọn mới**: `C3, C4, C5, C6, C9, C10, C12, C13`.
Tất cả 16 ID đã được đối chiếu với seed `data/tournaments/fc-online-2026/teams.json`.

## Phạm vi sửa (an toàn cho giải đấu)

- Chỉ lọc hai dropdown Registry Team A/Team B trong Studio khi chọn BO mới.
- Giữ lại **đầy đủ 16 đội** trong seed và database SQLite, không xóa, không comment hay migrate dữ liệu.
- Đội đã bị loại nếu xuất hiện trong Program cũ vẫn được nhận diện và có option disabled, không cho chọn lại từ dropdown.
- Không tự động TAKE, không sửa đội đang LIVE, tỷ số BO, History, người chơi, thông số camera, logo, ảnh player, LiveKit, tài khoản hoặc OBS.
- Hai tuyển thủ Atlético dùng ảnh mẫu giống nhau là một patch asset độc lập; patch này KHÔNG sửa ảnh.
- Quy tắc camera room: phòng tuyển thủ chọn người từ **hai đội của BO đang hoạt động** như trước; không mở rộng danh sách thành 16. Điều kiện 8 đội áp dụng ở bước operator chọn đội trong Studio.
- Chỉ giữ lại nickname operator trước đó cho 7 đội; C11 hiển thị theo tên CLB trong Registry, không tự bịa nickname.

## Điều kiện cài

- Local Windows đang chạy **v0.5F / package 0.5.5** (patch 7 đội v0.5G cũ chưa áp dụng).
- Dừng `npm start`, chạy `APPLY_PATCH.ps1` từ PowerShell VS Code.
- Script xác minh hash baseline, backup, chỉ thay file trong manifest, rồi chạy `npm test` và typecheck khi có TypeScript.
- Nếu local file đã có sửa riêng và sai hash, **dừng, không force overwrite**; dùng source hiện tại để hòa giải patch.
- Không chuyển patch lên VPS production cho tới khi operator nghiệm thu local và chủ động git push/deploy.

## Checklist nghiệm thu

- [ ] Studio Team A chỉ có 8 đội C16/C8/C15/C2/C11/C7/C14/C1.
- [ ] Studio Team B cũng chỉ có đúng 8 đội, không chọn được C3/C4/C5/C6/C9/C10/C12/C13.
- [ ] C11 (Atlético Madrid) được phép chọn; C11 vs C7 TAKE hoạt động.
- [ ] Bốn cặp tứ kết chọn được theo hình, không bắt buộc match fixture cứng.
- [ ] BO cũ và Game History còn nguyên.
- [ ] Player photos, local camera room và OBS không bị thay đổi.
- [ ] `npm run typecheck` và `npm test` báo 0 lỗi.
