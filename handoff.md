# Development handoff

Updated: 23 October 2026. Read this file first when resuming work.

## Where we stopped

**Tasks 2.1–2.2 are implemented. The next implementation task is 2.3, followed by 2.4.** The application provides the Laravel React authentication starter, MySQL persistence, owned history/connection-metadata endpoints, and a signed, schema-validated Laravel-to-Pi admission boundary. The chat page, streaming, model execution and provider login are not implemented yet. See [the history endpoint contract](docs/chat-history.md) and [the engine contracts](contracts/README.md).

| Document                                             | Use it for                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| [Blueprint.md](Blueprint.md)                         | Architecture, ownership, security boundaries and acceptance requirements  |
| [Build_Plan.md](Build_Plan.md)                       | Numbered tasks, completion checkboxes and progress                        |
| [docs/setup.md](docs/setup.md)                       | Installation, daily commands and troubleshooting                          |
| [docs/validation.md](docs/validation.md)             | Dated checks for Phase 1 and tasks 2.1–2.2, with their limits             |
| [docs/chat-history.md](docs/chat-history.md)         | Task 2.1 endpoints, ownership, storage, pagination and limits             |
| [contracts/README.md](contracts/README.md)           | Task 2.2 engine schemas, request signing, admission order and error codes |
| [docs/runtime-versions.md](docs/runtime-versions.md) | Installed versions, image identities and compatibility sources            |
| [docs/provider-matrix.md](docs/provider-matrix.md)   | Intended provider path, ownership and unverified live-access status       |

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

## Resume this checkout

Authoritative location: `C:\Users\e\Documents\Laravel- Projects\Chatbot`. Use PowerShell with Docker Desktop's Linux engine running. PHP/Composer/Node commands should run in the project containers; do not switch to the host's different Node version.

```powershell
git status --short
docker compose up -d --wait --wait-timeout 120
docker compose ps
docker compose exec --user sail laravel.test php artisan agent:check
```

**Once per existing checkout after task 2.2:** `.env` needs `AGENT_REQUEST_SIGNING_KEY` (at least 32 characters; `./scripts/setup.ps1` generates one), and the engine needs `docker compose up -d --build agent` to pick up the key, the `contracts/` mount and its updated image. Until then, health reports `requestAuth: not_configured` and run endpoints return 503.

