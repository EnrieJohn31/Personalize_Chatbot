# Build Plan: Laravel + Pi Chatbot

Updated: 24 October 2026\
Version: 13\
Companion: [Blueprint.md](Blueprint.md), revision 15; [handoff.md](handoff.md) for the continuation record\
Status: Phases 0–2 complete. Owned history, a signed Laravel-to-Pi boundary, the chat page and simulated replies streamed through Laravel are implemented. Task 3.1's connections are implemented: ChatGPT sign-in, OpenCode Go/Zen keys, an administrator-configured local model server, an encrypted credential store and a chat choice recorded per conversation. The live check with a real account is pending. The user also asked for chat deletion and date sections, which are implemented. See [history endpoints](docs/chat-history.md), [engine contracts](contracts/README.md), [chat page and replies](docs/chat-ui.md), [connections](docs/connections.md) and [validation](docs/validation.md).

## Start here

Build a reusable chatbot foundation with Laravel, React/Inertia, TypeScript, shadcn/ui, Lucide, MySQL and a private Node/Pi engine. Use Docker Compose/Sail for development. Keep Pi as the engine throughout this plan.

**Next task: finish 3.1 — the operator connects a real ChatGPT or OpenCode account (or a real local model server) on the Connections page and sends a test message; then 3.2, which makes chat use each conversation's recorded connection.** Work in order, completing one numbered task at a time. Each task has a concrete result and a completion check. If a task grows too large for one focused coding session, split it into subtasks under the same ID.

Use **Blueprint.md for design decisions** and **this file for work order and progress**. Update both when a decision changes. Read the relevant blueprint sections before each phase; there is no need to reproduce the entire architecture in every task.

Read [handoff.md](handoff.md) when resuming: it records the stopping point, verified checks, local commit checkpoint, startup commands and the next task's acceptance criteria.

The existing reference documents are enough to start. Use invented data and one sample lookup tool. Live provider testing will need a supported sign-in or locally configured credential. A future business connector needs its own access only when Phase 7 begins.

## Route from setup to release

| Phase | Result | Blueprint sections |
| --- | --- | --- |
| 0 | Project location and initial choices recorded | 1, 3, 5 |
| 1 | Laravel, MySQL and Pi development containers run | 3, 13, 14 |
| 2 | Signed-in chat shell and simulated response work | 4, 7, 10, 13 |
| 3 | One real provider and sample tool work through Pi | 5, 6, 9, 12 |
| 4 | Runs, events and final answers are durable | 8, 10, 12 |
| 5 | Reconnect, Stop, restart and capacity behavior work | 8, 9, 11, 12, 14 |
| 6 | Reusable foundation passes its release checks | 6, 11, 14 |
| 7 | A chosen purpose has one useful connector | 9, 15 |
| 8 | Production packaging and operating instructions are ready | 14, 16 |

Phases 0–3 deliver **Stage A: the connectivity prototype**. Phases 4–6 deliver **Stage B: the reliable foundation**. Phase 7 can wait while the future purpose is undecided. Phase 8 can package the general foundation after Phase 6, or include the first purpose after Phase 7.

## Phase 0 — Prepare the work

**Needs:** a writable development location. Use the temporary name `assistant-foundation` unless another name has been chosen.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [x] | 0.1 | Create or select the project folder/repository. Place these two documents together and record the development OS. | The project location is recorded and existing unrelated files are preserved. |
| [x] | 0.2 | Select compatible Laravel/PHP/Node/Pi versions. Record them in `docs/runtime-versions.md`; commit generated lockfiles during setup. | Exact intended versions and their compatibility sources are recorded. Kairo's historical Pi version has not been assumed current. |
| [x] | 0.3 | Record the first provider/authentication path and its connection owner in `docs/provider-matrix.md`. Default to one operator with one user-owned connection. | The path is marked **unverified** until task 3.1 passes; secret values are absent from the document. |

**Checkpoint:** the build has a location and initial choices. Lack of live credentials does not prevent Phases 1–2 or simulated engine work.

## Phase 1 — Bring up the development environment

