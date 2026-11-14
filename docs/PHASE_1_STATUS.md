# Phase 1 — Development checkpoint (Milestone A)

## Delivered
- New standalone repository (not derived from BLTC).
- Single transparent OBS Output route, locked to read-only URL token.
- Scoreboard and Intro as independent, simultaneous layers.
- Local Preview + live Program replica rendered from the same Stage module.
- CSS entry/exit transitions, quick toggle reversal.
- Manual Quick Live score (series wins), draft data editing, TAKE w/expected revision, Sync, Emergency Clear.
- Reconnecting WS client and persisted canonical state. Server command validation, idempotency, renderer ACK.
- Local login with HttpOnly cookie and long random OBS token.

## Automated checks completed
- TypeScript typecheck: PASSED.
- Node tests: 5/5 PASSED.
- Real websocket admin + read-only output integration: PASSED for intro toggle, quick score, clear, renderer ACK, reconnect snapshot, read-only rejection.

## Not yet verified
- Chromium/OBS pixel-perfect rendering / 60 fps on a real user's machine; headless browser navigation was blocked by the current execution environment.
- Deployed remote HTTPS connectivity or cloud auth.
- Real tournament graphics/assets, external portrait preload, image-based transitions.
- Operator UI subjective acceptance / final art direction.

## Architecture note
Although the original kickoff suggested Vite+React+GSAP, the first technical spike intentionally avoids UI runtime packages. Client code is typed TypeScript compiled into tiny browser-native ES modules. This proves the one-URL/dual-layer/Preview-vs-Live mechanics at the lightest possible runtime cost. If advanced UI development warrants it, Vite+React can be adopted without changing the program message/state contract.

## Next
1. Verify rendering in actual browser/OBS on the user's PC.
2. Agree scoreboard layout and Intro art/asset format using reference screenshots.
3. Implement worker deployment (Cloudflare Durable Objects) with scoped operator auth and read-only renderer token.
4. Performance measure 30/60fps, p95 operator-to-renderer-start latency and reconnect behavior.
