# Development handoff

Updated: 22 October 2026. Read this file first when resuming work.

## Where we stopped

**Phase 1 is implemented and verified. The next implementation task is 2.1.** The application currently provides the official Laravel React authentication starter, MySQL persistence and a private Pi health service. Chat history, the chat page, authenticated execution contracts and provider requests are not implemented yet.

| Document                                             | Use it for                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [Blueprint.md](Blueprint.md)                         | Architecture, ownership, security boundaries and acceptance requirements |
| [Build_Plan.md](Build_Plan.md)                       | Numbered tasks, completion checkboxes and progress                       |
| [docs/setup.md](docs/setup.md)                       | Installation, daily commands and troubleshooting                         |
| [docs/validation.md](docs/validation.md)             | Actual Phase 1 checks and their limits                                   |
| [docs/runtime-versions.md](docs/runtime-versions.md) | Installed versions, image identities and compatibility sources           |
| [docs/provider-matrix.md](docs/provider-matrix.md)   | Intended provider path, ownership and unverified live-access status      |

## Completed and checked

- Tasks 0.1–0.3: workspace selected, versions recorded and initial provider ownership/path documented. All three generated lockfiles are saved in local commit `6736ac6`.
- Task 1.1: Laravel 13.38.0 with the official React/Inertia/TypeScript/Tailwind/shadcn/ui/Lucide starter. Registration, email verification, password reset/confirmation, two-factor and passkey scaffolding remain enabled. No default account is seeded.
- Task 1.2: pinned PHP/Node development image, Compose services, MySQL 8.4.13, all five starter migrations and a persistent named volume. A temporary user survived a database restart and was then removed.
- Task 1.3: `agent-service/` with Pi 1.4.0, TypeScript, its own lockfile and a private health endpoint. Laravel reached it by service name; no engine host port is published.
- Checks passed during Phase 1: 40 Laravel tests / 138 assertions, PHPStan, Pint, frontend build/types/lint, three engine tests, dependency audits, MySQL persistence, private service connectivity and browser login without console errors. These are recorded results, not checks rerun for this documentation change.

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

## Next task: 2.1

Read Blueprint sections 4, 5 (connection ownership), 7, 10 and 13, then implement only task 2.1 and its necessary supporting changes.

1. Add migrations/models for user-owned conversations, messages and non-secret provider connection records, following the blueprint's storage ownership. Preserve the existing users/authentication tables and routes.
2. Add authenticated Laravel save/load paths with request validation and policies or equivalent ownership enforcement. Resolve ownership from the signed-in user; never trust a submitted owner ID. Apply ownership to nested message and connection references as well as conversation lookup.
3. Keep credential material out of these records and browser responses. Real provider login and its credential store belong to Phase 3. Use invented data; no live credentials are needed for this task.
4. Add focused tests proving an owner can save/load sample history and a second user cannot read or modify it through direct IDs or nested references. Check guest access, invalid input and cross-user connection references where implemented.
5. Run relevant tests and migration checks against the existing setup without resetting local data. Record evidence, update task 2.1's checkbox only when its acceptance check passes, refresh this handoff and create a descriptive local commit.

Likely entry points are `app/Models/`, `app/Policies/`, `app/Http/Controllers/`, `app/Http/Requests/`, `database/migrations/`, `routes/web.php` and `tests/Feature/`. These are implementation locations, not a requirement to create unnecessary abstractions.

**Acceptance:** an authenticated user can save/load their sample history, and another user cannot access it. The existing authentication and settings flows continue to pass their checks.

## Remaining work in order

| Tasks   | Remaining result                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| 2.1     | Owned history and non-secret provider connection records — start here                                        |
| 2.2     | Versioned contracts and authenticated private `AgentGateway`/`PiGateway` calls; reject invalid auth/payloads |
| 2.3–2.4 | Chat UI, keyboard/mobile behavior and explicitly configured simulated streaming                              |
| 3.1–3.5 | Verify supported provider login, real Pi streaming, sample lookup tool, bounded history and prototype Stop   |
| 4.1–4.4 | Durable runs/events, claims, idempotency and transactional final saves                                       |
| 5.1–5.4 | SSE replay, cancellation races, recovery scheduler, capacity and queue deadlines                             |
| 6.1–6.3 | Foundation regression checks, measurements, integrated demo and pristine-checkout setup validation           |
| 7.1–7.3 | First purpose and authorized connector, after the purpose is selected                                        |
| 8.1–8.4 | Production images, serving/supervision, backup/restore and deployment acceptance                             |

