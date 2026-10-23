# Development handoff

Updated: 23 October 2026. Read this file first when resuming work.

## Where we stopped

**Task 2.1 is implemented. The next implementation task is 2.2.** The application provides the Laravel React authentication starter, MySQL persistence, a private Pi health service, and owned history/connection-metadata endpoints. The chat page, authenticated execution contracts and provider requests are not implemented yet. See [the history endpoint contract](docs/chat-history.md).

| Document                                             | Use it for                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [Blueprint.md](Blueprint.md)                         | Architecture, ownership, security boundaries and acceptance requirements |
| [Build_Plan.md](Build_Plan.md)                       | Numbered tasks, completion checkboxes and progress                       |
| [docs/setup.md](docs/setup.md)                       | Installation, daily commands and troubleshooting                         |
| [docs/validation.md](docs/validation.md)             | Dated checks for Phase 1 and task 2.1, with their limits                 |
| [docs/chat-history.md](docs/chat-history.md)         | Task 2.1 endpoints, ownership, storage, pagination and limits            |
| [docs/runtime-versions.md](docs/runtime-versions.md) | Installed versions, image identities and compatibility sources           |
| [docs/provider-matrix.md](docs/provider-matrix.md)   | Intended provider path, ownership and unverified live-access status      |

## Completed and checked

- Tasks 0.1–0.3: workspace selected, versions recorded and initial provider ownership/path documented. All three generated lockfiles are saved in local commit `6736ac6`.
- Task 1.1: Laravel 13.38.0 with the official React/Inertia/TypeScript/Tailwind/shadcn/ui/Lucide starter. Registration, email verification, password reset/confirmation, two-factor and passkey scaffolding remain enabled. No default account is seeded.
- Task 1.2: pinned PHP/Node development image, Compose services, MySQL 8.4.13, all five starter migrations and a persistent named volume. A temporary user survived a database restart and was then removed.
- Task 1.3: `agent-service/` with Pi 1.4.0, TypeScript, its own lockfile and a private health endpoint. Laravel reached it by service name; no engine host port is published.
- Checks passed during Phase 1: 40 Laravel tests / 138 assertions, PHPStan, Pint, frontend build/types/lint, three engine tests, dependency audits, MySQL persistence, private service connectivity and browser login without console errors. These are recorded results, not checks rerun for this documentation change.
- Task 2.1: added three MySQL tables, UUID models/relations, ownership policies, session-authenticated JSON endpoints, bounded history pagination and transactional user-message appends. Browser requests cannot assign owners, message roles/sequences, connection status or private transcript/credential fields. New connections remain `not_configured`; actual provider credentials are not stored here.
- Task 2.1 verification: `composer ci:check` passed, including 58 Laravel tests / 436 assertions (18 history tests), PHPStan, Pint and frontend lint/types. Additive migrations passed on MySQL; a rolled-back fixture verified text/sequence persistence, unique constraints, connection unlinking and account cascades. Existing user records were unchanged. Laravel still reaches the private Pi health endpoint. See the dated results in [docs/validation.md](docs/validation.md).

All three services were healthy at the end of implementation. Vite's temporary development server was stopped, its `public/hot` file was removed automatically, and compiled browser assets remain available. Recheck current container state when resuming.

## Resume this checkout

Authoritative location: `C:\Users\e\Documents\Laravel- Projects\Chatbot`. Use PowerShell with Docker Desktop's Linux engine running. PHP/Composer/Node commands should run in the project containers; do not switch to the host's different Node version.

```powershell
git status --short
docker compose up -d --wait --wait-timeout 120
docker compose ps
```

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

Laravel is on loopback port 8080; Vite uses 5173 when started. MySQL is internal at `mysql:3306`; the engine is internal at `http://agent:3101/internal/health`. Health currently reports `providerAuth: not_configured`. Existing local secrets stay in ignored `.env`; preserve the application key and MySQL volume. Do not use `docker compose down -v` for routine shutdown.

## Next task: 2.2

Read Blueprint sections 4, 5 (application-facing engine contract), 8, 10, 12 and 13, plus `docs/chat-history.md`. Implement task 2.2 and its necessary supporting changes.

1. Define versioned request/event schemas in `contracts/`, with bounded payloads, allowed fields and explicit error behavior. Use deterministic fake execution; no provider credentials or live model calls are needed.
2. Add the small Laravel `AgentGateway` contract and private HTTP `PiGateway` implementation. Resolve conversation/connection ownership in Laravel before dispatch. Provider metadata marked `not_configured` must not imply live readiness.
3. Authenticate private Laravel-to-engine calls and any callbacks introduced here using separate scoped secrets or an equivalent scoped service identity. Keep real values in ignored environment configuration and the engine port private.
4. Validate schema versions and bounds on both sides. Test a successful fake request, invalid/missing authentication, invalid payloads, mismatched versions and transport failures. Preserve existing health behavior and history/authentication tests.
5. Record actual checks, update the task checkbox only when acceptance passes, refresh this handoff and create a descriptive local commit on `development`.

