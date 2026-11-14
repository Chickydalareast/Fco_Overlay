# Deploy VPS — FC Online Graphics Studio (v0.3G)

**Chưa cần làm ngay.** Đây là hướng dẫn để dùng khi đã xong UI. File mẫu nằm trong thư mục `deploy/`.

## Cấu hình VPS tối thiểu

| | Yêu cầu |
|---|---|
| CPU / RAM | 1 vCPU, 1 GB RAM (Node dùng khoảng 55–75 MB) |
| Ổ đĩa | 10 GB trở lên |
| Hệ điều hành | Ubuntu 22.04 hoặc 24.04 (KVM, không dùng OpenVZ đời cũ) |
| Mạng | IP tĩnh, mở cổng 80/443. Đặt VPS ở Việt Nam để thao tác LIVE trễ ít |
| Domain | 1 subdomain, ví dụ `overlay.tengiai.vn`, có A record trỏ về IP VPS |

Video webcam **không** đi qua VPS mà đi qua LiveKit Cloud, nên VPS rẻ vẫn đủ.

## Các bước

```bash
# 1. Node 24 LTS + Caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs caddy
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

# 2. Code: chép thư mục project (KHÔNG chép .runtime/.backups/node_modules) vào /opt/fc-overlay
sudo useradd --system --home /opt/fc-overlay fcstudio
sudo mkdir -p /opt/fc-overlay && sudo chown -R fcstudio: /opt/fc-overlay
cd /opt/fc-overlay && sudo -u fcstudio npm ci --omit=dev

# 3. Cấu hình
sudo -u fcstudio cp deploy/env.production.example .env   # rồi sửa domain + LiveKit key
sudo -u fcstudio mkdir -p .runtime

# 4. Service + HTTPS
sudo cp deploy/fc-studio.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now fc-studio
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile     # sửa domain
sudo systemctl reload caddy
```

## Kiểm tra

- `curl https://overlay.example.com/api/health` → `"status":"ok"`, `"database":"ok"`, `"livekit":"configured"`.
- `journalctl -u fc-studio -n 30` → có `GRAPHICS STUDIO v0.3G`, dòng OBS URL ghi `(hidden …)`.
- Mở `https://domain/studio`, bấm Copy OBS URL / Copy Player Room. Link phải bắt đầu bằng `https://domain`.

## Dữ liệu & backup

- Database: `/opt/fc-overlay/.runtime/fc-online.sqlite`.
- Server tự backup vào `.runtime/db-backups/` khi khởi động, khi mở BO mới và mỗi 24 giờ. Giữ 20 bản gần nhất.
- Muốn mang dữ liệu từ máy Windows lên VPS: dừng server ở cả hai nơi, chép `.runtime\fc-online.sqlite` và `.runtime\secrets.json` (nếu muốn giữ OBS URL cũ), rồi khởi động lại.

## Uptime monitor (tuỳ chọn)

Dùng dịch vụ miễn phí kiểu UptimeRobot gọi `https://domain/api/health` mỗi 5 phút. Endpoint trả HTTP 503 khi SQLite lỗi.
