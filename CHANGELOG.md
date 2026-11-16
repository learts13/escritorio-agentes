> 🇺🇸 English | [🇧🇷 Português (Brasil)](./CHANGELOG.pt-BR.md)

# Changelog

All notable changes to this project are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Since 1.1.0, versions follow [SemVer](https://semver.org/); older entries are dated milestones.

## 1.6.0 · 2026-11-16 · The team's office

Release [`v1.6.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.6.0). Commits: [`v1.5.2...v1.6.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.2...v1.6.0).

### Added
- **Each floor is a company:** each floor has its own brand, logo, office hours, teams, floor plan, members and invites, and whoever runs the company manages only its own floor. There are four profiles: building admin, company admin, member and building guest (who only enters the lobby).
- **Lobby:** the ground floor can become a lobby (saguão) with no agents, open to everyone in the building, and the `AGENTES_ORG` company moves up to a floor of its own, like the others. The switch is a command, never automatic (see **Changed** and [Lobby](./README.md#lobby-a-ground-floor-for-every-company)).
- **Team conversations:** general and per-room chat, direct messages (DM), `@login` mentions, reactions, attachments up to 25 MB (ZIP included; 5 GB per company) and search across the general chat, the rooms and your own DMs, with 1 year of history. See [Team](./README.md#team).
- **Board, status and floor list:** each room has a board on the wall (up to 10 notes). Each person picks a status (available, busy, in a meeting, away) with a short note, shown on their character. The floor list shows who is here and where, with **Go to**, **Wave**, **Knock on the door** and **Direct message**. Busy people do not get waves.
- **Personal phone alerts:** mentions, DMs and meetings alert only the right account, with the start of the message. Tapping the alert with the office open switches floors and opens the conversation.
- **While you were away:** coming back to a floor after more than 1 hour shows at the top what the agents did (finished tasks and waits for approval or an answer, with how long they took), and each item takes you to the agent. The agent card shows today's timeline.
- **Meetings:** each room can have a fixed Meet, Zoom, Jitsi, Teams or Whereby link, pasted by the company admin (https only and no password in the address). The floor calendar books meetings with title, room, time and guests, alerts 5 minutes before and downloads the `.ics` for your own calendar. Voice and video stay with the link's service.
- **All-hands and "in a meeting":** the company admin calls the team to a room; everyone on the floor gets the alert, and the map walks their character there. Anyone in the room of a meeting in progress who has not set a status shows as "in a meeting", and the door gets the sign.
- **Presentation mode:** for showing the screen to a client or posting a screenshot. The camera bar button or `Alt+Shift+P` replaces names with "Agente 1" and "Pessoa 2" and hides bubbles, tasks, conversations, the board, status notes, meetings and room links. It is screen-only, not access control. See [Presentation mode](./README.md#presentation-mode).
- **New variables:** `ESCRITORIO_JITSI=<host>` accepts your own Jitsi in room links (one exact host, on top of the closed list), and `ESCRITORIO_PISO_DISCO_MB=<MB>` sets how much free disk attachments never use (without it, the larger of 2 GB and 10% of the volume). See [Install](./README.md#install).

### Changed
- **Privacy: team conversations are now kept on disk.** With at least 1 account, the general and room chat, DMs, the board, status, attachments and the calendar are kept for **1 year** (the company can lower it to 90 or 30 days), in one file per company. Before 1.6, none of this went to disk. With no accounts, the chat stays in memory only, as before.
- **Room chat is kept and read by the floor:** it no longer vanishes after 10 minutes, and everyone on the floor reads what was said, including before they arrived.
- **DMs can be read by the company's administration**, through an audit screen. Each read is logged (without the text), and both people in the conversation see the date. Every DM says so at the top, and people confirm with **Entendi** (got it) before their first one.
- **Phone alerts show the start of the message** (up to 60 characters) for mentions and DMs, and it may appear on the lock screen. The push service still receives an empty message: the start comes from the office when the app wakes up. Turn it off in **My profile** ("Mostrar o começo") or in the phone's notification settings.
- **Lobby migration, explicit:** only through the `escritorio.py saguao` command, with the service stopped and run as the service user (the owner of the data folder; as any other user it refuses). Back up first. It is all or nothing, with a journal: if it stops halfway, the service will not start until the same command finishes. `saguao --desfazer` restores the previous ground floor as long as nobody has used the new mode; after that, going back is through the backup. Without running the migration, the office keeps working as before.
- **Timeline on disk:** the agent id, the state and the time of each change are kept for 14 days in `dados/linha/` (up to 5,000 lines per day), with no task label or conversation. The rest of the transition log stays in memory only.

### Security
- **Attachments checked on the server:** the type comes from the content, photos lose their EXIF (including location) and ZIP files are checked by their metadata only, never opened. Uploads have a deadline and per-account and server-wide limits, plus a free-disk floor. There is no antivirus.
- **Each profile only on its own floor:** a floor that does not exist and a floor without access get the same answer. The building admin reads the general chat, rooms, board and attachments of every company without writing to them, and does not read DMs. Moderating and changing retention belong to each company's admin. Mentions and meeting guests only match accounts on the same floor.
- **The database is not encrypted:** whoever runs the server can read everything. Where each piece of data lives, who reads it and for how long is in [where each piece of data goes](./docs/visitas-privadas-plano.md#conversas-da-equipe-no-disco-16) (in Portuguese).

## 1.5.2 · 2026-11-15 · Newspaper per floor and overtime

Release [`v1.5.2`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.2). Commits: [`v1.5.1...v1.5.2`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.1...v1.5.2).

### Added
- **Quick replies:** in an open conversation, with reply mode on, ready-made buttons ("Pode seguir", "Sim", "Não", "Pare", "Resuma o que fez") fill in the reply box. You still send it, with the usual Send button, after checking.
- **Do not disturb:** in **Settings › My profile**, each account chooses when phone alerts ring on the devices where it turned them on: always, only during office hours, or with quiet hours. What arrives during quiet hours does not become an alert later: it stays in **Esperando você** (waiting for you).
- **Overtime on the map:** outside office hours, agents who are working stay at their desk with the lamp on, and the card shows "Hora extra" (overtime). Waiting for your approval or answer does not count.
- **Overtime in the newspaper:** the newspaper counts time working outside the floor's office hours and says who stayed the longest.

### Changed
- **Economy mode:** the map draws fewer frames when nothing moves. Measured at 1280 px over 60 s: idle, from 154% to 49% CPU; with rain, from 166% to 119%; with agents walking, from 128% to 100%.

### Fixed
- **Newspaper per floor:** the issue carries the company and floor name, and says when the floor is not connected, linked to another workspace, reading late or still without activity. Morpheus spotted the wrong name on the 2nd floor (board task #14) and sent the first fix in PR [#30](https://github.com/HelbertMoura/escritorio-agentes/pull/30), merged into this one.
- **Reconnecting the same account:** connecting the same agentes.chat account again no longer clears the newspaper or the alerts; only a different account does. If the service restarts before the first read that checks the account, that clearing is lost.
- **Alerts of a removed account:** removing an account turns off phone alerts on the devices it turned them on, and a member's **Sign out of all devices** turns off alerts only on their own devices.

## 1.5.1 · 2026-11-14 · Chat on the right and tweaks

Release [`v1.5.1`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.1). Commits: [`v1.5.0...v1.5.1`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.0...v1.5.1).

### Changed
- **Room chat on the right:** on a computer, the chat pill and panel sit in the bottom right corner of the map, away from the agent card, the conversation and the strike. "Tap an agent" moves up above the pill. On a phone, the chat stays on the left.
- **Elevator on the phone:** the top bar shows the connection light and a shortened floor name, so the company name fits again. The open list shows each floor's full name and state.
- **Floor state:** under the sidebar elevator, the state only shows when something is wrong, like "This floor: not connected".
- **Switching pages starts at the top:** going back from Customize to the Office shows the map, not the end of the page.
- **No admin shortcuts for members:** members no longer see "Sample name and logo" or "Change hours", which led to settings only admins have.
- **Members:** the "Remove" button on your own account is disabled. To leave, ask another admin.

### Fixed
- **Agents on first load:** opening the office on an extra floor right after the server restarted showed an empty map for about 20 s. Now the floor's first read happens right away, and the page rereads every 1 s until it arrives (for at most 1 minute).

## 1.5.0 · 2026-11-14 · Floors and team

Release [`v1.5.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.0), with the video of what is new attached. Commits: [`v1.4.0...v1.5.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.4.0...v1.5.0).

### Added
- **Floors:** each agentes.chat workspace can become a floor of the building, with its own connection, teams, floor plan, social life and newspaper. Settings › Floors creates, renames and removes them (up to 6 extra, with the account password), and the elevator in the top bar switches floors without reloading. With no extra floors, everything stays as before. See [Floors](./README.md#floors-several-workspaces-in-one-building).
- **Team:** admins invite teammates with a personal, single-use link valid for 48 hours, in Settings › Members, which also changes each account's role (admin or member) and floors. The person creates the account with a name and a character and changes them later in **My profile**. Members see the office on the floors they were given, but cannot read the agents' conversations or change settings. See [Team](./README.md#team).
- **People on the map:** each signed-in person shows up on the floor with their own name and character, comes in from the street and walks to where they click. The "N pessoas olhando" (N people watching) line counts who is on the floor, and the sidebar shows how many people are in each room without desks.
- **Room chat:** each room has a text chat for whoever is in it. It lives only in the server's memory (the last 50 messages for up to 10 minutes), newcomers do not see what was said before, and restarting the office wipes it all.
- **Pull the departments from agentes.chat:** a button in Settings › Teams copies each agentes.chat department as a team (name, color and icon) and each agent's appearance. It needs an agentes.chat whose `list_agents` sends the `department`. A team with the same name keeps its type, wall and floor, and nothing applies before **Salvar times** (save teams).

### Changed
- The anonymous **Visitante** (visitor) badge is gone from the map: whoever has the office open shows up with their own account's name and character. The **Aparecer no escritório** (show me in the office) box and the TV work as before (they watch without showing up). See [Visitors](./README.md#visitors).
- **Sign out of all devices** only ends the sessions of whoever asked. Only an admin also turns off phone alerts on every device.

### Fixed
- **Reply from another device:** answered an agent's question on your phone with the office open on your computer? The agent leaves **Waiting for you** on both screens without waiting for the next agentes.chat read (on the device that replied, right away; on the other, within 10 s), and the request you already answered no longer takes the same answer again. A tab coming back from the background reads the state at once.
- **Tests on Windows:** the account and member tests pass on Windows (the first-access code file is closed before it is deleted, and the 0600 permission is only checked outside Windows).

### Security
- **Members only see what they may:** the server denies by default. Every route with a session checks the role before answering, and a member cannot read conversations, open reply mode or change settings, branding, floor plan, teams, floors, members or visits.
- **Invitations:** the link shows only once, and the server keeps only a fingerprint of it (sha256), never the link. Once used, expired or revoked, it no longer works; two acceptances of the same link at the same time create a single account. The invitation page has a per-origin request limit.
- **Changing a role or floors asks for the admin's password**, like inviting and removing. The office never runs out of admins.
- **Removing an account** signs the person out before saving the change, and their character leaves the map at once. A new account with an old account's name does not inherit the old sessions.
- **Isolated floors:** each floor reads agentes.chat with its own token. A floor that does not exist and a floor you cannot access get the same answer (404), and a floor connected to an account from another workspace says so and shows nothing from it.
- **Presence and chat only in memory:** who is on each floor and the room messages never go to disk or to the log, have per-person limits, and the server only takes a message for the room its author is in. Outside visitors do not see the team. See [where each piece of data goes](./docs/visitas-privadas-plano.md#equipe-presença-no-mapa-e-chat-por-sala) (in Portuguese).

## 1.4.0 · 2026-11-12 · Self-hosting and a bigger world

Release [`v1.4.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.4.0), with the video of what is new attached. Commits: [`v1.3.0...v1.4.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.3.0...v1.4.0).

### Added
- **Self-hosted agentes.chat:** the `AGENTES_URL` variable points the office at your install (its `PUBLIC_URL`). Sign-in, MCP and the "Reply" and "Review" buttons go there. The installer allows only that install's IP on the service's network, tailnet included. Without the variable, everything stays on the cloud. See [With self-hosted agentes.chat](./README.md#with-self-hosted-agenteschat).
- **World in the menu:** the **Mundo** item opens `/mundo.html`.
- **World in TV mode:** with no news, the TV shows the world for 45 seconds every 5 minutes, going from the globe down to the office's city and neighborhood. A tap on the map closes it. On its own, `/mundo.html?tv=1` runs the same tour full screen, for a lobby screen.
- **Cities in other countries:** 12 cities on the globe (Lisbon, Luanda, Maputo, Buenos Aires, Montevideo, Santiago, Mexico City, New York, London, Paris, Madrid and Tokyo), each one a golden dot. Clicking goes straight down to the city, with its current weather. Lisbon, New York, London and Paris got new landmarks (Belém Tower, Statue of Liberty, Big Ben and Eiffel Tower), and Buenos Aires uses the Obelisk. An office within 300 km of one of them gets its chalet there.
- **Mid-size cities:** the 50 cities that show up when you zoom into the map (Campinas, Santos, Juiz de Fora...) open too, sized by population and with a beach on the coast. The weather is the nearest capital's.
- **Buses and bikes:** they ride the streets along with the cars, each at its own pace, with lights on at night.
- **Party hats:** on holidays, three in five pedestrians in the city wear the holiday's hat, like the agents in the office.

### Changed
- `/mundo.html` can open inside the office itself (TV mode), and only there: `frame-ancestors 'self'`. The other pages still refuse framing.
- The agentes.chat token is bound to the install that issued it: changing `AGENTES_URL` drops the stored token without sending it anywhere, and the office asks you to connect again.
- The server fetches the weather of 40 cities (Brazil's 28 and the 12 abroad) in the same Open-Meteo request, every 15 minutes.

## 1.3.0 · 2026-11-10 · World and visits by invitation

Release [`v1.3.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.3.0), with the video of what is new attached. Commits: [`v1.2.0...v1.3.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.2.0...v1.3.0).

### Added
- **World:** `/mundo.html`, a public, cookieless page that goes from the globe down to Brazil, the city and the reception door, all in pixel art. See [World](./README.md#world).
- **Globe:** spins with the current night side, with clouds, the moon in the day's phase and city lights. Brazil is outlined, and clicking it goes down to the map.
- **Map of Brazil:** biomes, rivers, mountain ranges and the 27 state capitals plus Mateus Leme, each with a miniature of its landmark and the current weather. Zooming in reveals highways, smaller rivers, state names and mid-size cities; at maximum zoom over a capital, zooming in once more enters it.
- **City:** the landmark in the middle, a square, buildings and houses according to the city's size, streets with cars and pedestrians, and a waterfront in coastal capitals. The chalet with the sign only exists in the office's city and leads to the reception.
- **Live:** the real weather of the 28 cities from Open-Meteo (one server-side query every 15 minutes), day and night by the clock, and the calendar holidays, which decorate the city.
- **World privacy:** the page shows nothing from agentes.chat. The `POST /api/mundo/clima` route returns only the weather type, the wind and whether it is night per city, the office's city, the map version and the calendar holidays turned off. The company's own dates never leave. See [Security](./README.md#security).
- **Visits by invitation:** from the menu, **Convidar para uma visita** (invite for a visit) creates a link that is valid for 1 hour. Whoever gets it comes in without a password, sees the meeting room on a simplified map (no agent or team names) and talks to whoever is in the room. Ending the invitation drops the sessions. See [Visits by invitation](./README.md#visits-by-invitation).
- **Public reception:** `/visita.html` without an invitation shows only the reception; the other rooms stay dark, labeled "Com convite" (by invitation), and the chat is locked.
- **Receptionist (optional):** the team can put an agentes.chat agent to answer in the room. In that case the visitor's text goes to the visits channel on agentes.chat and is kept there.
- **Visits privacy:** without a receptionist, the invitation, the session and the messages live only in the process memory and are gone on leaving, on expiry or on restart; nothing from the visit goes to disk or to the log. Where each piece of data goes, and what to check on the proxy before opening it to the internet, is in [`docs/visitas-privadas-plano.md`](./docs/visitas-privadas-plano.md) (in Portuguese).
- **Livelier weather:** gusty wind, lightning drawn in the thunderstorm and swaying trees, in the office and in the neighborhood.
- **`ferramentas/montar_mundo.py`:** builds the files in `static/mundo/` from `arte/mundo/` and `arte/pixellab/mundo/`. Only those who want to change cities or art need to run it (it needs Pillow); the generated files ship in the repository.

### Changed
- The `?data=YYYY-MM-DD` parameter also works in the world: it changes the holiday and, on the globe, the sun and the moon.

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
