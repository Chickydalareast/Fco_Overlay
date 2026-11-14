# FC Online Graphics Studio v0.3E — Performance & Hardening

Patch 05/05: All Cameras group cue (PREV/LIVE), expandable 4-slot controls, selective LiveKit subscription, heartbeat/backpressure WS, ETag static revalidation, optional FC_PUBLIC_ORIGIN for VPS. See `docs/PERFORMANCE_HARDENING_V03E_VI.md`.

---

# FC Online Graphics Studio v0.3D — Unified Layers

Patch 04/05: Một Layer Stack tập trung cho Scoreboard, Player Intro, BO History và bốn camera; BO score +/− ở cột trái; camera diagnostics tách khỏi controls; gameplay still trong Studio; history state/real-time data contract.

Xem `docs/UNIFIED_STUDIO_V03D_VI.md` để biết chi tiết/kiểm thử. Giữ nguyên cơ chế BO session / camera identity / SQLite từ v0.3C. Chạy local: `npm start` (Node >=22.16).

---

# v0.3C — BO Session + Camera Room Identity (Patch 03/05)

- **Không còn Match/Fixture selector trong Studio.** Chọn hai đội C1–C16, `PREPARE NEW BO (PREVIEW)` và TAKE. Phần mềm tự cấp ID BO để lưu lịch sử, không buộc operator quản lý danh sách trận.
- Camera Room chỉ cho chọn đội và tuyển thủ của BO đang LIVE. Operator phải duyệt (`APPROVE` / `REJECT`) trước khi cấp quyền phát webcam.
- Mỗi BO có media room riêng trên LiveKit; link cũ không dùng cho BO mới. Khi một camera không có track, có thể dùng video track còn lại của **cùng một đội** cho slot đó.
- BO score vẫn thủ công, Game History độc lập và được giữ lại sau New BO.

**Xem hướng dẫn đầy đủ:** [docs/CAMERA_ROOM_V03C_VI.md](docs/CAMERA_ROOM_V03C_VI.md).

---

# v0.3B — Match Manager & Game History

New: Match Selector, manual Game History (independent of BO), edit audit trail, Swap Sides in Preview, and corrected club-name/logo Scoreboard. See `docs/MATCH_MANAGER_V03B_VI.md`.

---

# FC Online Graphics Studio v0.3A — Tournament Data Core

**Mới:** SQLite registry C1–C16 / 32 tuyển thủ, selector Preview trong Studio, BO score vẫn nhập tay.

Xem [Hướng dẫn tiếng Việt](docs/TOURNAMENT_REGISTRY_V03A_VI.md) trước khi áp dụng lên v0.2.

**Yêu cầu Node.js >=22.16**, Node 24 khuyến nghị. `npm start` tạo `.runtime/fc-online.sqlite` và nhập Program từ JSON v0.2 một lần. Dữ liệu cũ không bị xóa. Dừng server trước khi patch.

---

> **Update v0.2 — Camera Room Beta:** thêm Player Room 4 webcam dùng LiveKit SFU, Studio preview/program và một OBS output URL. Xem [`docs/CAMERA_ROOM_V02_VI.md`](docs/CAMERA_ROOM_V02_VI.md) để cấu hình `.env`, HTTPS, hướng dẫn test và giới hạn beta. Mã v0.1 vẫn giữ nguyên logic scoreboard / intro.

# FC ONLINE GRAPHICS STUDIO — Phase 1 prototype

> **Status:** Technical Spike / v0.1 — runnable local proof-of-concept. This is a NEW project; not a BLTC / AOV fork.

A single transparent 1920×1080 output URL for OBS with two independently controlled layers: **Scoreboard** and **Player Introduction**. An operator runs a separate Studio UI on their machine: Preview is local, Program is the live state and TAKE publishes changes. Both layers may be visible simultaneously.

## Requirements
- Node.js **22+** recommended; Node 20.19+ may work, but current scripts were verified on Node 22.16.0.
- Modern desktop browser for Studio; OBS Browser Source for production graphics.
- No external database, no `npm install`, and **no runtime npm packages** are needed to run the included compiled prototype.
- TypeScript 5.8+ (optional) only when modifying source code and rebuilding.

## Run locally

```bash
cd fc-overlay-phase1
npm start
```

Open **http://127.0.0.1:4173/studio**. The terminal prints a randomly generated admin password the first time you start the server. After signing in, click **Copy OBS URL**. Paste it into a browser tab to simulate the OBS output.

### OBS configuration
- Sources → `+` → **Browser**.
- Paste the copied URL, preserving its read-only `token`.
- Width = **1920**, Height = **1080**; FPS = **60** target (30 if streamer hardware requires).
- Place Browser Source **above game capture**, **below streamer webcam**.
- Do not enable `Shutdown source when not visible` or `Refresh browser source when scene becomes active` before testing their effect on reconnecting.

