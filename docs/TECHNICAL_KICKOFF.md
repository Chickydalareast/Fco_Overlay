# FC ONLINE — BROADCAST OVERLAY STUDIO
## Technical Kickoff — Phase 1 | 13/11/2026

**Trạng thái:** architecture proposal, chưa triển khai code.  
**Nguồn tham chiếu:** 2 screenshots FVPL người dùng cung cấp, OBS Browser Source, Cloudflare Workers/Durable Objects, Vite, GSAP, MDN.

## 1. Product definition
Xây một project **mới hoàn toàn**, độc lập với BLTC/AOV. Một operator dùng Studio trên máy riêng để điều khiển các overlay trên livestream FC Online của streamer. Streamer thêm **một Browser Source URL duy nhất** vào OBS. Browser Source là một **transparent stage** được đồng bộ realtime, có thể render nhiều layer độc lập đồng thời.

**Không phải:** OBS remote control, video mixer, scene switcher, live gameplay capture, hoặc upgrade BLTC/AOV.

## 2. Phase 1 scope
### 2.1 Scoreboard layer
- Hiển thị thông tin trận: team/player A-B, score, round, match/game index, BO3/BO5/BO7 nếu cần.
- Thiết kế data model tách **series score** (số game thắng) khỏi **in-game score** (bàn thắng trong game). Chưa yêu cầu luôn hiển thị cả hai: sẽ lựa chọn theo mockup thiết kế.
- Cho phép operator chỉnh dữ liệu; tăng/giảm giá trị; kiểm tra tránh điểm âm hoặc vượt BO.
- `Show` → animation in; `Hide` → animation out. Khi đang live, score update được animate nhẹ, không reset cả scoreboard.

### 2.2 Player Introduction layer
- Hai ảnh chân dung tuyển thủ đã tách nền, hai team/participant names, team logos; VS, match index/series nếu phù hợp.
- Animation in và animation out có chủ đích; đứng yên khi đã vào xong cho tới khi operator Hide, hoặc auto-hide khi tùy chọn được bật.
- Layer độc lập với Scoreboard: hai layer có thể hiện cùng lúc.
- Preload portrait images/fonts/logos để tránh tải ảnh khi bấm live.

### 2.3 Operator Studio
- Stage Preview 16:9, Stage Program monitor (render replica của state đang phát), Layer Controls (hai layer), Data Editor (score/team/player), Animation Test (preview in/out), TAKE/APPLY khi thay đổi có staging.
- Có thao tác **Direct Live** cho bật/tắt layer, tăng/giảm score; có **Prepare / Preview / Take** cho thay đổi lớn như intro tuyển thủ/trận tiếp theo.
- Program monitor là mô phỏng graphics mà Browser Source đang render, **không** phải video output thật của OBS; không thể thấy gameplay/camera thực trừ khi đưa vào một feed preview khác.
- Visible/hidden, connection state, renderer ACK, emergency clear.

### 2.4 Output
- URL duy nhất dạng `/output/{session}` với overlay access token chỉ đọc.
- Stage alpha transparent, fixed-design 1920 × 1080, layer absolute-positioned và phối hợp được.
- Không có admin toolbar/buttons/scrollbars/background trong output.
- OBS source đặt giữa game capture và camera streamer. Camera ở trên sẽ che phần graphics bên dưới; nên quản lý safe-zone cố định.

## 3. Interaction model

Layer tách biệt với Scene. Phase 1 không cần OBS-like scene collection phức tạp; mỗi layer có ID, enabled/desiredVisible, zIndex, props, animation preset. `Program` là **tập hợp nhiều layer**, không phải một scene độc quyền.

| Scoreboard | Intro | Output |
|:--:|:--:|---|
| OFF | OFF | Trong suốt |
| ON | OFF | Scoreboard |
| OFF | ON | Intro |
| ON | ON | Cả hai |

### 3.1 4-state motion machine mỗi layer
`hidden → entering → visible → exiting → hidden`.

