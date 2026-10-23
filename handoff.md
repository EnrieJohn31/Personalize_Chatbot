# Development handoff

Updated: 24 October 2026. Read this file first when resuming work.

## Where we stopped

**Phase 2 (tasks 2.1–2.4) is implemented. Task 3.1's connections are implemented and checked without real accounts: ChatGPT sign-in, plus OpenCode Go and Zen keys added at the user's request. Task 3.1 is finished when the operator connects a real account on the Connections page and a test message succeeds.**

The application provides:

- The Laravel React authentication starter and MySQL persistence.
- Owned history/connection-metadata endpoints.
- A signed, schema-validated Laravel-to-Pi boundary.
- The chat page at `/chat`, with conversations grouped by Today, Yesterday, Previous 7 days and Older, and deletion of one or several conversations.
- A Connections page in the main menu: per-user ChatGPT sign-in and OpenCode Go/Zen keys, encrypted inside the engine, and a choice of which connection and model chat uses.

Replies still stream from the engine's deterministic simulation through a Stage A Laravel relay. Real model execution (task 3.2), tools and durable runs are not implemented yet. See [the history endpoint contract](docs/chat-history.md), [the engine contracts](contracts/README.md), [the chat page and replies](docs/chat-ui.md) and [the connections guide](docs/connections.md).

| Document                                             | Use it for                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [Blueprint.md](Blueprint.md)                         | Architecture, ownership, security boundaries and acceptance requirements |
| [Build_Plan.md](Build_Plan.md)                       | Numbered tasks, completion checkboxes and progress                       |
| [docs/setup.md](docs/setup.md)                       | Installation, daily commands and troubleshooting                         |
| [docs/validation.md](docs/validation.md)             | Dated checks for Phase 1 and tasks 2.1–3.1, with their limits            |
| [docs/connections.md](docs/connections.md)           | Task 3.1 ChatGPT and OpenCode connections and the chat choice            |
| [docs/chat-history.md](docs/chat-history.md)         | Task 2.1 endpoints (and deletion), ownership, storage and pagination     |
| [docs/chat-ui.md](docs/chat-ui.md)                   | Chat page, date sections, deletion, Stage A reply relay and checks       |
| [contracts/README.md](contracts/README.md)           | Engine schemas, request signing, admission, event stream and error codes |
| [docs/runtime-versions.md](docs/runtime-versions.md) | Installed versions, image identities and compatibility sources           |
| [docs/provider-matrix.md](docs/provider-matrix.md)   | Provider path, ownership and what is verified or still untested          |

## Completed and checked

