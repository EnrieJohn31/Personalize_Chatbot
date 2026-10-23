# Foundation validation

## Task 2.4 — 23 October 2026

Implemented the simulated reply stream: engine execution and event stream, the Stage A Laravel relay, server-side saving, Stop and the browser hook with safe Markdown. Behavior and protocol are described in [chat-ui.md](chat-ui.md) and [contracts/README.md](../contracts/README.md). Added `react-markdown` ^10.1.0 and `remark-gfm` ^4.0.1. The lockfile gained 99 packages and lost none, with no version changes; `@types/estree` and `dequal` are now also production dependencies. No migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (103 files), lint (81 files, no warnings), TypeScript, 18 frontend unit tests, Pint (100 PHP files), PHPStan level 7 (74 files), and 157 Laravel tests / 756 assertions |
| New Laravel tests | 35: strict event parsing (15 cases); the signed NDJSON reader (query in the signed target, heartbeats, terminal stop, resume cursor, malformed and out-of-order events, early end, engine errors); relay admission, one reply per user, ownership, SSE output with IDs, single idempotent save, resume, cancelled/failed runs saving nothing, resumable interruption, contract violation freeing the slot, Stop, and `active_run` on the page |
| Engine `npm test` | 34 tests passed (12 new): deterministic Markdown answer, lossless chunks, contract-valid events whose deltas equal the final text, cancellation, deadline, event limit, replay and resume, live following, Stop during a stream, no second execution for a duplicate admission, signed and validated stream requests |
| Frontend unit tests | 8 new reply-reducer tests: delta accumulation, final text replacing the draft, replayed events applied once, resumable and final stream errors, Stop confirmation, a late Stop not reopening a completed reply, following the same or a new run |
| npm audit | 0 vulnerabilities for the application and the engine |
| `npm run build` | Passed; the chat page chunk is now 191 kB (58 kB gzip), up from 25 kB (8.8 kB gzip) because of the Markdown parser |
| Stream timing | Laravel's gateway received engine events as paced (about every 60 ms), not buffered. In the browser, Chrome DevTools recorded each relayed SSE delta about 250 ms apart, matching the engine pace, with about 37 ms between the final text and the saved completion |
| Browser probe | 11/11 passed against a worktree engine (250 ms simulated chunks) and server with SQLite data: incremental draft (13 growth steps); final reply shown once with bold, list, quote and code block; saved and not duplicated after reload; an `<img onerror>` and a `javascript:` link in a message neither ran nor rendered; Stop showing "Stopped" and saving nothing; reload mid-reply resuming and saving once; closing the tab mid-reply still saving the reply; a new chat streaming its first reply on its own page; 390px mobile with a code block not overflowing; dark mode; no console errors |
| Visual review | Screenshots of a reply, a stopped reply, mobile and dark mode were inspected. Two issues were fixed and re-checked: the "Stopped" label had stayed below the visible area, and a removed unsafe link still rendered as an empty link |

The first browser run passed 8/11 and appeared to show buffered streaming. Timing showed that every request to the probe server took about 3.6 seconds, even `GET /up`, so a 1-second simulated reply had finished before its stream opened. The relay then correctly replayed it. With OPcache enabled for PHP's CLI server, warm requests took 220–440 ms, and the paced reply streamed live. The running development container uses the same CLI server with `opcache.enable_cli=0`; its `GET /up` took 3.0 s, 1.0 s and 0.12 s on three tries. Enabling OPcache there is an optimization suggestion and was not changed in this task.

Not verified: real provider replies, physical phone keyboards and IMEs, screen-reader output, several concurrent users, a proxy in front of the event stream (Laravel sends no heartbeats to the browser yet), and an engine restart during a reply. Replies longer than MySQL's `TEXT` limit (65,535 bytes) would fail to save. The simulated replies are far shorter, but real models may not be, so the `messages.content` column needs widening before task 3.2. Remote CI was not inspected.

## Task 2.3 — 23 October 2026