Open [the login page](http://localhost:8080/login). Register your own local account if needed; email uses the log transport, so the verification link is in `storage/logs/laravel.log`. For first-time installation or a missing dependency tree, use `./scripts/setup.ps1`; normal continuation does not require reinstalling dependencies.

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

Laravel is on loopback port 8080; Vite uses 5173 when started. MySQL is internal at `mysql:3306`; the engine is internal at `http://agent:3101`. Health reports `providerAuth: not_configured`, `requestAuth` and `simulation`. Existing local secrets stay in ignored `.env`; preserve the application key and MySQL volume. Do not use `docker compose down -v` for routine shutdown.

## Next task: 2.3

Read Blueprint sections 7 and 13.5, `docs/chat-history.md` and the build plan's task 2.3. Build the chat page: collapsible sidebar, transcript, bottom composer, theme and labelled Lucide actions, with a Sheet for mobile navigation. Load and save history through the existing `/api/chat` endpoints. Enter sends, Shift+Enter adds a line, and active IME composition must not send. Hide upload controls. No streaming is required in 2.3.

**Acceptance (2.3):** desktop and mobile layouts work; Enter, Shift+Enter and IME input behave correctly. Existing authentication, history and engine checks continue to pass.

Then task 2.4 connects a simulated text stream through Laravel and one React hook:

- Build the run with `RunRequestFactory::forConversation()` and submit it through `AgentGateway`. The engine already admits the `simulated` provider when Compose enables simulation.
- Emit events that match `contracts/v1/run-event.schema.json`, mapped to the browser through Laravel. A temporary relay must be labelled as a Stage A prototype.
- `assistant.final` replaces the draft; it never appends to it. Render Markdown safely with raw HTML disabled.
- Coordinate user-message persistence with run submission, so a retry does not save the same input twice (see `docs/chat-history.md`).
- Any engine-to-Laravel callback needs its own `AGENT_CALLBACK_SIGNING_KEY` using the same signing scheme; never reuse the request key.

## Remaining work in order

| Tasks   | Remaining result                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| 2.3     | Chat UI, keyboard/IME and mobile behavior — start here                                                     |
| 2.4     | Explicitly configured simulated streaming through Laravel and one React hook                               |
| 3.1–3.5 | Verify supported provider login, real Pi streaming, sample lookup tool, bounded history and prototype Stop |
| 4.1–4.4 | Durable runs/events, claims, idempotency and transactional final saves                                     |
| 5.1–5.4 | SSE replay, cancellation races, recovery scheduler, capacity and queue deadlines                           |
| 6.1–6.3 | Foundation regression checks, measurements, integrated demo and pristine-checkout setup validation         |
| 7.1–7.3 | First purpose and authorized connector, after the purpose is selected                                      |
| 8.1–8.4 | Production images, serving/supervision, backup/restore and deployment acceptance                           |

Use the build plan's individual acceptance checks; this table does not replace them. Phase 3 requires supported, authorized provider access. The selected path and model eligibility are still unverified; do not infer that a healthy engine can make a live request or silently substitute another billing/authentication path.

## Boundaries and open items

- Laravel owns users, permissions and durable MySQL state. Node/Pi owns active model/tool execution; it does not write the application database directly. Browser application requests go through Laravel.
- Preserve the agreed Pi architecture. Redis, another agent framework, vector storage, WebSockets and a queue worker are not Phase 2 prerequisites.
- History APIs currently save user text only. No assistant/tool write path, UI, Laravel run admission or message-write idempotency exists yet; a repeated successful message POST appends again. Future Laravel run admission must coordinate persistence to avoid duplicate user messages. Concurrent append load testing remains unverified.
- The engine acknowledges admitted runs but executes nothing yet. Its admission record is process-local (256 runs, 15 minutes) and is lost on restart; Laravel's durable claim in task 4.2 becomes the authority. Signed requests could be replayed within the 60-second window; that is tolerated because admission and cancellation are idempotent. Overlapping-key rotation is not implemented.
- Until tasks 3.1–3.3, the engine admits only the `simulated` provider, and only with `AGENT_SIMULATION_ENABLED=true`, which development Compose sets explicitly. It refuses every capability. Only a connection with status `connected` may back a live model, and no code path sets that status yet.
- Windows bind mounts were slow: the frontend build took about 156 seconds. A future move of the single authoritative checkout to Ubuntu's Linux filesystem is the main optimization suggestion. Ubuntu's initial user/Docker integration setup remains separate from the working PowerShell/Compose path.
- The optional `fontaine` warning is non-fatal; fonts build and render. No new dependency was added just to silence it.
- CI is configured for pushes to `main` and `development`, and for pull requests. Remote CI results have not yet been verified. A pristine-checkout run of the complete setup script, live provider tests, real mail delivery, physical passkey enrollment, production deployment and backup/restore are not verified.
- `.setup/` contains ignored downloads, temporary probes and dependency backups. It is not application source and is not included in a new clone. The persistence probe fixture was cleaned up.

## Git branches and contributor requirements

Current implementation checkpoint: **`2e8b62d` — Add signed private engine contract and gateway** (task 2.2), with environment/checkpoint documentation in `8e29e53`. It was developed on a temporary `task/2.2-agent-gateway` worktree, then fast-forwarded into local `development`; that worktree and branch were removed afterwards. Its author/committer identity and the complete-history attribution audit were verified. The previous checkpoint is **`4484b3a` — Add owned chat history and provider connection records** (task 2.1), recorded in `8671079`. On 23 October 2026, the user authorized review and publication: both remote branches received all four commits through `8e29e53`, preserving history. The following review documentation commit records that publication; use `git log -1` for its reference.

This checkout's ignored `.env` already received a generated `AGENT_REQUEST_SIGNING_KEY`, and the engine image was rebuilt. On the running services, `php artisan agent:check` passes, and the engine and Laravel suites pass inside their containers.

The initial snapshot is **`6736ac6` — Set up Laravel React development foundation**, with checkpoint documentation in `59fcdab`, contributor-policy enforcement in `804a379` and remote configuration documentation in `e4b9c7f`. It includes the application, all three lockfiles, setup/validation documents and this handoff. On 22 October 2026, the user explicitly authorized publication to [the GitHub repository](https://github.com/EnrieJohn31/Personalize_Chatbot). All four existing commits were pushed successfully to both `main` and the new `development` branch with their messages and history preserved. `origin` points to `https://github.com/EnrieJohn31/Personalize_Chatbot.git`; both branches track their matching remote branches.

Continue application work on `development`; `main` now includes tasks 2.1–2.2. Both branches use the same CI checks. Use `git branch -vv`, `git log --oneline` and `git remote -v` to inspect the current state. Branch protection is not configured, and remote CI results have not yet been verified.

Use descriptive commit messages and the configured human Git identity, `EnrieJohn31`. Do not add AI names, product/brand identities, generated-by attribution or co-author trailers to contributor metadata. The current push is explicitly authorized; subsequent work should remain in local commits unless the user requests publication. Do not change remotes without a user instruction.

This policy is tracked in `AGENTS.md` and imported by `CLAUDE.md`; `.claude/settings.json` disables automatic attribution and session links. The active `.githooks/commit-msg` hook requires an approved human author/committer and rejects co-authors/common AI signatures. On a fresh checkout, run `./scripts/install-git-hooks.ps1` before committing. See [commit policy](docs/commit-policy.md) for tests, CI auditing and enforcement limits. Ten local hook cases passed during policy setup; the complete-history audit passed again during publication review. Task 2.3 is the next application task; tasks 2.1–2.2 are published.

Before future commits, review `git status` and the staged file list. Keep `.env`, credentials, `.setup/`, dependencies, build output and database data out of Git. The initial snapshot was checked for these exclusions. Commit changed source, lockfiles and documentation together as appropriate, and update this handoff with the implementation commit reference.

## Suggested continuation request

```text
Read handoff.md, Blueprint.md and Build_Plan.md in this repository.
Confirm the current Git and Docker state; preserve the existing local history.
Continue on development, which tracks origin/development.
Implement task 2.3: the chat page with sidebar, transcript, composer and theme.
Use the existing /api/chat history endpoints; keep streaming for task 2.4.
Verify desktop/mobile layout and Enter, Shift+Enter and IME behavior.
Run the relevant checks, document actual results and update the build plan and handoff.
Commit locally with descriptive messages using the configured human identity;
do not add AI/brand contributor attribution or push to a remote.
```

After each work session, update the stopping point, checks actually run, remaining blockers, local commit reference and next task in this file. Keep the blueprint and build-plan status consistent with it.
