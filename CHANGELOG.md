> 🇺🇸 English | [🇧🇷 Português (Brasil)](./CHANGELOG.pt-BR.md)

# Changelog

All notable changes to this project are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Since 1.1.0, versions follow [SemVer](https://semver.org/); older entries are dated milestones.

## 1.2.0 · 2026-11-08 · What's new

Commits: [`v1.1.0...v1.2.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.1.0...v1.2.0).

### Added
- **What's new:** a page in the menu with the installed version's changelog, newest first (up to 10 entries). A **New** badge shows in the menu when the office version differs from the last one seen in this browser, and goes away when you open the page. The data comes from `GET /api/novidades` (signed in), which reads `CHANGELOG.pt-BR.md` from disk, with no call to agentes.chat. The page shows the Portuguese changelog. See [Security](./README.md#security).

### Changed
- `CHANGELOG.pt-BR.md` now ships in the Docker image and with `instalar.sh`, next to the code: it is what the What's new page shows. The file-list test checks both paths.

### Security
- Items reach the browser as raw inline markdown (bold, code and links) and are drawn only with `textContent`. Links only point to this repository (relative ones become its GitHub address, and no path with `..` gets through); any other link becomes plain text, on the server and again in the browser.
- The changelog stays in memory until the file changes, even when it is unreadable. If it is missing, unreadable or larger than 1 MB, the list is empty, with one log line.

## 1.1.0 · 2026-11-08 · Connect, Settings, TV mode, newspaper and phone alerts

Release [`v1.1.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.1.0). Commits: [`v2026.11.06...v1.1.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2026.11.06...v1.1.0).

### Added
- **Connect from the screen:** a button on the connection bar, OAuth error pages that say why, and `conexao` in `/api/estado` (`carregando`, `conectado`, `sem_conexao`, `recusada`, `pausa` or `falha`). When you come back from the authorization, the first read happens right away. See [Connect to agentes.chat](./README.md#connect-to-agenteschat).
- **First-run assistant**, replacing the welcome screen, which resumes at Connect after a refused authorization.
- **Settings from the screen:** the weather city (search by name, through the server; changing it needs no restart), holidays (turn off any of the 13 built-in ones and create up to 24 of your own) and each agent's team and appearance, in `dados/clima.json`, `dados/festas.json` and `dados/equipe.json`. **Voltar ao times.json** removes the override.
- **Sign out of all devices:** with the password again, ends every session and turns off phone alerts on every device.
- **Docker and Coolify:** `Dockerfile`, `.dockerignore` (an allowlist) and a `docker-compose.yml` with no published ports, plus the new `ESCRITORIO_BIND` variable. See [Docker and Coolify](./README.md#docker-and-coolify).
- **TV mode** (`/?tv=1` or a button): full screen, screen kept on and a camera director that shows requests, fights and strikes. The TV reloads by itself when the configuration changes (`config_v` in `/api/estado`). See [TV mode](./README.md#tv-mode).
- **Installable app (PWA):** a manifest, icons and a cache-free `sw.js`, there only for installing and for phone alerts. See [Installable app](./README.md#installable-app-pwa).
- **Visitors:** whoever else has the office open shows up as an anonymous visitor, with "N people watching" and a **Show me in the office** option. The TV does not show up. See [Visitors](./README.md#visitors).
- **Weekly newspaper:** a page with this week's and last week's notes (the week's top agent, who asked for your approval the most, ring champion, rainy week), built in the browser from `GET /api/jornal`, which keeps only ids and numbers in `dados/jornal.json`. See [Newspaper](./README.md#newspaper).
- **Daily time-lapse:** a frame of the building every 2 minutes of the work hours, in the browser only (IndexedDB), and a ~30 s MP4 or WebM video to download, with a privacy notice first. See [Time-lapse](./README.md#time-lapse).
- **Phone alerts:** native push without content, signed with VAPID (`vapid.py`, ES256 in pure Python), when an agent asks for your approval or an answer. **Avisar no celular** is on the Approvals page. It works only with `ESCRITORIO_BASE` on https; on iPhone, only with the app on the home screen (iOS 16.4+). See [Phone alerts](./README.md#phone-alerts) and [Security](./README.md#security).
- For development: `ferramentas/agentes_falso.py` (a fake agentes.chat, on `127.0.0.1` only) and, in the preview, `--conexao`, `--visitantes`, `--jornal` and `--push` (with a fake local push service).

### Changed
- HTTP 402 and 403 on the read become `recusada`, like 401, instead of a network failure. While the refusal goes on, the read waits from 30 s up to 5 min.
- Signing in from an address other than `ESCRITORIO_BASE` shows the right address on the sign-in screen.
- Switching the agentes.chat account restarts the event list, the day's resolved requests, the newspaper and the last alert: nothing from the previous account stays on screen.
- **When updating:** `ESCRITORIO_BASE` must be the origin only (no path or trailing slash, lowercase host). Otherwise, the service does not start and says why.

### Security
- Every new write (weather, holidays, teams, Sign out of all devices and push) follows the construction mode rules: `Origin` equal to the address, a session, JSON only, a body cap, all-or-nothing validation (no `NaN`, `Infinity` or `true` as a number) and an atomic write under a lock.
- The CSP did not change: the browser still talks only to its own server. The city search and push go out through the server, to fixed hosts, without following redirects.
- The `error_description` and the body of agentes.chat responses never reach the screen, and the log keeps only the error code.
- Phone alerts are empty. The push services (Google, Mozilla, Apple, Microsoft) receive the empty message, the time and the VAPID signature: a JWT with the office's address (`ESCRITORIO_BASE`) as the contact (`sub`) and the public key. None of this goes to agentes.chat.
- Visitors come from memory only: an anonymous id (an HMAC with a key drawn at each start), with nothing on disk or in the log.
- With `ESCRITORIO_BIND=0.0.0.0`, `ESCRITORIO_BASE` is required. The image runs as its own user with no shell, and the compose file runs it read-only. The README now covers what changes with a [public address](./README.md#public-address).

### Fixed
- `instalar.sh` installs and compiles every module the service imports: since Settings, the service it installed failed to start without `ajustes.py`. It also copies the app manifest. A test checks the list against the imports.
- The avatar's eyes and accessory came out empty for some handles: the hash now uses `>>>`.

## 2026-11-06 · Construction mode v1

Release [`v2026.11.06`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v2026.11.06), with the launch video (narrated in Brazilian Portuguese, with subtitles). Commits [`4860c88`](https://github.com/HelbertMoura/escritorio-agentes/commit/4860c88) and [`26192a6`](https://github.com/HelbertMoura/escritorio-agentes/commit/26192a6).

### Added
- **Construction mode** (`construir.html`, opened from **Customize**): paint the wall and the floor of each room; move, mirror, remove and add furniture from a catalog of 53 decorations (new pieces are decoration only: nobody sits on them). See [Construction mode](./README.md#construction-mode).
- Undo and redo (up to 100 steps), **Discard**, **Back to automatic** (with a confirmation dialog) and **Save**, which is blocked while a seat has no way in and marks that seat on the map.
- Everything works without dragging and from the keyboard: Tab and Enter pick a piece, the arrows move it (8 px; Shift: 1 px), `E` mirrors and `Delete` removes. Changes are announced to screen readers.
- The plan is saved on the server, in `dados/planta.json`, through `POST /api/planta`, and the same plan reaches every screen on reload. It is applied on top of the automatic building: with an empty plan, the building is identical to before.
- `construir.html?demo=1`: a demo of the editor with its own example, where nothing is saved.
- Tests in `test_planta.py` and checks for the new route in `ferramentas/checar_seguranca.py`; `ferramentas/checar_planta_mapa.mjs` compares the building with and without a plan.

### Changed
- The ping-pong table sits 12 px higher, so the player at the bottom has a way through. This changes the automatic building of every office, even without a plan.

### Security
- `POST /api/planta`: `Origin` must match the server address (no fallback to the `Referer`), a session is required, JSON only (415 otherwise), a body of up to 64 KB, all-or-nothing validation (the same on read and on save), and the current `rev` (409 when another screen saved first). Writing happens under a lock, with the atomic 0600 write; the log keeps counts, never the content.
- An unreadable or invalid `planta.json` falls back to the automatic building, with one line in the log; a bad plan never takes the page down.
- Every `POST` reads its body (up to 128 KB) before answering, so a refusal reaches the client instead of a connection reset; each route keeps its own size cap.
- The ring, the scoreboard board, the logo panel and the signs cannot be edited, and nothing moved or added may cover them.

## 2026-11-06 · Social life, part 2: strike, complaints, gossip and deliveries

Commit [`5dbdc73`](https://github.com/HelbertMoura/escritorio-agentes/commit/5dbdc73).

### Added
- **Complaints and suggestions** in speech bubbles, and **gossip** by the water cooler ("Psiu…"), with no name in the bubble. They change friendships.
- **Strike** in the lounge, at most one a day: free agents sit on the floor in front of the ring holding cardboard signs, with a notice above the map and the **Atender o pedido** ("meet the demand") button. Clicking a sign does the same.
- **Deliveries**, one per demand: the pizza rider arrives by motorbike, a courier brings coffee, a cake with a candle, a new beanbag, a router, pillows, the air conditioning at 23 or a "Sexta livre aprovada!" banner with a little party. The same on every screen, drawn in pixel art and with their own sounds.
- `POST /api/social/greve/atender`, with the same rules as the other social routes.
- Tests T-G1 to T-G5 and accessibility for the strike notice.

### Changed
- **Serious mode** also pauses strikes and deliveries. Agents who are working or waiting for you never leave their desk.

## 2026-11-06 · Social life, part 1: friendships, the Ring and the weekly scoreboard

Commit [`81ba7b5`](https://github.com/HelbertMoura/escritorio-agentes/commit/81ba7b5).

### Added
- **Friendships and rivalries** for each pair of agents, decided by the server (`social.py`) and the same on every screen.
- **The Ring** in the lounge: automatic fights and **Send to the ring** from an agent's card, with a gong, a crowd, a cartoon dust cloud, sounds, the winner's banner and making up later. Only free agents take part.
- **Weekly scoreboard** (Monday to Sunday, Brasília time), with the top 3 on a board on the ring's wall, the full ranking when you click it and last week's champion. Saved in `dados/placar.json`.
- **Serious mode** in **Customize**, which pauses the whole social life.

## 2026-11-05 · Conversations, reply mode and opening hours

Commits [`0d13e25`](https://github.com/HelbertMoura/escritorio-agentes/commit/0d13e25) and [`cdec3b7`](https://github.com/HelbertMoura/escritorio-agentes/commit/cdec3b7).

### Added
- **Conversations** page (`"conversas": "ler"`, off by default): today's list (waiting for you, working, finished today) and each task's conversation read from its thread, within the daily agentes.chat budget.
- Optional **reply mode** (`"conversas": "responder"`, off by default): send messages in the day's direct conversations, with the "read and send tasks" scope, the password asked once, a 1-hour mode (8-hour cap) per browser, limits, a log without content and protection against duplicate sends.
- **Opening hours** in **Customize**, with a banner and a sign on the map, including shifts past midnight.
- Animated demo at the top of the READMEs, with a still image for "reduce motion".

### Changed
- The full-screen map now starts below the top banner, so the controls are not covered.
- Tests isolated from local files; documentation screenshots retaken.

### Removed
- The 3D model view and three.js.

## 2026-11-04 · First public release

Commit [`54c329b`](https://github.com/HelbertMoura/escritorio-agentes/commit/54c329b).

### Added
- Live pixel-art office for agentes.chat agents: a procedural map from 1 to 20 teams, agent life and sounds, approvals with the day's history, brand customization, simulation of date, time and weather, a 3D model view, photo mode and demo mode.
- Python server (standard library only), reachable only on the tailnet, with a one-time first-access code and failing closed when the user file cannot be read.
- License AGPL-3.0-or-later.