Implemented the chat page; behavior and files are described in [chat-ui.md](chat-ui.md). No dependency, lockfile or migration changed. `composer ci:check` now also runs the frontend unit tests (Vitest bundled with Vite+).

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (99 files), lint (77 files, no warnings), TypeScript, 10 frontend unit tests, Pint (93 PHP files), PHPStan level 7, and 122 Laravel tests / 636 assertions |
| New Laravel tests | `ChatPageTest`, 6 tests: guest and unverified redirects; owner-only list order; next page through the JSON list; latest 50 messages in order with the cursor and a matching JSON older page; private fields absent; another user's and malformed IDs 404. The existing 18 history tests still pass after their controller moved its queries into `ConversationRepository` |
| Frontend unit tests | 10 tests: Enter, Shift+Enter, other keys, `isComposing`, composition flag, keyCode 229, blank drafts, code-point limits with emoji, title shortening on grapheme boundaries |
| `npm run build` | Passed; the chat page chunk is 25.1 kB (8.8 kB gzip) |
| Browser probe | 31/31 checks passed with Playwright 1.64.1 against a built worktree server backed by its own SQLite file and invented data. Chromium desktop: empty state, first-message conversation creation and navigation, Shift+Enter/Enter, synthetic and CDP IME composition, Safari keyCode 229, failed-save alert with draft restored, over-length limit, opening at the bottom, earlier messages with the anchor moving 0px, indentation and long-token wrapping, 12px message spacing, copy success and the no-clipboard failure state, sidebar rename (no leftover pointer lock), dark/light theme, sidebar collapse, accessible names on every button and link. Chromium mobile (390×844, touch): no horizontal overflow, composer inside the viewport, Sheet navigation closing after selection, Enter sending. Firefox and WebKit: the four keyboard/IME checks |
| Visual review | Light and dark desktop screenshots and mobile screenshots were inspected. The first probe run showed oversized gaps between messages; actions now sit beside user bubbles, and the probe measures the gap |
| Console | No unexplained errors. Explained notes: the deliberate simulated 500, a Firefox font download aborted by fast navigation, and WebKit ignoring the `interactive-widget` viewport hint |

The probe used `http://localhost` inside the server's network namespace, so the Clipboard API was available as it is at `http://localhost:8080`. On a plain-HTTP non-localhost origin, copy now reports "Copy failed" instead of doing nothing. The CDP IME simulation also inserted a newline after the composed text; a real IME consumes the confirming Enter, which needs a physical-device check.

Not verified: physical iOS/Android keyboards and real IMEs, screen-reader output, and the running development services (the probe used the task branch worktree). Remote CI was not inspected. Optimization: the page loads 25 conversations and 50 messages initially; measure before adding virtualized lists.

## Publication review — 23 October 2026

Reviewed task 2.2 at `8e29e53`, including ownership checks, serialization, HMAC signing and verification, bounded request reading, strict schemas, duplicate/cancellation handling, setup and private networking. No blocking implementation defect was found. Corrected the server comment and handoff to describe the actual authentication order: header checks precede the bounded body read; signature verification precedes JSON parsing. Clarified that engine admission exists while Laravel run admission and message-write idempotency remain future work. No runtime behavior changed.

| Check | Observed result |
| --- | --- |
| `docker compose exec --user sail laravel.test composer ci:check` | Passed: formatting (87 files), lint (64 files), TypeScript, Pint (91 files), PHPStan (70 files), and 116 Laravel tests / 561 assertions |
| `docker compose exec agent npm test` | TypeScript build and all 22 engine tests passed |
| `docker compose exec --user sail laravel.test php artisan agent:check` | Passed against the running services: signed probe accepted for validation, unsigned probe rejected; no run admitted |
| Contributor review | Complete-history attribution audit passed. All nine existing commits use the approved human author and committer. No co-author trailer or prohibited contributor credit was found in the task 2.2 changes; attribution settings, approved identities and hooks remain unchanged |
| Tracked-file review | No `.env`, downloaded dependencies or generated build output is tracked; the local request-signing secret is absent from the changed tracked files |
| Publication | `main` fast-forwarded to `development`; both remote branches accepted all four pending commits through `8e29e53` in one atomic push. No history rewrite |

Remote CI results were not inspected. Earlier mutation, dependency-audit and live run-admission results below remain dated implementation evidence; they were not repeated in this review. Tasks 2.3–2.4 remain unimplemented. Admission is still process-local and no provider/model execution exists.

## Task 2.2 — 23 October 2026