- Bật: `hidden/exiting → entering → visible`.
- Tắt: `visible/entering → exiting → hidden`.
- Toggle nhanh khi animation chưa kết thúc: reverse/interrupt mượt từ trạng thái hiện tại, không nhảy cắt.
- `desiredVisible` nằm trong Program State trên server; `entering/exiting` thuộc **renderer-local state**. Không liên tục đồng bộ từng frame animation lên server.
- Khi mới kết nối hoặc refresh, đọc snapshot và **hiện trạng thái cuối** tương ứng, không phát lại intro cũ; một lệnh live mới mới kích hoạt chuyển động.

### 3.2 Preview vs Live
- Editor thao tác trên `draft` riêng. Chạy preview **không có realtime command tới output**.
- `TAKE` gửi một chương trình thay đổi gồm `patch data + visibility` và có transition cho các layer đổi trạng thái.
- Quick controls (`SHOW/HIDE`, score +1/-1) gửi thẳng tới live program với confirmation tùy mức rủi ro.
- Khi thay đổi dữ liệu Intro trong khi intro đang live, Phase 1 mặc định yêu cầu staging hoặc TAKE để tránh nội dung nhảy trên sóng.

## 4. Architectural choice

### Recommended primary stack (budget-first)
| Concern | Decision | Why |
|---|---|---|
| Language | TypeScript end-to-end | Shared contracts, quick validation |
| UI / render | Vite + React SPA, two distinct entry bundles | Fast dev, no SSR or always-on Node for UI |
| Graphics | HTML/CSS/SVG + static WebP/PNG | Native transparency, crisp text, cheap rendering |
| Animations | CSS/WAAPI for small score transitions, GSAP timeline for Intro | Timeline sequence, reversal, control; import only necessary functions |
| Live transport | Native WebSocket | Bi-directional realtime with minimal JSON messages |
| Backend (lowest ops) | Cloudflare Worker + SQLite-backed Durable Object per session | One actor serializes writes, persists program, broadcasts to clients; no dedicated VPS |
| Hosting UI | Cloudflare Workers Static Assets / Vite plugin | Static content served/cached without always-on server |
| State persistence | Durable Object SQLite | Persist score, visibility, roster, version |
| Validation | Zod or lean manual validators | Prevent invalid commands |
| Admin auth | Login/session credential, server-verified; OBS read-only scoped token | No accidental/admin write access through OBS URL |

**Alternative if prioritizing familiar infrastructure:** Vite SPA + Fastify `@fastify/websocket` on an always-on low-cost VPS + SQLite. No need PostgreSQL/Redis for one active session. This is simpler to self-host but requires VPS/process/restart management and recurring hosting fee. Keep transport commands domain-neutral so either backend is possible. Do not implement both in Phase 1.

**Why not Supabase Free first:** workable, but free inactive projects may pause after ~7 days of low database activity; undesirable before an infrequently held tournament. Supabase is optional rather than necessary for this small scope.

### Server responsibilities
Authorize, validate, order commands; store canonical Program State; broadcast compact JSON event; return snapshots on connect; handle reconnect/renderer ACK. **Do not server-render frames/video, composite photos or stream imagery.**

### Client responsibilities
Preload/cache static assets; render independent layer roots; run enter/exit transitions locally; listen to authoritative state updates; maintain an observer status/ACK; never allow output URL to mutate server state.

## 5. Runtime flow
```text
Operator Studio (admin)               Single OBS Browser Source (read-only)
    Preview local                              /output/:session
    Score + Intro control                      transparent 1920x1080
             \                                     /
              \     WebSocket (JSON events)      /
               --> Session Actor / Durable Object
                     Program state + revision
                     SQLite persistence
```

**Apply visibility command:** Studio → server validation → atomic program update/version++ → broadcast `{type:'program.patch',...}` → OBS renderer animates → ACK. ACK means renderer handled command, **not** verified actual livestream pixels.

## 6. State & message contract (example, not implementation code)
```json
{
  "sessionId": "fvpl-demo",
  "revision": 42,
  "match": {
    "stage": "FINAL STAGE",
    "bestOf": 5,
    "gameNumber": 2,
    "teamA": { "name": "FFB", "player": "FFBxJaden", "seriesWins": 1, "gameGoals": 0 },
    "teamB": { "name": "NK", "player": "NKxLHAT", "seriesWins": 0, "gameGoals": 0 }
  },
  "layers": {
    "scoreboard": { "visible": true, "zIndex": 10 },
    "playerIntro": { "visible": false, "zIndex": 20 }
  }
}
```

