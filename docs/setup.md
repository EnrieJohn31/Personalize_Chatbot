# Development setup

Updated: 23 October 2026. The earlier download and Ubuntu installation record is retained in [prerequisites.md](prerequisites.md).

## Workspace and prerequisites

The authoritative checkout remains `C:\Users\e\Documents\Laravel- Projects\Chatbot`. Docker Desktop runs Linux containers through its WSL2 backend. Commands below use Windows PowerShell and the Docker CLI; they do not require a host PHP or Node installation. The existing global Windows Node installation is unchanged.

Ubuntu 24.04.5 is installed. Its initial user setup and Docker Desktop WSL integration were not completed during prerequisite preparation. They are not required by the Windows Compose workflow. To use Sail's shell wrapper from Ubuntu, complete those steps as recorded in [prerequisites.md](prerequisites.md).

The project uses a Sail-compatible custom PHP development image to retain the selected PHP 8.4.27, Composer 2.10.3 and Node 24.22.1 runtimes. `vendor/bin/sail` is installed; PowerShell uses `docker compose` directly. This image uses Artisan's development server and is not a production PHP-FPM image.

## First setup or dependency refresh

```powershell
./scripts/setup.ps1
```

The script first enables the repository's [contributor-policy Git hook](commit-policy.md), then checks Docker, creates `.env` if absent, replaces placeholder database passwords and an empty `AGENT_REQUEST_SIGNING_KEY` or `AGENT_CREDENTIAL_KEY` with random local values, builds both runtime images, installs `composer.lock` and `package-lock.json`, generates a missing application key, builds browser assets, starts MySQL/Pi, runs migrations and starts Laravel. The agent image installs its separate `agent-service/package-lock.json`. Re-running preserves non-placeholder passwords, the application key and the database volume. No default user is seeded; register through the application.

Database passwords are applied by MySQL only when its volume is first initialized. If you later edit database passwords, update the existing database credentials as well. Do not delete the volume to resolve a credentials mismatch when it contains data you need.

The first image build and dependency installation require Internet access. Font files are downloaded by the starter's Vite font plugin during builds. The current Windows bind mount can make dependency extraction and linting slow; Composer's timeout is 1,200 seconds. Download archives and temporary setup files live in ignored `.setup/`.

## Daily commands

Run these from the project root:

| Purpose | PowerShell command |
| --- | --- |
| Start services and wait for health | `docker compose up -d --wait --wait-timeout 120` |
| Inspect service state | `docker compose ps` |
| Application | Open `http://localhost:8080` |
| Frontend hot reload | `docker compose exec --user sail laravel.test npm run dev` |
| Build frontend | `docker compose exec --user sail laravel.test npm run build` |
| PHP formatting | `docker compose exec --user sail laravel.test composer lint` |
| Frontend formatting/lint fixes | `docker compose exec --user sail laravel.test npm run check:fix` |
| Full PHP/frontend checks (includes the frontend unit tests) | `docker compose exec --user sail laravel.test composer ci:check` |
| Frontend unit tests only | `docker compose exec --user sail laravel.test npm run test` |
| Chat page | Open `http://localhost:8080/chat` after signing in |
| Connect ChatGPT | Open `http://localhost:8080/settings/connections` after signing in |
| Pi TypeScript check | `docker compose exec agent npm run check` |
| Pi build and tests | `docker compose exec agent npm test` |
| Engine signing and reachability | `docker compose exec --user sail laravel.test php artisan agent:check` |
| Migrate | `docker compose exec --user sail laravel.test php artisan migrate` |
| Service logs | `docker compose logs --tail=100 laravel.test agent mysql` |
| Stop, keeping data | `docker compose down` |

PHP tests use SQLite in memory, independently of the local MySQL data. The live MySQL restart/persistence check is separate and documented in [validation.md](validation.md). CI runs the same application checks plus the agent's contract, signing, admission and health tests. Hosted CI execution requires a configured remote and is not implied by the local results.

The agent image runs `npm run dev` (`tsx watch`) on mounted TypeScript source; `npm run build` compiles `dist/`, and `npm start` runs the compiled entry point. Rebuild with `docker compose up -d --build agent` after changing its manifest, lockfile or Dockerfile. The repository's `contracts/` directory is mounted read-only at `/contracts` and copied into the image through a named build context. Both frontend and agent polling are enabled for Windows mounts using `VITE_USE_POLLING`; turn that off when using a native Linux checkout if normal file events work.