Implemented versioned private engine contracts and signed Laravel-to-engine calls; the contract is documented in [contracts/README.md](../contracts/README.md). The engine now declares `typebox` 1.3.27 directly. It was already installed through Pi, and the lockfile's resolved tree is unchanged apart from that root entry. No PHP dependency or migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: frontend formatting/lint (64 files) and types, Pint (91 PHP files), PHPStan level 7 (70 files), and 116 Laravel tests / 561 assertions |
| New Laravel tests | 58 tests / 125 assertions: shared signing vector; snapshot serialization identical to the shared example; PHP bounds compared with the schema; 16 invalid-snapshot cases; signed payload, headers and target; engine error codes and details; 7 out-of-contract responses; transport and bare-5xx failures; missing/short key sending nothing; cancel path signing; owned-history snapshots, history bounds, cross-user conversation (404) and forged connection refusal; `not_configured` connections refused for live models; no private fields sent; `agent:check` outcomes |
| Engine `npm test` | Passed: 22 tests covering shared examples, signing vector, schema strictness, health, missing/wrong-key/expired/future/malformed signatures, cross-endpoint and body tampering, content type, JSON, contract version, bounded details, semantic rules, model/capability refusal, body limit, bounded registry expiry, idempotent admission, conflicting reuse and cancellation |
| Signing vector | Computed independently with OpenSSL and Node before either implementation existed; both runtimes reproduce it in tests |
| Mutation check | Making engine signature comparison always succeed failed the two signature tests |
| Live cross-container probe | A temporary engine built from this commit joined the Compose network with no host port. Laravel's `PiGateway` received: 202 accepted; 202 duplicate on identical resubmission; 409 `conflicting_duplicate`; 422 `model_unavailable` for an unverified provider; 422 `unsupported_capability`; 202 `cancel_requested`, then duplicate; 404 `run_not_found` |
| `php artisan agent:check` | Passed with the matching key (signed probe reached validation, unsigned probe got 401). Failed with exit 1 and `authentication_failed` for a different key; the engine logged `missing` and `mismatch` reasons only |
| Engine npm audit | 0 vulnerabilities |
| Compose configuration | `docker compose config` valid; engine receives the key/simulation variables, a read-only `/contracts` mount and the `contracts` build context; still no published port |
| Setup key generation | The `setup.ps1` replacement logic, run on a scratch copy of `.env.example`, produced one 64-character key and preserved it on a rerun |
| Running development services | After `2e8b62d` reached `development`: a generated 64-character key was added to the ignored `.env` without printing it. `docker compose up -d --build agent` became healthy with `PortBindings` `{}`. `agent:check` passed, the engine's 22 tests passed in the running `agent` container, and 116 Laravel tests / 561 assertions passed in `laravel.test` |

The checks above the last row ran against the task branch worktree in disposable containers, without changing the running development services. The live probe used a temporary key and a temporary engine container that was stopped afterwards. No model or provider was called, and nothing persists between engine restarts. Remote CI was not triggered.

Not verified: overlapping-key rotation, behavior under concurrent admission load, and any engine-to-Laravel callback (none exists). The Windows filesystem optimization noted below still applies. Next are tasks 2.3 (chat page) and 2.4 (simulated stream).

## Task 2.1 — 23 October 2026

Implemented owned conversations/messages and non-secret provider connection metadata; the public endpoint contract is in [chat-history.md](chat-history.md). No runtime dependency or lockfile changed.

| Check | Observed result |
| --- | --- |
| `php artisan wayfinder:generate --with-form` | Passed; generated route/action types for the new endpoints; generated files remain ignored |
| `composer ci:check` | Passed: frontend formatting/lint/types, Pint (77 PHP files), PHPStan level 7 (61 files), and 58 Laravel tests / 436 assertions |
| New history tests | 18 tests / 298 assertions within the complete suite: owner save/load, guest/unverified denial, CSRF denial/acceptance, cross-user and nested-parent isolation, forged fields, private-field exclusion, pagination links/cursors, text bounds/whitespace, account cascades, sequence uniqueness and transactional rollback |
| MySQL migration preview and apply | Three additive migrations passed: provider connections, conversations, messages; existing authentication tables were preserved |
| MySQL fixture probe | Passed: 12,000 four-byte characters round-trip, ordered appends, database duplicate-sequence rejection, connection unlinking with retained messages and account deletion cascading through associated records |
| Local data preservation | Fixture changes were rolled back; a fingerprint of existing user rows matched before migration and after verification; no default/test account remains |
| Laravel → Pi | Existing private health check still returns `status: ok` and `providerAuth: not_configured` |

Tests use isolated SQLite memory databases. The separate MySQL probe ran inside a transaction against the local development service, retained under ignored `.setup/verify-history.php` with its non-secret baseline fingerprint. It refuses non-local/non-MySQL environments and rolls back fixture changes in `finally`. It did not reset the database or remove a volume. The three actual schema migrations remain installed; only the temporary fixture was rolled back.

The regression suite covers the existing authentication/settings flows. The frontend's lint/types and generated route types were checked; the compiled frontend and unchanged engine test suite were not rebuilt/rerun in this task. The prior browser/build/engine results below remain dated Phase 1 evidence. Concurrent append load testing, real provider authentication, chat UI/streaming and durable run admission/replay are not verified. Remote CI was not inspected or triggered by a new push. Task 2.2 is next.