Likely entry points are `contracts/`, `app/Contracts/AgentGateway.php`, `app/Services/Ai/PiGateway.php`, `config/assistant.php`, `agent-service/src/`, and focused PHP/Node tests. Keep the service boundary small; durable run admission, claims and replay belong to Phases 4–5.

**Acceptance:** a valid fake request crosses the authenticated private boundary; invalid authentication and payloads are rejected. Existing authentication, saved history and private health connectivity continue to work.

## Remaining work in order

| Tasks   | Remaining result                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| 2.2     | Versioned contracts and authenticated private `AgentGateway`/`PiGateway` calls — start here                |
| 2.3–2.4 | Chat UI, keyboard/mobile behavior and explicitly configured simulated streaming                            |
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
- History APIs currently save user text only. No assistant/tool write path, UI, run admission or idempotency exists yet; a repeated successful message POST appends again. Future run admission must coordinate persistence to avoid duplicate user messages. Concurrent append load testing remains unverified.
- Windows bind mounts were slow: the frontend build took about 156 seconds. A future move of the single authoritative checkout to Ubuntu's Linux filesystem is the main optimization suggestion. Ubuntu's initial user/Docker integration setup remains separate from the working PowerShell/Compose path.
- The optional `fontaine` warning is non-fatal; fonts build and render. No new dependency was added just to silence it.
- CI is configured for pushes to `main` and `development`, and for pull requests. Remote CI results have not yet been verified. A pristine-checkout run of the complete setup script, live provider tests, real mail delivery, physical passkey enrollment, production deployment and backup/restore are not verified.
- `.setup/` contains ignored downloads, temporary probes and dependency backups. It is not application source and is not included in a new clone. The persistence probe fixture was cleaned up.

## Git branches and contributor requirements

The initial snapshot is **`6736ac6` — Set up Laravel React development foundation**, with checkpoint documentation in `59fcdab`, contributor-policy enforcement in `804a379` and remote configuration documentation in `e4b9c7f`. It includes the application, all three lockfiles, setup/validation documents and this handoff. On 22 October 2026, the user explicitly authorized publication to [the GitHub repository](https://github.com/EnrieJohn31/Personalize_Chatbot). All four existing commits were pushed successfully to both `main` and the new `development` branch with their messages and history preserved. `origin` points to `https://github.com/EnrieJohn31/Personalize_Chatbot.git`; both branches track their matching remote branches.

Continue application work on `development`; `main` retains the published foundation checkpoint. This publication update also enables the same CI checks for both branches. Use `git branch -vv`, `git log --oneline` and `git remote -v` to inspect the current state. Branch protection is not configured, and remote CI results have not yet been verified.

Use descriptive commit messages and the configured human Git identity, `EnrieJohn31`. Do not add AI names, product/brand identities, generated-by attribution or co-author trailers to contributor metadata. The current push is explicitly authorized; subsequent work should remain in local commits unless the user requests publication. Do not change remotes without a user instruction.

This policy is tracked in `AGENTS.md` and imported by `CLAUDE.md`; `.claude/settings.json` disables automatic attribution and session links. The active `.githooks/commit-msg` hook requires an approved human author/committer and rejects co-authors/common AI signatures. On a fresh checkout, run `./scripts/install-git-hooks.ps1` before committing. See [commit policy](docs/commit-policy.md) for tests, CI auditing and enforcement limits. Ten local hook cases and the existing-history audit passed during policy setup. Task 2.2 is the next application task; task 2.1 changes are local until another push is requested.

Before future commits, review `git status` and the staged file list. Keep `.env`, credentials, `.setup/`, dependencies, build output and database data out of Git. The initial snapshot was checked for these exclusions. Commit changed source, lockfiles and documentation together as appropriate, and update this handoff with the implementation commit reference.

## Suggested continuation request

```text
Read handoff.md, Blueprint.md and Build_Plan.md in this repository.
Confirm the current Git and Docker state; preserve the existing local history.
Continue on development, which tracks origin/development.
Implement task 2.2: versioned execution contracts and authenticated private Laravel/Pi calls.
Preserve the existing authentication flows and Laravel/Pi ownership boundaries.
Use deterministic fake execution and test authentication, payload bounds, versions and failures.
Run the relevant checks, document actual results and update the build plan and handoff.
Commit locally with descriptive messages using the configured human identity;
do not add AI/brand contributor attribution or push to a remote.
```

After each work session, update the stopping point, checks actually run, remaining blockers, local commit reference and next task in this file. Keep the blueprint and build-plan status consistent with it.