Command examples:
```json
{ "id": "cmd-103", "type": "layer.setVisible", "layerId": "playerIntro", "visible": true }
{ "id": "cmd-104", "type": "match.setScore", "team": "A", "scoreType": "seriesWins", "value": 2 }
{ "id": "cmd-105", "type": "program.take", "expectedRevision": 42, "patch": { "layers": { "playerIntro": { "visible": false } } } }
```

Responses should include revision + command ID and optional transition mode. The server rejects stale expected revisions on destructive full-program TAKE, while simple targeted live patches can be serialized without overwriting other layers.

## 7. Studio wireframe / essential controls
```text
┌──────────────────────────────────────────────────────────────────────────┐
│ FC Overlay Studio | Session: FVPL | OBS Renderer: CONNECTED | REV: 42   │
├─────────────────────────┬─────────────────────────┬──────────────────────┤
│ PREVIEW                 │ PROGRAM (output replica)│ LAYER CONTROLS       │
│ 16:9                    │ 16:9                    │ [✓] Scoreboard       │
│                         │                         │ [ ] Player Intro     │
│ [TEST IN] [TEST OUT]    │ [OBS renderer ACK ✓]    │ [LIVE ON/OFF]        │
├─────────────────────────┴─────────────────────────┴──────────────────────┤
│ Score: FFB [ - 1 + ]    NK [ - 0 + ]  |  BO5 | Game 2               │
│ Player Intro: [Portrait A] [Portrait B] [Position preset] [Preview]    │
│                                     [TAKE PREVIEW → LIVE] [CLEAR ALL]    │
└──────────────────────────────────────────────────────────────────────────┘
```

No draggable canvas/layout timeline yet. Admin should have quick layer toggles, data panel, preview/replay and TAKE. Advanced position editors and sequences are future phase.

## 8. Graphic layout notes from reference screenshots
- Screenshot 1: player photos occupy center-left and center-right; large bottom central matchup bars; overlay intentionally covers substantial gameplay. Use a composed Intro layer made of sub-elements, not separate sockets for each portrait.
- Screenshot 2: scoreboard aligns top-left and occupies a relatively small zone; series score and game score are distinct visual tiers. Keep its area independent of centered Player Intro; do not assume both have to be mutually exclusive.
- OBS user has stated Browser Source will sit **below streamer camera**. Neither player intro nor scoreboard can draw over a camera source positioned above it. Offer safe-zone overlay in Studio preview and fixed layout presets; do not promise live OBS video preview.

## 9. Performance requirements (proposed targets, verify with real OBS)
- 1920×1080 alpha overlay, 60 fps target on representative streamer hardware; 30 fps fallback if graphics cause significant load.
- Test responsiveness from operator click to OBS animation start, aiming for **< 500 ms p95** on typical VN network, not a guaranteed SLA until measured.
- Intro portrait assets compressed (e.g., WebP with alpha when supported), avoid shipping unoptimized 4K PNGs. Target combined critical asset weight around **3 MB or less** initially; if quality requires more, measure/cache rather than force excessive compression.
- Keep renderer entry minimal: no admin UI, no chart/editor libraries, no data tables, no React devtools. Split build chunks by Studio vs Output.
- Animate `transform` and `opacity` primarily; avoid per-frame `left/top/width/height`, giant blur, expensive filters and huge shadows.
- No polling at 30/60 FPS. One WebSocket carries sparse control events; browser renders frames itself.
- Use asset preload, local static caching, font preloading, cleanup/kill active GSAP timelines on unmount, no unnecessary React rerender while animation runs.
- Add `Performance` benchmark and OBS Stats FPS/GPU check before live sign-off. No claim that cheap server alone guarantees a smooth GPU render.

## 10. Resilience & security
- Persist canonical Program State; a reconnect/refresh loads snapshot and settles to end state without replaying old one-shot cues.
- Auto-reconnect with backoff; operator UI clearly indicates whether OBS renderer is connected; buttons report server acceptance vs OBS ACK separately.
- Events: command ID for idempotency, monotonic revision for ordering; basic rate limit, payload validation; optional command log/undo for scores.
- Two permission profiles: admin can write; output URL can read. Long random tokens, revocation/rotation. Never expose admin secret in frontend bundle or query string.
- Do not expose OBS websocket or streaming keys. Keep source URL narrowly scoped.
- Test hide/show race, connection drop during enter, double clicks, process reload, stale writes and streamer's OBS scene switching.
- OBS baseline: Browser Source width 1920 height 1080; match project FPS, `Shutdown source when not visible` OFF, `Refresh browser source when scene becomes active` OFF unless tests require otherwise; verify on streamer's OS/GPU.