**Needs:** Phase 0 and a working Docker environment. On Windows, follow the blueprint's WSL2 setup.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [x] | 1.1 | Scaffold Laravel with its React starter. Confirm Inertia, TypeScript, Tailwind, shadcn/ui and Lucide. | The application builds and its starter login page loads. |
| [x] | 1.2 | Configure Sail/Compose and MySQL, run starter migrations and persist database data. | The app connects to MySQL; a normal container restart preserves a test account. |
| [x] | 1.3 | Add `agent-service/`, its TypeScript/Pi dependencies, Dockerfile and private health endpoint. Document actual dev/build/test scripts. | Laravel reaches the engine by Compose service name; the engine port is not published to the host. |

**Checkpoint:** a documented local startup brings up the application, database and engine. `.env.example` contains placeholders; actual secrets stay outside source control.

## Phase 2 — Build the shell and service boundary

**Needs:** Phase 1. Use simulated provider responses here.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [x] | 2.1 | Add owned conversations/messages and non-secret provider connection records. | An authenticated user can save/load their sample history; another user cannot read it. |
| [x] | 2.2 | Define versioned request/event schemas in `contracts/` and implement private service authentication through `AgentGateway`/`PiGateway`. | A fake request crosses the boundary; invalid authentication and invalid payloads are rejected. |
| [x] | 2.3 | Build the chat page: sidebar, transcript, composer, theme and labelled Lucide actions. | Desktop/mobile layout works; Enter, Shift+Enter and IME input behave correctly. |
| [x] | 2.4 | Connect a simulated text stream through Laravel and one React hook. | Text arrives incrementally, safe Markdown renders, and the final event replaces draft text without duplication. |

**Checkpoint:** the complete UI-to-engine path works with deterministic sample events. Mark any temporary relay as a Stage A prototype. Keep simulation explicitly configured for development/testing.

## Phase 3 — Prove one real Pi conversation

**Needs:** Phase 2. Task 3.1 requires the operator's supported authentication. Do not paste credentials into project documents.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 3.1 | Implement the chosen Pi provider's supported login/credential-store integration in the container. | A live request succeeds; credential persistence and expiry/re-authentication behavior are checked. Record refresh behavior as verified or still untested. |
| [ ] | 3.2 | Construct a fresh Pi Agent per run and map its text/error events into the application protocol. | A real answer streams through Laravel; auth and provider errors appear as honest outcomes. |
| [ ] | 3.3 | Register `lookup_reference` with a schema, permission, timeout and size limit against invented fixtures. | Pi calls it, receives a matching result and answers using that result; denied access and invalid arguments do not execute the lookup. |
| [ ] | 3.4 | Load the permitted canonical transcript and enforce context, output, model-round and tool budgets. | A follow-up remembers the relevant history, and an oversized case gets bounded handling rather than an uncontrolled request. |
| [ ] | 3.5 | Connect the prototype Stop action to Pi and the tool/provider abort signal. | Later steps stop; active-call cancellation delay and any transport limitation are recorded. |

**Stage A checkpoint:** one real provider, one tool, streaming, follow-up context and Stop work together. Use an authenticated server-side save for basic history; Phase 4 will make execution and completion durable independently of the browser.

Keep the model and connection fixed within a run. Verify the selected release's current authentication API before adapting the historical Codex code. Start with one verified provider entry; additional providers get their own compatibility checks.

## Phase 4 — Make execution durable

**Needs:** the Phase 2 contracts and the Stage A engine. The state machinery can be developed with simulations if live authentication is temporarily blocked, but the Stage A live check remains required before release.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 4.1 | Add `chat_runs`, `chat_run_events`, lifecycle constraints and transactional admission with an idempotency key/request hash. | Repeated Send produces one run; a conflicting reuse of the key is rejected. |
| [ ] | 4.2 | Implement the short handoff and Laravel claim endpoint with an attempt token and atomic capacity checks. | Only one eligible attempt claims a run, even with concurrent duplicate requests. |
| [ ] | 4.3 | Persist ordered, bounded event batches and heartbeats through authenticated Laravel callbacks. | Retrying a batch adds no duplicate events; an unauthorized or stale attempt cannot write. |
| [ ] | 4.4 | Commit the final message, terminal state and completion event in one Laravel transaction. | Closing the browser does not prevent healthy execution/final save; a failed transaction does not publish success. |

