# Assistant Foundation

Laravel 13 with the official React/Inertia starter, MySQL 8.4 and a private Node/Pi service. This checkout implements Build Plan Phase 1: authentication, the development environment and engine health. Chat history, streaming and provider authentication follow in Phases 2–3.

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

See [handoff and next task](handoff.md), [setup and commands](docs/setup.md), [verification results](docs/validation.md), [runtime versions](docs/runtime-versions.md), [build plan](Build_Plan.md) and [blueprint](Blueprint.md).

## Development

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

Keep `.env` private. The browser connects to Laravel on loopback port 8080; only the frontend development server uses 5173. MySQL and the Pi service have no host port mapping. The private engine currently serves health only; it does not execute prompts or use provider credentials.