## 11. Key decisions (ADR)
- **ADR-001:** One OBS URL; multiple independent graphics layers in a single alpha stage.
- **ADR-002:** Admin Preview/Program state separated; Preview is never broadcast.
- **ADR-003:** Layer FSM owns animation transitions locally; server stores desired visible state, not animation frame data.
- **ADR-004:** Light static Vite SPA, no SSR/Next.js requirement.
- **ADR-005:** Realtime WebSocket, authoritative state with version & snapshot.
- **ADR-006:** Worker + Durable Object (SQLite) preferred for low-ops deployment; Fastify+WS if provider independence/developer familiarity wins.
- **ADR-007:** GSAP only for staged/complex animation; native CSS or WAAPI for simple states.
- **ADR-008:** No visual timeline editor, OBS remote control, automatic score OCR, or tournament management in Phase 1.

## 12. Acceptance tests
| Test | Expected |
|---|---|
| Scoreboard ON/Intro OFF | Only scoreboard shown |
| Scoreboard OFF/Intro ON | Only intro shown |
| Scoreboard ON/Intro ON | Both visible and correctly stacked |
| Both OFF | Fully transparent |
| Intro ON then OFF | Enter and exit play fully and smoothly |
| Rapid ON/OFF/ON | No stuck or frozen layer |
| Change Preview data | Streamer output unchanged |
| TAKE staged data | Program commits data and correct transition |
| Score updated | Score digit changes without restarting unrelated intro |
| Refresh output tab / OBS source | Snapshot restored without replaying intro |
| Disconnect / reconnect | Recovered state matches admin; no stale command replay |
| OBS source behind camera | Graphics respect documented camera occlusion |
| 30–60 minute soak | No accumulating timers, memory leak, WebSocket flooding |
| Access output URL | Read-only; cannot update match data |

## 13. Build sequence
**Milestone A — Technical Spike:** stage + two colored placeholders, 4 layer combos, WS two clients, reconnect, preview/live separation, measure OBS FPS. **Exit:** correct dual-layer behavior.

**Milestone B — First functional MVP:** score editor, intro player data, real static assets, in/out GSAP animations, apply/take, live status. **Exit:** operator can run a sample match without editing files or OBS sources.

**Milestone C — Reliability & Polish:** validate permissions, restart/reconnect/rapid toggle, caching, performance profiling, safe zones, final OBS rehearsal. **Exit:** full acceptance suite passes on streamer's actual setup.

## 14. Open design decisions (not blockers to Technical Spike)
- Scoreboard: series score only vs in-game score plus series score; final visual zone/sizing.
- Player intro: full-body/half-body portraits, sponsor logo placement; whether to auto-hide by default.
- Streamer camera location and output resolution/FPS.
- Team/player asset update flow: bundled build assets for fixed tournament vs operator-uploaded assets after deployment.
- Whether scoreboard remains during full-screen Intro (engine supports yes; default preset can choose either).

## 15. Official research sources (verified November 2026)
- OBS Browser Source configuration: https://obsproject.com/kb/browser-source
- OBS browser rendering details: https://github.com/obsproject/obs-browser/blob/master/README.md
- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Durable Objects SQLite: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Workers pricing/free usage: https://developers.cloudflare.com/workers/platform/pricing/
- MDN animation performance: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate
- GSAP CSS transforms: https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/
- Vite performance guide: https://vite.dev/guide/performance
- Fastify WebSocket plugin (alternative): https://github.com/fastify/fastify-websocket
- Supabase Free project pausing (why not preferred): https://supabase.com/kb/faqs/platform/free-project-pausing

---
**Kickoff outcome:** Product scope, architecture and acceptance tests are specified. Next engineering action: implement Milestone A technical spike, not full visual editor or hosting deployment.