**Checkpoint:** MySQL/Laravel owns durable state. Node owns active execution. Browser subscriptions and the PHP admission request do not own the run's lifetime.

## Phase 5 — Handle reconnects, failures and waiting work

**Needs:** Phase 4.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 5.1 | Implement authorized SSE replay with event IDs, a reload cursor and saved-status fallback. | Refresh/reconnect shows one answer and causes no second model/tool execution; expired replay falls back to saved history. |
| [ ] | 5.2 | Add persisted cancellation and atomic Stop/completion race handling. | Queued work cannot start after cancellation; pending Stop accepts a cancellation acknowledgement; late Stop leaves a completed run completed. |
| [ ] | 5.3 | Add a Compose scheduler process and bounded reconciliation/retention commands. | An engine crash becomes `interrupted` within the documented detection bound; missed unclaimed work is redispatched; terminal replay expires on schedule. |
| [ ] | 5.4 | Enforce pending-run limits, waiting order/deadlines and explicit busy responses. | A full queue gives clear feedback; expired waiting work is never claimed; existing valid idempotent requests still resolve to their run. |

**Checkpoint:** simulated disconnect, duplicate submission, service restart and capacity exhaustion produce predictable results. The scheduler is actually running; a PHP dispatch queue remains optional.

Use the blueprint's starting limits: one nonterminal run per user, one active engine run, four globally waiting runs, a 300-second queue deadline and a separate 180-second execution deadline. These are configurable prototype bounds, not measured throughput promises.

## Phase 6 — Verify the reusable foundation

**Needs:** Phases 3–5, including the live connection check.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 6.1 | Gather the focused Laravel/Node checks into repeatable project commands and CI, using simulated providers by default. | Ownership, callback authentication, denied tools, stale claims, cancellation, replay and final persistence checks pass with meaningful failure cases. |
| [ ] | 6.2 | Measure no-tool and one-tool workloads plus a small controlled concurrency test. | First text, completion time, memory, reporting load and SSE occupancy are recorded; an open stream does not block Stop/login requests. |
| [ ] | 6.3 | Run the integrated foundation demo and document setup/troubleshooting. | A fresh checkout follows the instructions successfully; observed limits and provider test status are recorded. |

**Stage B checkpoint:** the reusable chatbot foundation works. The future purpose may remain undecided. Record results in `docs/validation.md` and update `docs/provider-matrix.md`; distinguish mock checks from actual live-provider observations.

Do not add Redis, another agent framework, vector storage or WebSockets merely to complete this phase. Introduce a dependency when a measured problem or selected feature requires it.

## Phase 7 — Add the chatbot's first purpose

**Needs:** Phase 6 plus a chosen purpose. This phase is deferred until that purpose is known.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 7.1 | Write one assistant profile with its instructions, permitted tools and a small set of example questions/expected findings. | Its scope, source requirements and unavailable-data behavior are clear. |
| [ ] | 7.2 | Implement one authorized, read-only connector and its typed tool. | Allowed records are retrieved with source metadata; denied records cannot leak through results or caches. |
| [ ] | 7.3 | Run the purpose examples, including missing data, denied access and a source outage. | Answers use available evidence and report gaps honestly; results are saved as regression examples. |

**Checkpoint:** one purpose is useful end to end. Add more connectors or workflows in separate small tasks using the same pattern. Uploads, Office generation and broad MCP catalogs can follow when required.

## Phase 8 — Prepare deployment and handover

**Needs:** Phase 6, and Phase 7 if this release includes its purpose. Actual deployment also needs a destination, domain/TLS configuration and locally supplied access credentials.

| Done | Task | Small piece of work | Done when |
| --- | --- | --- | --- |
| [ ] | 8.1 | Build production Laravel/Node release images with compiled assets and pinned dependencies. | Release startup succeeds without development mounts, watchers, debug mode or Vite HMR. |
| [ ] | 8.2 | Configure Nginx/PHP-FPM, private service access, persistent volumes, health checks and the scheduler. | Application traffic and SSE work; internal endpoints stay protected; each required process is supervised. |
| [ ] | 8.3 | Exercise backup/restore and a bounded engine shutdown/restart in the release environment. | Chats and credential state can be recovered with the required keys; active work ends with a truthful state and can be retried explicitly. |
| [ ] | 8.4 | Run release acceptance and write the deployment/rollback runbook. Deploy when a destination has been selected. | Login, provider, lookup, history, Stop and reconnect work in the deployed environment; the release version and operating steps are recorded. |

