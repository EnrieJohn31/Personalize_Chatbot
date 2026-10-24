# Foundation validation

## Local model connection and pre-3.2 refinements — 24 October 2026

Requested by the user before task 3.2:
- **Local model server.** An administrator-configured OpenAI-compatible server (Ollama, LM Studio, llama.cpp or vLLM), on the Docker host or the local network, offered to every user and selectable in "Use for chat" like ChatGPT and OpenCode.
- **Refinements.**
  - Each conversation records the chat choice it started with.
  - Replies record the provider and model that wrote them, and the page shows it.
  - Account errors link to Connections.
  - Starting replies is rate-limited.
  - `messages.content` is widened to `MEDIUMTEXT`.
  - OPcache is enabled for the PHP CLI server.

See [connections.md](connections.md), [chat-ui.md](chat-ui.md), [chat-history.md](chat-history.md), [the contracts](../contracts/README.md#provider-connections) and [setup.md](setup.md). Two additive migrations; no dependency or lockfile changed. Rebuilding the PHP image is needed for OPcache.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (130 files), lint (92 files), TypeScript, 22 frontend unit tests, Pint, PHPStan (no errors), and 232 Laravel tests / 1332 assertions |
| Engine `npm test` | 61 tests passed, in an image rebuilt from the worktree |
| `npm run build` | Passed |
| Browser probe | 14/14 passed in four phases against a fake OpenAI-compatible server, the worktree's engine image and a worktree server, on an internal Docker network without internet access (details below) |
| Test speed | The PHP suite took 480 s without OPcache and 45–54 s with `opcache.enable_cli=1` in the same worktree container |

**New Laravel tests (18, counting data sets):**
- **Connections (2).** Four cards, with the shared server asked about but no records created. The local card's listing, test and chat choice. Missing or down servers refused without a record, and the record following the server down and back up.
- **Chat (6).** Conversations keep the choice they started with, and clients cannot set it. The chat header's `assistant` prop for new chats, older chats and a down server. A live run using the conversation's local model and recording it on the reply. The new 409 messages. The 20-per-minute run limit.
- **Run requests (1).** The conversation's model is used only with live replies on; an unreachable record is `connection_not_ready`.
- **Gateway and payloads (9).** The signed `GET /internal/local-model`, the example payloads, and 7 rejected payload shapes.
- **Changed.** Account deletion skips the local record's engine disconnect.

**Engine tests (6 new):** configuration rules for `LOCAL_LLM_URL`; listing and caching; unreachable and unconfigured servers; a streamed test message with and without a key (the placeholder `unused` when none is set); keys, sign-ins and disconnect refused or harmless for `local`.

**Frontend tests (1 new):** account error codes reach the reducer, `needsConnectionFix` recognises them, and following the run again clears them.

**Browser probe (14/14):**
- **Server up (6).** The card shows **Available**, the address and two models, with no key or disconnect controls. A test message reached the fake server as a streamed `qwen2.5:7b` request. The server was offered and saved in "Use for chat". A new chat's header showed `Ollama on this PC · qwen2.5:7b` and kept it after the (simulated) reply, which had no model label. A conversation started earlier still showed the built-in assistant.
- **Server stopped (3).** **Not answering** with the reason and fixes; the chat choice warned; the chat header turned amber with "not answering" in its tooltip.
- **Server restarted (3).** The card and header recovered on the next visit. No horizontal scroll at 390px width.
- **No `LOCAL_LLM_URL` (2).** **Not set up** with an example address.
- **All phases.** No console errors.

The first probe run found a real bug: Pi refuses to call a provider without an API key, so a keyless server (the normal Ollama and LM Studio setup) failed every test message with "No API key for provider: local". The engine test had always set a key. The engine now sends the placeholder, a new engine test covers it, and the probe passed. The screenshots also led to clearer wording for a server that is down ("not answering" rather than "connect again") and conditional `OLLAMA_HOST` advice.

Not verified: a real Ollama, LM Studio, llama.cpp or vLLM server, and real replies from any connection (task 3.2). Remote CI was not inspected.

## Code and contributor review — 24 October 2026

Reviewed the local changes in `d7bad7e` and `09da496`: connection ownership and request validation, encrypted credentials, signed engine calls, non-secret responses, the chat choice and conversation deletion. Both commits already had descriptive messages and the approved author/committer; they were preserved.

Found and fixed an account-deletion gap in `ac5a7f9`: the existing profile deletion cascaded database records without asking the engine to erase stored credentials. Account deletion now disconnects every owned supported-provider record, including duplicates and unconfigured records that may have a pending sign-in. It requires `not_connected` acknowledgements before deleting the database account. A failure retains the account and signed-in session for retry. Already disconnected providers remain disconnected; credentials are not restored as a rollback.

| Check | Observed result |
| --- | --- |
| Baseline `composer ci:check` on `09da496` | Passed: 210 Laravel tests / 1107 assertions, 21 frontend unit tests, formatting (128 files), lint (92 files), TypeScript, Pint (119 files), PHPStan (88 files) |
| Engine `npm test` | TypeScript build and all 55 tests passed |
| Cleanup regression | Before the fix, tests demonstrated skipped disconnects and account removal without an engine acknowledgement. After the fix, all four new cases pass: all owned records only, failure and retry, refusing an incomplete acknowledgement, and wrong password causing no disconnect |
| Post-fix targeted PHP tests | 32 tests / 342 assertions passed across account cleanup, profile updates, connections and connection gateway tests |
| Post-fix static checks | Pint passed for the three changed/new PHP files; PHPStan reported no errors; `git diff --check` passed |
| Live `php artisan agent:check` | Passed: configured request/credential settings, signed probe reached validation and unsigned probe was rejected; no run or provider request started |
| `php artisan migrate:status` | All nine migrations are applied, including the chat-connection migration. Read-only check; no database migration or deletion was performed during review |
| Attribution and exclusions | Full-history audit passed; both original commits and the cleanup commit use the approved human identity. No prohibited credits or trailers found in the reviewed changes. Hooks and approved identities remain intact; `.claude/` remains ignored/untracked with attribution disabled locally |

The complete baseline suite ran before the PHP cleanup fix; the affected tests and static analysis ran again afterward. The earlier browser probes, production frontend build, npm audits and mutation checks below were not repeated. Real provider login, live replies, token refresh, restart persistence with a real account and concurrent account-deletion/sign-in behavior remain unverified. Task 3.1 stays open. No push or remote CI verification was performed.

## Chat deletion, date sections and OpenCode connections — 24 October 2026

These were requested by the user during task 3.1:
- **Chat.** The sidebar sorts conversations into Today, Yesterday, Previous 7 days and Older. Conversations can be deleted singly or in a multi-select.
- **Connections.** Connections is now its own page in the main menu. It offers OpenCode Go and Zen through an API key, and stores the user's choice of connection and model for chat.

See [chat-ui.md](chat-ui.md), [chat-history.md](chat-history.md), [connections.md](connections.md) and [the contracts](../contracts/README.md#provider-connections). One additive migration (`users.chat_connection_id`, `chat_model`); no dependency or lockfile changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting, lint (92 files), TypeScript, 21 frontend unit tests, Pint (119 PHP files), PHPStan level 7 (no errors), and 210 Laravel tests / 1107 assertions |
| New Laravel tests | 25 (details below) |
| Engine `npm test` | 55 tests passed (details below) |
| Frontend unit tests | 3 new date-section tests: day boundaries at midnight, the seven-day edge, empty sections, kept order, future and unreadable timestamps |
| Browser probe | 13/13 passed against the task's engine image and a worktree server with seeded SQLite data, on an internal Docker network without internet access (details below) |
| Visual review | Screenshots of the sections, delete dialog, selection mode, Connections page, connected OpenCode card, chat choice and phone layout were inspected. The chat-choice selects were widened |

**New Laravel tests:**
- **Deletion (7).** Single and bulk deletion, owner-only, foreign IDs ignored, validation, stopping a running reply and freeing the slot, an untouched reply in another conversation, and a conversation deleted mid-stream ending with `conversation_deleted` and no save.
- **Connections page (15).** Three providers shown without records created, engine states, the ChatGPT flows, OpenCode keys passing through unchanged and never kept, key validation without old input, method mismatches as 404, the test-message flash, re-authentication, the chat choice with its checks and its reset on disconnect, and per-user isolation.
- **Gateway (1).** The signed key `PUT`.

**Engine tests (55 passing):**
- An OpenCode key is stored encrypted, used as the request key with a session ID, replaced, and removed on disconnect.
- Keys and sign-ins are refused for the wrong providers by both the schemas and the manager.
- The ambient-key guard now also covers `OPENCODE_API_KEY` against Pi's real OpenCode providers.

**Browser probe (13/13):**
- Sections as expected.
- Deleting from the menu with a confirmation.
- Deleting the open conversation from the header, returning to a new chat with the emptied section gone.
- Select, title-click toggling, Select all, Clear and deleting two.
- The deletions persisting after a reload.
- Connections links in the main menu and the chat sidebar, the old address redirecting, and the item gone from Settings.
- Three cards.
- OpenCode Go: a rejected key, then a saved key that never appeared in the page; the free `beam-free` test model failing with "Connection error." on that card only.
- Chat set to OpenCode Go with `beam-free`; removing the key returned chat to the built-in assistant.
- A 390px phone width without horizontal scroll; no console errors.

The first probe run passed 11/13 because of a wrong count in the probe itself (5 conversations remained, not 4). The application behaved correctly, which a step-by-step trace confirmed.

Not verified: real OpenCode keys and replies, a real ChatGPT sign-in, and using the chat choice for replies (task 3.2). Remote CI was not inspected.

## Task 3.1 — 24 October 2026 (implementation; live sign-in pending)

Implemented ChatGPT subscription sign-in. It consists of the engine's `ConnectionManager`, the encrypted per-connection `CredentialVault` and installation ID, six signed connection endpoints with strict v1 schemas, Laravel's `ConnectionGateway`/`SubscriptionConnections`, and the **Settings → Connections** page. See [connections.md](connections.md) and [the contracts](../contracts/README.md#provider-connections).

Compose now publishes `127.0.0.1:1455` and adds the `agent-data` volume. `.env` gains `AGENT_CREDENTIAL_KEY` and `ASSISTANT_CONNECTION_TEST_MODEL`. No dependency, lockfile or migration changed.

| Check | Observed result |
| --- | --- |
| `composer ci:check` | Passed: formatting (117 files), lint (83 files, no warnings), TypeScript, 18 frontend unit tests, Pint (112 PHP files), PHPStan level 7 (82 files, no errors), and 198 Laravel tests / 971 assertions |
| New Laravel tests | 41 tests across three groups (details below) |
| Engine `npm test` | 53 tests passed (19 new, details below) |
| Mutation checks | Giving Pi its default auth context again failed exactly the ambient-key test. Removing the paste pre-check failed exactly the pasting-mistakes test |
| npm audit | 0 vulnerabilities for the application and the engine |
| `npm run build` | Passed |
| Browser probe, sign-in | 8/8 passed against the task's engine image and a worktree server with SQLite data, on an internal Docker network without internet access (details below) |
| Callback listener | Probed during a sign-in on the engine's port 1455: a forged `state` got 400 and the sign-in kept waiting, a wrong path got 404, and after cancelling the port was closed. Engine logs contained only connection IDs and outcomes |
| Browser probe, connected | 4/4 passed with an invented credential stored for the probe user (details below) |
| Visual review | Screenshots of the not-connected, waiting, refused-paste, phone, cancelled, connected and test-failed states were inspected; no defects found |

**New Laravel tests:**
- DTO parsing against the shared examples (23 cases).
- The signed connection gateway: signed targets with the query, exact bodies, engine messages and invalid responses (7).
- The settings page and actions (11): access control, the record created once, engine unavailable or unconfigured, paste sign-in mirroring `connected`, browser-completed sign-in, inline refusals, the pasted address not kept as old input, the cancel window, the test result flash, `reauth_required`, disconnect, and per-user connections.

**New engine tests:**
- **Vault.** Round trip, encryption and private permissions, a swapped file or another key unreadable, replacement after that, serialized writes, a failed write.
- **Installation ID.** Stable across concurrent first calls.
- **Sign-in flows.** A fake Pi provider mirrors Pi's ChatGPT flow: pasted and browser sign-ins, pasting mistakes refused while waiting, one sign-in at a time, failures, expiry, the test message using the stored token, refresh, `reauth_required` without a model call, disconnect, unreadable files, routes and contracts.
- **No silent API billing.** The real OpenAI provider never uses `OPENAI_API_KEY`; a control showed Pi's default context would.

**Sign-in browser probe:**
- The settings link and a new user's "Not connected" state.
- The real sign-in address from Pi: `auth.openai.com/api/accounts/authorize`, `dynamic_agent_client`, `agent_name_hint=Assistant Foundation`, an installation `urn:uuid`, the `127.0.0.1:1455` redirect and PKCE.
- Polling only the connection prop.
- A pasted address from another sign-in refused inline, with the error staying while polling continued.
- 390px phone width without horizontal scroll.
- Cancel notice and polling stopped.
- No console errors.

**Connected browser probe:**
- "Connected" with 42 models and `gpt-5.4-mini` preselected.
- The test message reported "Connection error." as a failed test, because the network had no internet.
- Disconnect asked for confirmation, removed the file and showed the toast.
- The engine data directory was `0700` and the installation ID `0600`.

The first sign-in probe passed 6/8 and found a real defect: the refused-paste error never appeared. A poll reload that ran during the paste either took the action's flashed errors or overwrote the session when it finished. The fix pauses polling while a sign-in form submits, and gives the page and its sign-in actions Laravel's session lock (`->block(15, 15)`). Afterwards 8/8 passed, and the error stayed through later polls. The same run measured about 4 seconds per request on the probe server while its workers warmed up, so polling runs about every 6 seconds there.

A Laravel test also found that a form request's `$dontFlash` is ignored: old input is flashed by the exception handler. `redirect_url` is now registered in `bootstrap/app.php`.

Not verified: the live sign-in with a real ChatGPT account, eligibility, which models a plan may call, the real token lifetime and refresh, a real test reply, and a browser on another host using the paste step against OpenAI. These complete task 3.1 and are recorded in [the provider matrix](provider-matrix.md) when done. Remote CI was not inspected.

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
