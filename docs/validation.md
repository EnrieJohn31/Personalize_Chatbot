# Phase 1 validation

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

The full setup script has not been exercised from a separate pristine checkout; Phase 6.3 retains that acceptance check. Its constituent setup steps passed here. No production deployment, backup/restore, physical passkey enrollment, external email delivery or live provider test was performed. Provider authentication remains unconfigured. Task 2.1 is next; the chat UI, execution contract, streaming and durable run lifecycle remain unimplemented.