Optimization: history reads use the unique conversation/sequence index and a numeric boundary for older pages; list reads avoid total counts and have explicit bounds. Measure list-query cost before replacing offset pagination with cursors. The Windows filesystem optimization noted below still applies.

## Phase 1 — 22 October 2026

Date: 22 October 2026. Environment: Windows checkout, Docker Desktop Linux/WSL2 engine, pinned runtimes in [runtime-versions.md](runtime-versions.md).

## Observed results

| Check | Result |
| --- | --- |
| PHP and agent Docker builds | Passed, including required PHP extensions and the agent TypeScript build |
| `composer validate --strict --no-check-publish` | Passed; manifest and lockfile agree |
| `composer audit` | No vulnerability advisories |
| Frontend and agent npm installation/audit | Both report zero vulnerabilities |
| `npm run build` | Passed; browser assets, fonts and manifest generated |
| `npm run types:check` | Passed |
| `npm run check` | Passed: 72 formatted files, 64 linted files, zero warnings/errors |
| `composer test` | Passed: Pint (55 files), PHPStan level 7 (40 files, no errors), PHPUnit 40 tests / 138 assertions |
| `docker compose run --rm --no-deps agent npm test` | Passed: 3 tests covering Pi imports/readiness, rejecting writes to health, and rejecting execution before authenticated contracts exist |
| MySQL migrations | All five starter migrations passed on MySQL 8.4.13 |
| MySQL restart persistence | A uniquely named temporary user survived a normal MySQL container restart; its ID/email were verified, then only that fixture was deleted |
| Laravel → Pi | Laravel's HTTP client successfully called configured `http://agent:3101/internal/health` and received `status: ok`, `providerAuth: not_configured` |
| Private engine port | Docker's `HostConfig.PortBindings` is `{}`; no agent port published |
| Compose health | Laravel, MySQL and agent all healthy after startup/restart |
| Browser login | `http://localhost:8080/login` renders the styled React form; no browser console warnings/errors |
| Development server | Documented `npm run dev` command starts; login and `http://localhost:5173/@vite/client` both return HTTP 200; server stopped after the check |
| Setup script | PowerShell syntax checked; its build/install/key/migrate/start commands were exercised during setup |

PHP tests use SQLite in memory and do not prove MySQL behavior. The separate live MySQL fixture check above supplies the Phase 1 persistence evidence. The one-off probe is retained under ignored `.setup/verify-foundation.php`; it refuses non-local/non-MySQL environments, records the exact fixture ID/email and cleans up its fixture record. No default account remains in the database.

## Changes and implementation decisions

- Imported the pinned official React starter while preserving the blueprint, build plan and download records. Retained the starter's registration, email verification, password reset/confirmation, two-factor and passkey features. Removed its one-time feature-install scaffolding after successful configuration.
- Added `compose.yaml`, the pinned Sail-compatible `docker/php/` image, `.env.example` defaults, `config/assistant.php` and `scripts/setup.ps1`. Local secrets were generated only in ignored `.env`. MySQL uses a project-specific volume and no host port.
- Added `agent-service/` with its separate manifest/lockfile, minimal private health server, TypeScript configuration, tests and development image. Pi imports are real; provider requests are not implemented or simulated as successful.
- Generated all three dependency lockfiles. Replaced the starter's vulnerable Vite+ 0.3.x tooling with 1.3.0 and its matching Vite alias/override; no forced audit fix or ignored platform requirements were used.
- Added Windows watcher polling, excluded setup caches/engine files from the frontend/PHP formatters, removed the starter's known seeded account, and added the Pi checks to CI. CI is configured but has not run on a remote host.
- Documented startup, shutdown, private ports, development scripts, verification and optimization in the README/setup/runtime/build-plan files. The prerequisite record remains in `docs/prerequisites.md`.

## Limits and next work

The successful frontend build took about 156 seconds on this Windows bind mount; Tailwind's transform accounted for about 125 seconds. Composer extraction and first PHP checks were also slow. Move the single authoritative checkout to Ubuntu's Linux filesystem after its user/Docker integration is ready to improve filesystem performance. This is a development observation, not an application throughput benchmark.

The build emits a non-fatal warning that optional `fontaine` is absent, so optimized font fallbacks are unavailable. Font assets still build and the browser renders correctly. No additional font dependency was added solely to silence it.

The full setup script has not been exercised from a separate pristine checkout; Phase 6.3 retains that acceptance check. Its constituent setup steps passed here. No production deployment, backup/restore, physical passkey enrollment, external email delivery or live provider test was performed. Provider authentication remained unconfigured at this checkpoint. Task 2.1 was next after Phase 1; see the newer dated record above and the handoff for current progress.