**Release checkpoint:** a reproducible build, an identified deployment and verified operating procedures exist. Keep this phase open if only local packaging has been completed.

## Working one task at a time

For each task: implement its result, run the relevant completion check, record evidence and update the checkbox. Keep unrelated improvements in a later-task note. If a prerequisite is unavailable, record the blocker and continue only with work that does not depend on it.

Use this request when handing a task to a coding assistant:

```text
Read handoff.md, Blueprint.md and Build_Plan.md in the project.
Implement task <ID> and the necessary small supporting changes.
Follow the existing repository instructions and agreed Laravel/Pi stack.
Run the task's completion check and report what was actually verified.
Update the checkbox only when the check passes.
Record changed files, remaining limitations and the next task; refresh handoff.md.
```

Keep a short progress record here as implementation proceeds:

| Field | Current value |
| --- | --- |
| Current task | 3.1 — implemented (ChatGPT, OpenCode, local model server); waiting for the operator's live test message. Task 3.2's preparation is done |
| Last completed task | 2.4 — simulated reply stream through Laravel and one React hook (Phase 2 complete) |
| Actual checks run on the application | Stale-chat fix on 24 October: `composer ci:check` checks and 232 Laravel tests / 1332 assertions, 25 frontend tests, and a 9-check browser probe (4/9 before the fix, 9/9 after) passed. Engine unchanged (61 tests at the publication review) — see docs/validation.md |
| Git checkpoint and branches | Local, not pushed: "Keep deleted chats from reappearing after navigation" on `development`. Last published to both `main` and `development` on 24 October: local model and chat preparation `917cd5e`, then PHP timestamp rechecking `ea3be49` |
| Known prerequisite for live tests | The operator's eligible ChatGPT account or OpenCode key connected on the Connections page, or a running local server set as `LOCAL_LLM_URL` |
| Next checkpoint | Task 3.1: a live test message succeeds; then record persistence across an engine restart and refresh after the token expires. Then task 3.2 |

For each completed task, append: `ID — result — verification/evidence — remaining issue, if any`. Record a commit reference when working in Git. Checkboxes remain open for partially implemented or unverified behavior.

### Progress — 22 October 2026

- 0.1 — Selected the existing `Chatbot` folder and initialized a local `main` repository — both original documents remain in place; Windows/WSL/Docker inventory is recorded in `docs/runtime-versions.md` — no application code or Git commit yet.
- 0.2 — Selected Laravel 13.38.0, PHP 8.4.27, Node 24.22.1 and Pi 1.4.0; downloaded initial runtimes and source archives — official package requirements and runtime version commands checked; checksums recorded in `docs/downloads.json` — dependency resolution/build remains in Phase 1; generate and commit lockfiles with tasks 1.1 and 1.3.
- 0.3 — Recorded one operator-owned OpenAI/ChatGPT sign-in path — `docs/provider-matrix.md` explicitly records no live verification and no credentials — eligible registration/account, model choice and live checks remain in task 3.1.
- Phase 1 prerequisites — Docker runs, PHP/Composer/Node/MySQL checks pass, Ubuntu 24.04.5 is installed in WSL2, and all five downloads pass checksum verification — see `docs/setup.md` — Ubuntu initial user setup and Docker integration remain; application, database and engine integration have not been implemented or tested.