- Tasks 0.1–0.3: workspace selected, versions recorded and initial provider ownership/path documented. All three generated lockfiles are saved in local commit `6736ac6`.
- Task 1.1: Laravel 13.38.0 with the official React/Inertia/TypeScript/Tailwind/shadcn/ui/Lucide starter. Registration, email verification, password reset/confirmation, two-factor and passkey scaffolding remain enabled. No default account is seeded.
- Task 1.2: pinned PHP/Node development image, Compose services, MySQL 8.4.13, all five starter migrations and a persistent named volume. A temporary user survived a database restart and was then removed.
- Task 1.3: `agent-service/` with Pi 1.4.0, TypeScript, its own lockfile and a private health endpoint. Laravel reached it by service name; no engine host port is published.
- Checks passed during Phase 1: 40 Laravel tests / 138 assertions, PHPStan, Pint, frontend build/types/lint, three engine tests, dependency audits, MySQL persistence, private service connectivity and browser login without console errors. These are recorded results, not checks rerun for this documentation change.
- Task 2.1: added three MySQL tables, UUID models/relations, ownership policies, session-authenticated JSON endpoints, bounded history pagination and transactional user-message appends. Browser requests cannot assign owners, message roles/sequences, connection status or private transcript/credential fields. New connections remain `not_configured`; actual provider credentials are not stored here.
- Task 2.1 verification: `composer ci:check` passed, including 58 Laravel tests / 436 assertions (18 history tests), PHPStan, Pint and frontend lint/types. Additive migrations passed on MySQL; a rolled-back fixture verified text/sequence persistence, unique constraints, connection unlinking and account cascades. Existing user records were unchanged. Laravel still reaches the private Pi health endpoint. See the dated results in [docs/validation.md](docs/validation.md).
- Task 2.2: added strict v1 JSON Schemas and shared examples in `contracts/`. `AgentGateway` (bound to `PiGateway`) submits, cancels and checks health. Requests are signed with `AGENT-HMAC-SHA256-V1` using `AGENT_REQUEST_SIGNING_KEY`. `RunRequestFactory` builds the run snapshot only from the acting user's owned conversation, history and connection; a `not_configured` connection can never back a live model. The engine checks signature headers before reading the bounded body, verifies its signature before parsing, validates against the shared schemas, admits idempotently in a bounded record and acknowledges cancellation. `php artisan agent:check` verifies keys and reachability without admitting a run. No migration or PHP dependency changed; the engine now declares its existing `typebox` 1.3.27 dependency directly.
- Task 2.2 verification: `composer ci:check` passed with 116 Laravel tests / 561 assertions (58 new), Pint (91 files), PHPStan level 7 (70 files) and frontend lint/types. 22 engine tests passed and npm audit found 0 vulnerabilities. A live probe between real containers accepted a signed fake run, reported a duplicate, rejected a conflicting reuse, an unverified provider, an unenforceable capability and a wrong key, and acknowledged cancellation. A mutation that disabled signature checking failed the signature tests. See [docs/validation.md](docs/validation.md).
- Publication review on 23 October 2026: reviewed the task 2.2 implementation and reran `composer ci:check` (116 tests / 561 assertions plus formatting, lint, types, Pint and PHPStan), all 22 engine tests and live `agent:check`; all passed. No blocking defect or prohibited contributor attribution was found. Corrected documentation of the authentication order and the remaining Laravel admission work; runtime behavior is unchanged. Tasks 2.1–2.2 were fast-forwarded to `main` and pushed to both remote branches with their original commits and messages preserved.
- Task 2.3: `/chat` and `/chat/{conversation}` render the Inertia page `chat/index`, with an off-canvas conversation sidebar (a Sheet on mobile), a transcript with "Load earlier messages", a bottom composer, rename, copy and a theme menu. Initial props come from `ChatPageController`; later reads and writes use `/api/chat` through Inertia's XSRF-aware client. The JSON history controller now shares its list and paging queries through `ConversationRepository`. `composer ci:check` now also runs the frontend unit tests (`npm run test`, Vitest bundled with Vite+). No dependency, lockfile or migration changed.
- Task 2.3 verification: `composer ci:check` passed with 122 Laravel tests / 636 assertions (6 new page tests), 10 frontend unit tests, Pint (93 files), PHPStan level 7 and frontend format/lint/types; the production build passed. A 31-check Playwright probe passed against a built worktree server with its own SQLite data. It covered desktop and 390px mobile layouts, Enter, Shift+Enter and IME composition in Chromium, Firefox and WebKit, failure and length handling, scroll preservation, rename, copy, theme, sidebar and accessible names. Screenshots were reviewed and a spacing defect fixed. Physical-device keyboards and real IMEs remain unverified. See [docs/validation.md](docs/validation.md).
- Task 2.4: the engine runs admitted runs as a deterministic simulation and streams contract events from `GET /internal/runs/{id}/events` (replay, then follow; NDJSON with heartbeats). The labelled Stage A `ChatRunController` admits one reply per user (`ActiveRuns`, cache-backed) and relays server-sent events with the engine sequence as the event ID. It saves the final reply once per run through `ConversationRepository::appendAssistantMessage`, also after the browser disconnects, and forwards Stop. The page streams through `hooks/use-chat-run.ts` and a tested reducer, renders replies with safe Markdown, resumes an active reply after a reload, and offers "Get a reply" for an unanswered message without saving it again. Added `react-markdown` and `remark-gfm`; no migration changed.
- Task 2.4 verification: `composer ci:check` passed with 157 Laravel tests / 756 assertions (35 new), 18 frontend unit tests, Pint (100 files) and PHPStan level 7 (74 files); 34 engine tests passed and both npm audits found 0 vulnerabilities. Timing traces showed events arriving in the browser at the engine's pace. An 11-check full-stack browser probe passed: incremental text, safe Markdown with an injection attempt neutralized, one final reply, reload-resume, Stop, saving after the tab closed, the new-chat flow and mobile. See [docs/validation.md](docs/validation.md).
- Task 3.1 (implementation): a Connections page (first under Settings; in the main menu since 24 October) lets each user connect their own ChatGPT account through Pi 1.4.0's OpenAI "Sign in with ChatGPT".
    - **Engine.**
        - `ConnectionManager` runs the sign-in, one at a time with a 10-minute limit. It pre-checks a pasted redirect, runs a user-triggered test message and disconnects.
        - `CredentialVault` stores one AES-256-GCM file per connection in the private `agent-data` volume. The key comes from `AGENT_CREDENTIAL_KEY`, and the connection ID is authenticated data.
        - A stable installation ID identifies the engine to OpenAI.
        - Pi gets no ambient environment, so `OPENAI_API_KEY` can never be used.
    - **Laravel.**
        - `ConnectionGateway` on `PiGateway` has longer timeouts and strict DTOs.
        - `SubscriptionConnections` mirrors the non-secret status `connected`/`not_configured`/`reauth_required` into the connection record.
        - `Settings\ConnectionsController` serves the page, and its sign-in routes take the session lock.
    - **Compose.** It publishes only `127.0.0.1:1455` (OpenAI's fixed callback). There are six new contract schemas with examples.
- Task 3.1 verification:
    - `composer ci:check` passed with 198 Laravel tests / 971 assertions (41 new), 18 frontend unit tests, Pint (112 files) and PHPStan level 7 (82 files).
    - 53 engine tests passed (19 new), and both npm audits found 0 vulnerabilities. Two mutation checks failed exactly their target tests.
    - A 12-check browser probe and a callback-listener probe ran against the real task image on a network without internet access. They found and fixed a poll/session race that hid inline errors.
    - **Not yet done:** the live sign-in with a real account, a real test reply, persistence across a restart and a refresh after expiry. The 3.1 checkbox stays open until then. See [docs/validation.md](docs/validation.md) and [docs/provider-matrix.md](docs/provider-matrix.md).
- User-requested additions on 24 October 2026:
    - **Chat.** The sidebar groups conversations into Today, Yesterday, Previous 7 days and Older. Conversations can be deleted one at a time (menu or header) or several at once (Select, Select all, Delete selected), after confirmation.
        - `DELETE /api/chat/conversations/{id}` and `DELETE /api/chat/conversations` (bulk, own IDs only) delete permanently through `ConversationDeletion`.
        - Deletion cancels a reply still being written for that conversation and frees the reply slot. The relay ends a vanished conversation's stream with `conversation_deleted`.
    - **Connections.** It moved from Settings to its own page (`/connections`) in the main menu and the chat sidebar; the old address redirects.
        - It now offers OpenCode Go and OpenCode Zen through the user's OpenCode API key. A signed `PUT /internal/connections/{id}/key` stores the key encrypted in the engine.
        - **Use for chat** stores a connected account and model on the user (`users.chat_connection_id`, `chat_model`; one additive migration). Task 3.2 is to read it.
        - `SubscriptionConnections` became `ProviderConnections`, configured by `assistant.connection_providers`.
- Additions verification:
    - `composer ci:check` passed with 210 Laravel tests / 1107 assertions (25 new), 21 frontend unit tests (3 new), Pint (119 files) and PHPStan level 7.
    - 55 engine tests passed. A 13-check browser probe ran against the real engine image without internet access and covered the date sections, single, header and multi-select deletion, persistence, navigation, OpenCode key validation and storage, the test-message failure, the chat choice and key removal.
    - See [docs/validation.md](docs/validation.md).

- Review on 24 October 2026: the two implementation commits already had descriptive messages and the approved human identity. The existing `composer ci:check` passed with 210 Laravel tests / 1107 assertions and 21 frontend tests; all 55 engine tests passed. A code review found that account deletion removed database records without clearing engine credentials. Fixed in `ac5a7f9`: disconnect every owned supported-provider record first, require confirmed removal, and preserve the account/session if cleanup fails. Four new regression cases pass within 32 targeted account/connection tests / 342 assertions; changed-file Pint and PHPStan also pass. Signed live connectivity and the applied migration status were verified without making a provider request. See [docs/validation.md](docs/validation.md) for the review's scope and limits.

## Resume this checkout

Authoritative location: `C:\Users\e\Documents\Laravel- Projects\Chatbot`. Use PowerShell with Docker Desktop's Linux engine running. PHP/Composer/Node commands should run in the project containers; do not switch to the host's different Node version.

```powershell
git status --short
docker compose up -d --wait --wait-timeout 120
docker compose ps
docker compose exec --user sail laravel.test php artisan agent:check
```

**Once per existing checkout after task 2.2:** `.env` needs `AGENT_REQUEST_SIGNING_KEY` (at least 32 characters; `./scripts/setup.ps1` generates one), and the engine needs `docker compose up -d --build agent` to pick up the key, the `contracts/` mount and its updated image. Until then, health reports `requestAuth: not_configured` and run endpoints return 503.

**Once per existing checkout after task 2.4:** install the new frontend packages and rebuild, then rebuild the engine so it runs simulations and serves event streams:

```powershell
docker compose exec --user sail laravel.test npm ci
docker compose exec --user sail laravel.test npm run build
docker compose up -d --build agent
```

**Once per existing checkout after task 3.1:** add `AGENT_CREDENTIAL_KEY` to `.env`; `./scripts/setup.ps1` generates it, or use at least 32 random characters, and keep it stable. Then recreate the engine, which publishes `127.0.0.1:1455` and creates the `agent-data` volume, and rebuild the frontend:

```powershell
docker compose up -d --build agent
docker compose exec --user sail laravel.test npm run build
docker compose exec --user sail laravel.test php artisan agent:check   # providerAuth: configured
```

**Once per existing checkout after the 24 October additions:** run the new migration, rebuild the engine (OpenCode providers and the key endpoint) and rebuild the frontend:

```powershell
docker compose exec --user sail laravel.test php artisan migrate
docker compose up -d --build agent
docker compose exec --user sail laravel.test npm run build
```

Open [the login page](http://localhost:8080/login), then [the chat page](http://localhost:8080/chat) or [Connections](http://localhost:8080/connections). Register your own local account if needed. Email is not delivered: the verification link is written MIME-encoded to `storage/logs/laravel.log`; [setup](docs/setup.md#service-boundary-and-state) explains how to read it and that it must be opened on the same host you signed in on. For first-time installation or a missing dependency tree, use `./scripts/setup.ps1`; normal continuation does not require reinstalling dependencies.

```powershell
# Optional frontend hot reload; keep this terminal open.
docker compose exec --user sail laravel.test npm run dev

# Checks after relevant implementation changes.
docker compose exec --user sail laravel.test composer ci:check
docker compose exec --user sail laravel.test npm run build
docker compose exec agent npm test

# Routine shutdown preserves database data.
docker compose down
```

Laravel is on loopback port 8080; Vite uses 5173 when started. MySQL is internal at `mysql:3306`; the engine is internal at `http://agent:3101`, and only its sign-in callback is published, on `127.0.0.1:1455`. Health reports `providerAuth` (`configured` once the engine has its credential key), `requestAuth` and `simulation`. Existing local secrets stay in ignored `.env`; preserve the application key and MySQL volume. Do not use `docker compose down -v` for routine shutdown.

## Next: finish 3.1, then 3.2

The remaining 3.1 step needs the operator; nothing in the repository can substitute for it.

1. On [Connections](http://localhost:8080/connections), sign in with an eligible ChatGPT account, or paste an OpenCode API key into the Go or Zen card.
2. Choose **Send test message**. ChatGPT tests default to `gpt-5.4-mini`; OpenCode tests default to the free `beam-free`. Try another model if the provider refuses it.
3. Run `docker compose restart agent` and confirm the page still shows **Connected**, which proves persistence.
4. After the access token's expiry time, shown on the page, send another test message. A successful reply means the refresh works.
5. Record the dates and outcomes, but no tokens or personal data, in [docs/provider-matrix.md](docs/provider-matrix.md). Then check 3.1 in the Build Plan.

**Acceptance (3.1):** a live request succeeds; credential persistence and expiry/re-authentication behavior are checked.

Before task 3.2 sends real replies, widen `messages.content` (currently MySQL `TEXT`, 65,535 bytes) with an additive migration; the event contract allows final answers of 200,000 characters. Task 3.2 then replaces the simulation in `agent-service/src/server.ts` (`execute()`) with a fresh Pi Agent per run that emits the same contract events; the relay, page and tests stay as they are. Its model access comes from the run's `connectionId` through `ConnectionManager`'s per-connection `Models` (the same vault, so refreshes stay serialized). `RunRequestFactory` should then take the provider, model and connection from the user's chat choice (`users.chat_connection_id`, `chat_model`), falling back to the built-in profile when none is chosen. It already requires an owned connection with status `connected`. The engine must admit `openai`, `opencode` and `opencode-go` runs only with the run's own connection.

## Remaining work in order

| Tasks   | Remaining result                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| 3.1–3.5 | Live-check the ChatGPT sign-in (start here), real Pi streaming, sample lookup tool, bounded history and Stop |
| 4.1–4.4 | Durable runs/events, claims, idempotency and transactional final saves                                       |
| 5.1–5.4 | SSE replay, cancellation races, recovery scheduler, capacity and queue deadlines                             |
| 6.1–6.3 | Foundation regression checks, measurements, integrated demo and pristine-checkout setup validation           |
| 7.1–7.3 | First purpose and authorized connector, after the purpose is selected                                        |
| 8.1–8.4 | Production images, serving/supervision, backup/restore and deployment acceptance                             |

Use the build plan's individual acceptance checks; this table does not replace them. Phase 3 requires supported, authorized provider access. Account and model eligibility are still unverified; do not infer that a healthy engine or a "Connected" badge can make a live request, and never silently substitute another billing/authentication path.

## Boundaries and open items

- Laravel owns users, permissions and durable MySQL state. Node/Pi owns active model/tool execution; it does not write the application database directly. Browser application requests go through Laravel.
- Preserve the agreed Pi architecture. Redis, another agent framework, vector storage, WebSockets and a queue worker are not Phase 2 prerequisites.
- User-message writes are not idempotent: a repeated successful message POST appends again. Replies avoid duplicates differently: a run starts only for an unanswered user message, and each run's reply is saved once. Concurrent append load testing remains unverified.
- The engine executes admitted runs as simulations; its admission record and events are process-local (256 runs, 2,000 events each, 15 minutes) and are lost on restart. Laravel's durable claims and event store in tasks 4.2–4.3 become the authority. Signed requests could be replayed within the 60-second window; that is tolerated because admission, cancellation and reading are idempotent. Overlapping-key rotation is not implemented.
- Until tasks 3.2–3.3, the engine admits only the `simulated` provider, and only with `AGENT_SIMULATION_ENABLED=true`, which development Compose sets explicitly. It refuses every capability. Only a connection with status `connected` may back a live model. Since task 3.1, a successful sign-in sets that status, and disconnecting or a failed refresh clears it.
- ChatGPT sign-in limits:
    - One sign-in runs at a time engine-wide, because OpenAI fixes the callback port. Sign-ins in progress are lost on an engine restart; stored ones survive.
    - Port 1455 must be free on the host, or the engine container cannot start. The Codex CLI also uses it during its own login.
    - Disconnecting removes the tokens from the engine only; revoking at OpenAI is the user's step.
    - Changing `AGENT_CREDENTIAL_KEY` makes stored sign-ins unreadable. `docker compose down -v` deletes them.
    - Within the Compose network, other containers can reach the callback listener during a sign-in.
    - An OpenCode API key crosses browser → Laravel once on its way to the engine; Laravel never stores, logs or flashes it. Use HTTPS outside local development.
    - See [docs/connections.md](docs/connections.md).
- Conversation deletion is permanent (no trash or undo); messages go with their conversation through the foreign key.
- Account deletion now clears owned provider credentials first. An account with supported-provider records needs the engine to confirm removal; if a later cleanup fails, the account remains available for retry but earlier connections stay disconnected. No provider-side revocation is implied.
- The Stage A relay saves a reply only while some reader follows its stream; opening the conversation within about four minutes resumes and saves a run whose stream was never opened. Each open stream occupies one PHP CLI server worker (four in development). Laravel sends no heartbeats to the browser yet, which matters behind proxies. An engine restart mid-reply surfaces as a failed reply rather than a detected interruption. Phases 4–5 replace these limits.
- `messages.content` is MySQL `TEXT` (65,535 bytes); widen it before real replies (see the next task).
- Physical iOS/Android keyboards, real IMEs and screen readers have not been checked; the browser probes are not part of CI yet (a candidate for task 6.1) and are kept in ignored `.setup/`. The `interactive-widget=resizes-content` viewport hint helps Chrome on Android keep the composer above the keyboard; Safari ignores it with a console note.
- Development requests are slow because PHP's CLI server runs with `opcache.enable_cli=0` on the Windows bind mount. Enabling OPcache in a probe server cut warm requests from about 3.6 s to 220–440 ms. Consider enabling it for development in `docker/php/php.ini`; it was not changed. The chat page bundle is 58 kB gzip, mostly Markdown parsing; measure before splitting it.
- Windows bind mounts were slow: the frontend build took about 156 seconds. A future move of the single authoritative checkout to Ubuntu's Linux filesystem is the main optimization suggestion. Ubuntu's initial user/Docker integration setup remains separate from the working PowerShell/Compose path.
- The optional `fontaine` warning is non-fatal; fonts build and render. No new dependency was added just to silence it.
- CI is configured for pushes to `main` and `development`, and for pull requests. Remote CI results have not yet been verified. A pristine-checkout run of the complete setup script, live provider tests, real mail delivery, physical passkey enrollment, production deployment and backup/restore are not verified.
- `.setup/` contains ignored downloads, temporary probes and dependency backups. It is not application source and is not included in a new clone. The persistence probe fixture was cleaned up.

## Git branches and contributor requirements

Latest published implementation checkpoint: **`82497ae` — Stream simulated replies through a Stage A Laravel relay** (task 2.4). Task 2.3 is **`89ff7a1` — Add the chat page with conversation sidebar and composer**. These tasks were developed on temporary worktrees and fast-forwarded into local `development`. On 23 October 2026, the user authorized publication after the attribution review: both remote branches received these commits and the review record `aded851` in one atomic push, preserving their history and messages.

Published implementation checkpoints: **`2e8b62d` — Add signed private engine contract and gateway** (task 2.2), recorded in `8e29e53`, and **`4484b3a` — Add owned chat history and provider connection records** (task 2.1), recorded in `8671079`. Their publication review is `c19321c`; `97ab480` then removed local tool settings from Git tracking. Their original history and messages were preserved.

Local implementation checkpoints: **`d7bad7e` — Connect ChatGPT subscriptions through the engine's sign-in**, **`09da496` — Add chat deletion, date sections and OpenCode connections**, and **`ac5a7f9` — Remove provider credentials before deleting an account**. The first two commits were already present when this review began and were preserved. The temporary task 3.1 worktree has been removed. This session adds the tested cleanup fix and a review/documentation record on `development`; none of these changes has been pushed. `main` and the recorded remote branches remain at `97f5afc`.

This checkout's ignored `.env` already received a generated `AGENT_REQUEST_SIGNING_KEY`, and the engine image was rebuilt. On the running services, `php artisan agent:check` passes, and the engine and Laravel suites pass inside their containers.

The initial snapshot is **`6736ac6` — Set up Laravel React development foundation**, with checkpoint documentation in `59fcdab`, contributor-policy enforcement in `804a379` and remote configuration documentation in `e4b9c7f`. It includes the application, all three lockfiles, setup/validation documents and this handoff. On 22 October 2026, the user explicitly authorized publication to [the GitHub repository](https://github.com/EnrieJohn31/Personalize_Chatbot). All four existing commits were pushed successfully to both `main` and the new `development` branch with their messages and history preserved. `origin` points to `https://github.com/EnrieJohn31/Personalize_Chatbot.git`; both branches track their matching remote branches.

Continue application work on `development`; `main` now includes all of Phase 2 (tasks 2.1–2.4). Both branches use the same CI checks. Use `git branch -vv`, `git log --oneline` and `git remote -v` to inspect the current state. Branch protection is not configured, and remote CI results have not yet been verified.

Use descriptive commit messages and the configured human Git identity, `EnrieJohn31`. Do not add AI names, product/brand identities, generated-by attribution or co-author trailers to contributor metadata. Publication of the reviewed tasks 2.3–2.4 and their review documentation was explicitly authorized and completed. Subsequent application work stays in local commits until the user requests another publication. Do not change remotes without a user instruction.

This policy is tracked in `AGENTS.md` and imported by `CLAUDE.md`; local, ignored `.claude/settings.json` disables automatic attribution and session links. The active `.githooks/commit-msg` hook requires an approved human author/committer and rejects co-authors/common AI signatures. On a fresh checkout, run `./scripts/install-git-hooks.ps1` before committing and recreate the local attribution settings as documented in [commit policy](docs/commit-policy.md), which also covers tests, CI auditing and enforcement limits. Ten local hook cases passed during policy setup; the complete-history audit passed again before publication. Finishing task 3.1's live check is next; tasks 2.1–2.4 are published and task 3.1 is local until publication is requested.

Repository housekeeping on 23 October 2026: at the owner's request, `.gitignore` now excludes the entire `.claude/` directory, including its previously tracked settings file. The settings file remains on this machine with attribution disabled; it is removed only from Git tracking. Verified the ignore rule, empty tracked-directory listing, preserved local settings and staged diff. Application tests were not rerun for this configuration/documentation change. Publication review remains recorded in `c19321c`; this follow-up does not change the next implementation task.

Pre-push attribution review on 23 October 2026: all 13 existing commits passed the complete-history audit. Both new implementation commits use `EnrieJohn31 <enriejohnedem@gmail.com>` as author and committer. Scanned the tracked project files and the added lines in both commits, covering all 62 changed files; no prohibited contributor credit, co-author trailer, authorship signature or session link was found. Product references explain provider integration, policy or dependencies and do not claim contributor credit. Effective Git identities are approved, `core.hooksPath` remains `.githooks`, and the approved identities, hook scripts and policy settings are unchanged. `.claude/` remains ignored and untracked; its local commit/PR attribution and session links remain disabled. Tracked-path checks found no `.env`, `.setup/`, dependency directories or generated build output. Corrected the stale implementation checkpoint and push-authorization text above. This session checked attribution and handoff consistency; application/browser tests were not rerun, and the earlier implementation results remain dated evidence. No push was performed.

Publication checks on 23 October 2026: fetched both remote branch tips, confirmed the working tree was clean and each remote branch was exactly three commits behind the reviewed `development` tip, reran the full attribution audit, and verified `.claude/` was absent from the tree being published. `main` advanced by fast-forward and the atomic push succeeded for both branches. Only publication documentation changed in this session; application/browser tests were not rerun and remote CI results remain unverified.

Contributor review on 24 October 2026: the full history audit passed, including the original 17 commits and the cleanup fix. Checked the added lines across the two implementation commits (90 changed files), the new fix, author/committer identities and policy configuration. No prohibited AI/vendor contributor credit, co-author trailer or authorship signature was found. Provider names and model IDs are technical references, not contributor attribution. `core.hooksPath` remains `.githooks`; approved identities and hook rules are unchanged. `.claude/` is ignored and untracked, and its local attribution/session-link settings remain disabled. Tracked-path checks found no `.env`, downloaded dependencies or generated build directories. The current request authorizes local review/fix commits only; publication needs a new user request.

Before future commits, review `git status` and the staged file list. Keep `.env`, credentials, `.setup/`, dependencies, build output and database data out of Git. The initial snapshot was checked for these exclusions. Commit changed source, lockfiles and documentation together as appropriate, and update this handoff with the implementation commit reference.

## Suggested continuation request

```text
Read handoff.md, Blueprint.md and Build_Plan.md in this repository.
Confirm the current Git and Docker state; preserve the existing local history.
Continue on development, which tracks origin/development.
Task 3.1's ChatGPT sign-in is implemented; I have signed in on the Connections page
and will report the test-message result. Record login, persistence, refresh and
re-authentication results in docs/provider-matrix.md (no tokens or personal data), then
implement task 3.2: real Pi replies through the user's connection, after widening messages.content.
Never copy host credentials or fall back to API keys.
Run the relevant checks, document actual results and update the build plan and handoff.
Commit locally with descriptive messages using the configured human identity;
do not add AI/brand contributor attribution or push to a remote.
```

After each work session, update the stopping point, checks actually run, remaining blockers, local commit reference and next task in this file. Keep the blueprint and build-plan status consistent with it.