Stop Vite with Ctrl+C before switching to built assets. If an interrupted development server leaves `public/hot`, remove that single generated file, then run `npm run build`. A stale hot file makes Laravel reference a server that is no longer running.

## Service boundary and state

- Laravel: `127.0.0.1:8080`, with Vite on loopback `5173` while started separately. `APP_PORT`, `APP_URL` and `VITE_PORT` can be changed together in `.env`; recreate the Laravel container afterward.
- MySQL: internal `mysql:3306`, database `assistant_foundation`, user `sail`, named volume `assistant-foundation_mysql-data`. No host port is published.
- Pi: internal `http://agent:3101`. `config/assistant.php` reads `AGENT_URL`. Run admission, cancellation and sign-in calls require Laravel's signed requests; see [the engine contracts](../contracts/README.md). The only published engine port is `127.0.0.1:1455`, the ChatGPT sign-in redirect, which listens only while a sign-in runs. It must be free on the host for the engine to start; see [the ChatGPT connection guide](chatgpt-connection.md).
- Engine state: the named volume `assistant-foundation_agent-data` holds the installation ID and the encrypted ChatGPT sign-ins.
- Health reports `providerAuth` (`configured` once `AGENT_CREDENTIAL_KEY` reaches the engine), `requestAuth` and `simulation`. A healthy Pi process proves that its selected packages load, not that provider access works. Development Compose enables only the deterministic simulated provider, which writes every chat reply until task 3.2. `AGENT_SIMULATION_CHUNK_DELAY_MS` (default 35) sets how quickly simulated replies stream; raise it to watch streaming, Stop and reconnection more easily, then run `docker compose up -d agent`.
- Each open reply stream occupies one of the four PHP CLI server workers until the reply finishes.
- `AGENT_REQUEST_SIGNING_KEY` in `.env` is shared by Laravel and the engine. After adding or changing it, run `docker compose up -d agent` so the engine container receives the new value, then `php artisan agent:check`. Without a key, the engine's run endpoints return 503 and Laravel sends nothing.
- `AGENT_CREDENTIAL_KEY` in `.env` is read only by the engine, which encrypts stored sign-ins with it. Keep it stable: changing it makes existing sign-ins unreadable, and users must sign in again. After adding it, run `docker compose up -d agent`.
- Laravel sessions/cache use MySQL; queued work is synchronous for this phase. Redis and a queue worker are not required.
- Email uses the log transport in local development: nothing is delivered to an inbox. After registering, find the verification link in `storage/logs/laravel.log`. The message is stored MIME-encoded, so the link is split across lines ending in `=`, and `=3D` stands for `=`; join those lines before opening it. The link expires after 60 minutes; use "Resend verification email" for a fresh one. Open it on the same host you signed in on (`localhost` and `127.0.0.1` have separate session cookies). No real mail service or provider credentials have been configured.

`docker compose down` preserves data. `docker compose down -v` deletes project volumes, including the database and every stored ChatGPT sign-in, and must not be used for routine shutdown. Keep `.env`, database backups and the engine's credential volume out of Git.

## Optimization and remaining work

The Windows filesystem was observably slow during Composer extraction and initial checks. A future move of this single authoritative checkout into Ubuntu's Linux filesystem should improve bind-mount performance. Complete Ubuntu's user and Docker integration first; avoid maintaining two independently edited copies. Another option is Linux named volumes for dependencies, but that changes IDE indexing and has not been introduced here.

Individual requests can take seconds because PHP's CLI development server runs without OPcache (`opcache.enable_cli=0`) and re-reads the framework from the bind mount. In a probe server, enabling it (`opcache.enable_cli=1`) cut warm requests from about 3.6 s to 220–440 ms; see [validation.md](validation.md). Adding that setting to `docker/php/php.ini` for development is suggested but not yet done; with `opcache.validate_timestamps` left on, code changes still apply immediately.

Phase 2 is complete; the chat page and its simulated replies are described in [chat-ui.md](chat-ui.md). Task 3.1's ChatGPT sign-in is described in [chatgpt-connection.md](chatgpt-connection.md); its live check with a real account and real replies (task 3.2) come next. The starter dashboard remains a placeholder; its sidebar links to Chat. Production images, TLS, durable runs and real provider testing remain in the build plan.
