# Assistant Foundation

Laravel 13 with the official React/Inertia starter, MySQL 8.4 and a private Node/Pi service. Phases 0–1 and tasks 2.1–2.2 are complete: authentication, the development environment, owned history/connection-metadata endpoints and a signed, versioned Laravel-to-engine admission boundary. The chat UI, streaming, model execution and provider authentication remain in Phases 2–3.

## Start locally

Open Docker Desktop with its Linux engine running, then use PowerShell in this directory:

```powershell
./scripts/setup.ps1
```

Open [the application](http://localhost:8080) and register your own local account. No default account is seeded. Setup installs locked dependencies, builds assets, generates missing local secrets and runs migrations. Existing application keys and database data are preserved.

After setup, normal startup is:

```powershell
docker compose up -d --wait
```

See [handoff and next task](handoff.md), [history endpoints](docs/chat-history.md), [engine contracts](contracts/README.md), [setup and commands](docs/setup.md), [verification results](docs/validation.md), [runtime versions](docs/runtime-versions.md), [build plan](Build_Plan.md) and [blueprint](Blueprint.md).

## Development

Repository instructions and the [commit policy](docs/commit-policy.md) apply to every coding tool. Setup enables the local Git hook; for an existing checkout, run `./scripts/install-git-hooks.ps1` once before committing.

```powershell
# Keep this terminal running for frontend hot reload.
docker compose exec --user sail laravel.test npm run dev

# Full Laravel/frontend checks; the Pi tests run separately.
docker compose exec --user sail laravel.test composer ci:check
docker compose exec agent npm test

# Compile frontend assets after ending hot reload.
docker compose exec --user sail laravel.test npm run build

# Stop services while retaining the MySQL volume.
docker compose down
```

Keep `.env` private. The browser connects to Laravel on loopback port 8080; only the frontend development server uses 5173. MySQL and the Pi service have no host port mapping. The private engine accepts only signed, schema-validated run requests from Laravel (`AGENT_REQUEST_SIGNING_KEY`; check with `php artisan agent:check`). It acknowledges them but does not yet execute prompts or use provider credentials.