- 1.1 — Scaffolded the pinned official React starter with Laravel 13.38.0; installed dependencies and built frontend assets — TypeScript passes, browser login renders without console errors, and Composer validation passes — Vite+ was updated to 1.3.0 to resolve upstream dependency advisories; lockfiles record the result.
- 1.2 — Added a Sail-compatible pinned PHP image, Compose/MySQL configuration and repeatable PowerShell setup — all five migrations passed; a randomly named temporary account survived `docker compose restart mysql` and was removed afterward — the Windows checkout remains authoritative; Linux-filesystem relocation is an optimization, not a startup requirement.
- 1.3 — Added the separate TypeScript/Pi service and lockfile — three service tests pass, Laravel receives its health response through `agent:3101`, all containers are healthy, and Docker reports no engine host port binding — provider authentication remains unconfigured as planned.
- Handoff — Added `handoff.md`, linked the planning documents and corrected the outdated current-progress table — documentation checked against the source tree, validation record and Git state; initial local snapshot saved as `6736ac6` — task 2.1 is next.
- Contributor policy — Added tracked repository/tool instructions, disabled automatic attribution, enabled a local Git hook and added a CI history audit — ten real-commit fixture cases and the existing-history audit passed; see `docs/commit-policy.md` — task 2.1 remains next; remote branch protection is not configured.
- Repository connection — Configured `origin` from the user's supplied `EnrieJohn31/Personalize_Chatbot` GitHub URL — read access verified and no published references returned at connection time — publication was deferred until the user's later explicit request.
- Repository publication — Pushed all four existing commits and their messages to `main` and the new `development` branch at the user's request; both track their matching origin branches — the existing-history attribution audit passed and ignored credentials/dependencies were excluded — enabled CI for development pushes and updated the handoff; remote CI results remain unverified, branch protection is not configured, and task 2.1 remains next.

### Progress — 23 October 2026

- 2.1 — Added owned history/connection metadata, policies, validated session routes, explicit public resources, bounded pagination and transactional user-message appends — ownership/forgery/pagination/rollback tests and separate MySQL checks are recorded in `docs/validation.md`; existing users were preserved and Laravel/Pi health still works — changes are committed locally on `development`; task 2.2 is next, with no chat UI or live provider execution yet.
- 2.2 — Added strict v1 schemas and examples in `contracts/`, HMAC-signed `AgentGateway`/`PiGateway` calls, an ownership-checked `RunRequestFactory`, engine-side authentication/validation/idempotent admission/cancellation and `php artisan agent:check` — 58 new Laravel tests and 22 engine tests pass; a live probe between real containers accepted a signed fake run, reported a duplicate, rejected a conflicting reuse, an unverified provider and a wrong key, and acknowledged cancellation — no model executes yet, the admission record is process-local, and callbacks/key rotation remain for Phase 4.
- Publication review — Reviewed task 2.2 with no blocking findings; reran the full application checks, 22 engine tests, live signature verification and the complete-history attribution audit. Corrected authentication-order documentation and clarified the pending Laravel admission work. Published tasks 2.1–2.2 to `main` and `development` with their existing history preserved; task 2.3 remains next.
- 2.3 — Added the `/chat` page with a collapsible conversation sidebar (Sheet on mobile), transcript with earlier-message loading, bottom composer, rename, copy and theme actions, sharing the history endpoints through `ConversationRepository` — 6 page tests, 10 composer-rule unit tests and a 31-check browser probe passed, including Enter, Shift+Enter and IME composition in Chromium, Firefox and WebKit and a 390px mobile layout — no assistant replies, streaming or Markdown yet; physical-device keyboards and real IMEs remain unverified.
- 2.4 — The engine executes admitted runs as a deterministic simulation and streams contract events (`GET /internal/runs/{id}/events`). A labelled Stage A Laravel relay admits one reply per user, relays SSE with resumable IDs, saves the final reply once on the server and supports Stop. The page streams through one `use-chat-run` hook with safe Markdown — 35 new Laravel tests, 12 new engine tests and 8 new reducer tests pass. Traces showed live delivery at the engine's pace, and an 11-check browser probe confirmed incremental text, safe Markdown, a single final reply, reload-resume, Stop, saving after the tab closes and mobile — replies are saved only while a reader follows the stream (durability is Phase 4); `messages.content` must widen before long real replies; development request latency suggests enabling OPcache for the CLI server.

### Progress — 24 October 2026

- 3.1 (implementation) — Each user connects their own ChatGPT account on the Connections page through Pi's OpenAI "Sign in with ChatGPT".
  - The engine keeps tokens in a private volume, AES-256-GCM per connection, and never falls back to `OPENAI_API_KEY`.
  - Signed, schema-validated endpoints cover status, sign-in, a pasted redirect, cancel, disconnect and a user-triggered test message.
  - Laravel mirrors only non-secret status into the connection record. The callback port is published on loopback only.
  - Verification: 41 new Laravel tests and 19 new engine tests pass, as do two mutation checks and a 12-check browser probe against the real engine image without internet access. The probe found and fixed a poll/session race.
  - Remaining: checkbox stays open until the operator's live sign-in and test message succeed and persistence and refresh are recorded in docs/provider-matrix.md. Chat replies stay simulated until task 3.2.
