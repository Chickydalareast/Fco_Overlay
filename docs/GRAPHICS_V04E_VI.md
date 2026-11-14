# v0.4E - Luân lưu / hiệp phụ + tên tuyển thủ trên cam (package 0.4.6)

## 1. Kết quả game: Thường / Hiệp phụ / Luân lưu
Form **BO & Game history** trong Studio:
- Thêm ô **Decided by**: Regular time / Extra time / Penalties.
- **Tỉ số hoà** thì form tự chuyển sang Penalties và hiện 2 ô **luân lưu** (0–30). Không hoà thì không chọn được Penalties.
- **Winner (auto)**: đội thắng tự tính theo tỉ số (hoặc theo luân lưu khi hoà), không chọn tay nữa.
- Không lưu được khi: hoà mà chưa nhập luân lưu; luân lưu bằng nhau; nhập luân lưu khi tỉ số không hoà.
- Danh sách game hiện kiểu `2 – 2` + `PEN 4-3`, `1 – 3` + `HIỆP PHỤ`.
- Ô Note vẫn còn (ghi chú tự do, không bắt buộc).
- Tỉ số BO trên scoreboard **vẫn chỉnh tay**, không tự cộng theo lịch sử.

### Database
- Tự nâng cấp lên **v4** ở lần `npm start` đầu tiên sau khi cài: thêm 3 cột (kiểu kết thúc, luân lưu trái, luân lưu phải). Kết quả cũ giữ nguyên, được coi là "Regular time".
- Patch đã sao lưu database trước khi cài (thư mục `.backups\graphics_v04e_...\runtime-before-v04e`).
- Rollback về v0.4D vẫn chạy được với database mới (bản cũ bỏ qua cột mới), không bắt buộc khôi phục database.

## 2. Tên tuyển thủ trên cam
- Thẻ tên nhỏ (cao 28px ở 2K, khoảng 21px ở 1080p) nằm **ngay trên mép khung**, không che hình.
- Đội trái: nền đỏ chữ trắng, canh trái. Đội phải: nền cam chữ đen, canh phải. Tên dài tự co chữ.
- Hiện tên **người đang lên hình**: ô lấy cam đồng đội thì thẻ đổi sang tên đồng đội.
- Ô đang hiện logo (chưa có hình / tạm dừng vì dọc) thì ẩn thẻ.
- Tên lấy từ danh sách tuyển thủ đã đăng ký của BO (Studio không phải nhập thêm). Đội nhập tay không có danh sách thì không hiện thẻ.
- Studio Preview không có hình cam nên không hiện thẻ; xem trên OBS.

## 3. Test và tiêu chí PASS

### A. Tự động
- `# pass 85`, `# fail 0`, dòng cuối `SUCCESS: v0.4E_r2 installed (package 0.4.6)`.

### B. Thực tế
| # | Thao tác | PASS khi |
|---|---|---|
| E1 | `npm start` | Terminal có `GRAPHICS STUDIO v0.4E`, không báo lỗi database |
| E2 | Game 1 nhập 2–2 | Decided by tự thành Penalties, hiện 2 ô luân lưu, Winner báo "Enter penalties" |
| E3 | Nhập luân lưu 4–3, Save | Danh sách: `2 – 2` / `PEN 4-3`, W: đội trái |
| E4 | Luân lưu 4–4, Save | Báo lỗi, không lưu |
| E5 | Game 2 nhập 1–3, Extra time, Save | Danh sách: `1 – 3` / `HIỆP PHỤ`, W: đội phải |
| E6 | Edit audit | Thấy bản trước / bản sau có luân lưu |
| E7 | Kết quả cũ trước khi cài | Vẫn hiện đúng như cũ |
| E8 | Bật LIVE 4 cam (tuyển thủ đã vào phòng) | Mỗi ô có thẻ tên nhỏ phía trên, không che hình |
| E9 | 1 tuyển thủ đóng tab | Ô đó hiện cam + tên của đồng đội |
| E10 | Tuyển thủ xoay dọc | Ô hiện logo, thẻ tên ẩn |

## 4. Rollback
`ROLLBACK.ps1 -ProjectPath . -BackupPath ".backups\graphics_v04e_<ngày giờ>_<mã>"` → quay về v0.4D.
Muốn trả database về đúng lúc trước khi cài thì thêm `-RestoreDatabase` (mất các kết quả nhập sau khi cài).