**IMPORTANT:** The generated local `127.0.0.1` URL is accessible **only from the same machine**. This phase tests local Studio + Output in different tabs. A streamer on another machine cannot use this URL yet. Remote hosting, HTTPS, and Cloudflare Durable Objects are planned for the next implementation milestone, not silently assumed to be completed.

## Operator walkthrough

1. **PREVIEW LAYERS** checkboxes turn either Scoreboard or Player Intro ON/OFF **only in Preview**. Both can be active.
2. Enter match data in the **Properties** panel. Live Program does not change yet.
3. Press **Test Intro** in Preview to see its entrance animation without transmitting to OBS. If Intro was off, the button enables it in draft; when on, it replays its entrance.
4. Press **TAKE PREVIEW → LIVE** to apply the entire draft (data + layer visibility) atomically.
5. Use **LIVE QUICK CUES** to turn either layer ON/OFF directly, and **Quick score control** to increase/decrease each team's series wins immediately.
6. **EMERGENCY CLEAR** hides both layers but leaves match data intact.
7. **Sync from live** discards unpublished draft changes and copies the latest state into Preview.

### Local security
The server generates a random admin password and read-only output token at first start and stores them in `.runtime/secrets.json`. Do not commit or share that file. Optional overrides:

```bash
FC_ADMIN_PASSWORD="your-strong-password" FC_OUTPUT_TOKEN="your-long-read-token" npm start
```

For Windows PowerShell:

```powershell
$env:FC_ADMIN_PASSWORD="your-strong-password"
$env:FC_OUTPUT_TOKEN="your-long-read-token"
npm start
```

The admin uses an HttpOnly, SameSite cookie. OBS can open only the read-only output URL. WebSocket write messages from the output role are ignored. This is a **local prototype** security boundary, not an audited internet production setup; the built-in dependency-free WebSocket server should be replaced by Cloudflare Durable Objects or a mature WebSocket package before internet exposure.

### Portraits
This technical prototype ships with two clearly generic SVG stand-ins, not real players. For your own portraits, place transparent images in `public/assets/players/` and set the URLs in the Studio data panel, e.g. `/assets/players/player-a.webp`. The server also accepts HTTPS image URLs. Asset upload through the UI, preloading and a real-player design system are future work.

## Project structure

```text
client/
  contracts.ts        # Program/Match/Layer types, shared renderer state
  stage.ts            # One 1920×1080 stage, used by Preview/Program/OBS output
  studio.ts           # Operator UI, draft/take/quick cues, live status
  output.ts           # Read-only OBS consumer
  realtime.ts         # Browser WebSocket reconnect client
public/
  studio.html          # Studio entry
  output.html          # Fully transparent Browser Source entry
  assets/stage.css     # Scoreboard + Intro design/enter-exit motion
  assets/studio.css    # Operator Studio design
  build/*.js           # Precompiled ES modules; tracked for zero-install running
server/
  index.mjs            # Local HTTP + auth + WS broadcast
  websocket.mjs        # Small local-only RFC6455 parser (no npm deps)
  state.mjs            # Validated state transitions + persistence
  default-program.json
.runtime/              # Created on run: password, token, persistent live state
```

### Rebuild when editing TypeScript

```bash
npm install
npm run build
npm start
```

Since the included `public/build/*.js` files are committed in the ZIP, normal local use does **not** require npm install. The renderer and Studio intentionally do not include React, GSAP, Vite, or any runtime framework *yet*. This **Milestone A spike** validates the underlying runtime/transport with minimal overhead. We will decide whether React + Vite + GSAP genuinely help once the graphics are being polished for Milestone B; the architecture does not depend on them.

## Test

```bash
npm test
```

Functional integration checks also exercised two real WebSocket clients (admin + read-only output) with intro show/hide, live score updates, clear-all and persistent revisions. Browser rendering in OBS itself **has not yet been validated on the streamer's computer**.

## Next engineering steps
1. Replace generic portraits with actual tournament cutouts/logos and finish final broadcast look based on the two screenshots.
2. Decide exactly which score is on the scoreboard: BO series wins only, or also game goals; current layout shows series wins and stores game goals separately.
3. Add deployable Cloudflare Workers + Durable Objects transport and a real remote HTTPS output URL.
4. Stress/reconnect testing in OBS on actual streamer hardware; optimize and preload image assets.
5. After this milestone: presets/sequence editor or drag positioning only if necessary.

## Design rules honored
- ONE output URL, but MULTIPLE independent graphic layers.
- Each layer has in/out transitions and supports immediate reversal on fast toggles (CSS transitions).
- Preview state is never sent to OBS until TAKE.
- Live controls can bypass Preview intentionally.
- Server sends only JSON state/events, never streams video or renders animation frames.
- Program monitor is a **local graphics replica**, not captured streamer gameplay or real OBS pixels.