- User-requested additions (during 3.1):
  - **Chat sidebar.** Conversations are grouped into Today, Yesterday, Previous 7 days and Older. They can be deleted singly (menu or header) or several at once (select mode). Deletion is permanent, stops a running reply and frees the reply slot.
  - **Connections.** It moved from Settings to its own main-menu page. It adds OpenCode Go and Zen through the user's API key, stored encrypted in the engine like the ChatGPT sign-in, and "Use for chat" stores a connected account and model for task 3.2.
  - Verification: 25 new Laravel tests, 3 new frontend unit tests, engine tests for keys and the OpenCode ambient-key guard (55 total), and a 13-check browser probe against the real engine image without internet access.
  - Remaining: real OpenCode keys are untested, and chat starts using the chosen connection in task 3.2.

- Review correction — Found that account deletion left engine credentials behind. `ac5a7f9` disconnects all owned supported-provider records before deleting the account, requires confirmed removal and preserves the account on failure. Four new regression cases pass within the 32-test targeted run. Existing implementation commits and the complete history pass the contributor policy; local settings remain ignored. Task 3.1's live acceptance remains open.

- User-requested local model connection and pre-3.2 refinements (during 3.1):
  - **Local model server.** An administrator-configured OpenAI-compatible server (`LOCAL_LLM_URL`: Ollama, LM Studio, llama.cpp or vLLM, on the Docker host or the network) is a fourth Connections card, shared by every user and selectable in "Use for chat". Its address is engine configuration only.
  - **Refinements.**
    - Each conversation records the chat choice it started with, which `RunRequestFactory` uses once `ASSISTANT_LIVE_REPLIES` is on.
    - Replies record and show their model; the chat header shows the account and model.
    - Account errors link to Connections.
    - Run starts are limited to 20 per minute.
    - `messages.content` is `MEDIUMTEXT`.
    - CLI OPcache is on in development.
  - Verification: 18 new Laravel tests (232 total), 1 new frontend test, 6 new engine tests (61 total), and a 14-check browser probe against a fake local server (up, stopped, restarted, not configured) without internet access. The probe found and fixed keyless local servers being refused.
  - Remaining: no real local server tested; replies stay simulated until task 3.2.

- Publication — At the user's request, fast-forwarded `main` and atomically pushed the four reviewed commits through `5345421` to both remote branches. Fetched tips showed no divergence; the full contributor audit and diff checks passed, `.claude/` remained excluded, and both remote hashes matched. No application code changed or application tests reran during publication; remote CI results remain unverified.

- Fix (user-reported) — Deleted chats reappeared until a reload, because Inertia reused a prefetched `/chat` and pages restored by Back/Forward that predated the JSON API deletions. Chat API writes and completed Inertia writes now clear the prefetch cache, and a chat page restored from history is fetched again; a deleted chat leads to a new chat with a notice. Back no longer loses recently sent messages either — a browser probe failed 5 of 9 checks before and passed 9/9 after; 3 new frontend unit tests — Firefox/Safari not checked.

Publication review of local model changes on 24 October: no blocking findings across `917cd5e` and `ea3be49`; full application/engine checks and the frontend build passed. The contributor audit passed with approved author/committer identities, unchanged hooks and no prohibited attribution. Both branches were fast-forwarded and pushed atomically; remote hashes matched `ea3be49`. Live provider acceptance remains open, and remote CI results remain unverified.

## Completion boundaries

- **After Phase 3:** a working connectivity prototype with one real provider and one sample tool.
- **After Phase 6:** a reusable chatbot foundation with durable history, Stop, replay and recovery.
- **After Phase 7:** the first specialized chatbot purpose.
- **After Phase 8:** a deployed, checked release with operating and recovery instructions.

The detailed design and source links remain in [Blueprint.md](Blueprint.md). The numbered tasks above are the implementation checklist; they do not claim that Kairo's custom capabilities already exist in the new application.