Use the build plan's individual acceptance checks; this table does not replace them. Phase 3 requires supported, authorized provider access. The selected path and model eligibility are still unverified; do not infer that a healthy engine can make a live request or silently substitute another billing/authentication path.

## Boundaries and open items

- Laravel owns users, permissions and durable MySQL state. Node/Pi owns active model/tool execution; it does not write the application database directly. Browser application requests go through Laravel.
- Preserve the agreed Pi architecture. Redis, another agent framework, vector storage, WebSockets and a queue worker are not Phase 2 prerequisites.
- Windows bind mounts were slow: the frontend build took about 156 seconds. A future move of the single authoritative checkout to Ubuntu's Linux filesystem is the main optimization suggestion. Ubuntu's initial user/Docker integration setup remains separate from the working PowerShell/Compose path.
- The optional `fontaine` warning is non-fatal; fonts build and render. No new dependency was added just to silence it.
- CI is configured but has not run remotely. A pristine-checkout run of the complete setup script, live provider tests, real mail delivery, physical passkey enrollment, production deployment and backup/restore are not verified.
- `.setup/` contains ignored downloads, temporary probes and dependency backups. It is not application source and is not included in a new clone. The persistence probe fixture was cleaned up.

## Local Git and contributor requirements

The initial local snapshot is saved on `main` as **`6736ac6` — Set up Laravel React development foundation**, with checkpoint documentation in `59fcdab` and contributor-policy enforcement in `804a379`. It includes the application, all three lockfiles, setup/validation documents and this handoff. The user supplied [the GitHub repository](https://github.com/EnrieJohn31/Personalize_Chatbot); `origin` now points to `https://github.com/EnrieJohn31/Personalize_Chatbot.git`. Read access was verified and `git ls-remote origin` returned no published references. Nothing has been pushed; the source and policy files remain local. Use `git log --oneline` and `git remote -v` to inspect the current state.

The user requires local-only commits with messages describing the changes. Use the configured human Git identity, `EnrieJohn31`. Do not add AI names, product/brand identities, generated-by attribution or co-author trailers to contributor metadata. Do not push or configure a remote without a new user instruction.

This policy is now tracked in `AGENTS.md` and imported by `CLAUDE.md`; `.claude/settings.json` disables automatic attribution and session links. The active `.githooks/commit-msg` hook requires an approved human author/committer and rejects co-authors/common AI signatures. On a fresh checkout, run `./scripts/install-git-hooks.ps1` before committing. See [commit policy](docs/commit-policy.md) for tests, CI auditing and enforcement limits. Ten local hook cases and the existing-history audit passed. Task 2.1 remains the next application task.

Before future commits, review `git status` and the staged file list. Keep `.env`, credentials, `.setup/`, dependencies, build output and database data out of Git. The initial snapshot was checked for these exclusions. Commit changed source, lockfiles and documentation together as appropriate, and update this handoff with the implementation commit reference.

## Suggested continuation request

```text
Read handoff.md, Blueprint.md and Build_Plan.md in this repository.
Confirm the current Git and Docker state; preserve the existing local history.
Implement task 2.1: owned conversations/messages and non-secret provider connection records.
Preserve the existing authentication flows and Laravel/Pi ownership boundaries.
Use invented data and add meaningful ownership and access-denial tests.
Run the relevant checks, document actual results and update the build plan and handoff.
Commit locally with descriptive messages using the configured human identity;
do not add AI/brand contributor attribution or push to a remote.
```

After each work session, update the stopping point, checks actually run, remaining blockers, local commit reference and next task in this file. Keep the blueprint and build-plan status consistent with it.
