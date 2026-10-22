# Prerequisite download record

Date: 22 October 2026 (Asia/Shanghai).

The requested first requirements were identified from `Blueprint.md` and `Build_Plan.md`. This pass prepares the development prerequisites and records Phase 0 choices. Laravel scaffolding and application dependency installation have not started.

## Prepared

- Started the existing Docker Desktop Linux engine and checked Docker/Compose availability.
- Downloaded and executed version checks for Node `24.22.1`, npm `11.19.1`, PHP `8.4.27`, Composer `2.10.3` and MySQL `8.4.13`.
- Downloaded the official Laravel React starter at the commit in `runtime-versions.md`; checked its manifests against the chosen Laravel/PHP/Node versions.
- Downloaded Pi AI and agent-core `1.4.0` package archives; verified their npm SHA-512 integrity values. Transitive npm dependencies are not installed yet.
- Initialized local Git on `main` and ignored the download cache and future generated dependencies. No remote or commits were created.
- Recorded initial provider ownership and an explicitly unverified authentication path in `provider-matrix.md`.
- Installed Ubuntu 24.04.5 in WSL2. Confirmed its existing Git `2.43.0` and curl `8.5.0`; installed `unzip` (`6.0-28ubuntu4.1`) and updated `ca-certificates` (`20260816ubuntu0.24.04.1`) from Ubuntu's repositories. No general distribution upgrade was performed.

Docker images reside in Docker's image store. Composer, the starter source, Pi archives and the Ubuntu image are under `.setup/downloads/`, which is excluded from Git. `downloads.json` records source URLs and checksums; it does not contain credentials.

## Ubuntu / WSL2

Selected distribution: Ubuntu 24.04 LTS, image `24.04.5`, AMD64. WSL2 is already installed.

The first `wsl --install Ubuntu-24.04 --no-launch --web-download` attempt produced no progress and was stopped. Its installation processes were stopped without stopping Docker or other WSL processes. The official Ubuntu image was downloaded directly from the URL in Microsoft's distribution manifest, verified against its SHA-256 checksum, and installed with:

```powershell
wsl.exe --install --from-file '.setup\downloads\ubuntu-24.04.5-wsl-amd64.wsl' --name Ubuntu-24.04 --no-launch
```

Verification passed: `wsl --list --verbose` lists `Ubuntu-24.04` at version **2**; `/etc/os-release` reports **Ubuntu 24.04.5 LTS**. All five archives pass `scripts/verify-downloads.ps1`. Docker's Windows API responds with Linux Engine 29.8.2. Docker integration inside Ubuntu is **not yet enabled**; the Ubuntu-side Docker check did not succeed.

The Linux archive/certificate prerequisites were installed with `apt-get update -qq` followed by `apt-get install -y --no-install-recommends unzip ca-certificates`, executed as root in this new distribution. Package installation completed successfully. The first user's password was not set automatically.

Remaining interactive setup: launch Ubuntu once to create your Linux username and password:

```powershell
wsl.exe -d Ubuntu-24.04
```

Then enable **Docker Desktop → Settings → Resources → WSL Integration → Ubuntu-24.04**. Within Ubuntu, check:

```bash
docker version
docker compose version
```

Do not install a second Docker daemon inside Ubuntu. [Docker's WSL2 instructions](https://docs.docker.com/desktop/features/wsl/) describe the integration.

## Repeat the download checks

From the project directory in PowerShell:

```powershell
./scripts/verify-downloads.ps1
docker info --format '{{.ServerVersion}}'
docker run --rm --network none php:8.4.27-cli-bookworm php --version
docker run --rm --network none node:24.22.1-bookworm-slim node --version
docker run --rm --network none node:24.22.1-bookworm-slim npm --version
docker run --rm --network none mysql:8.4.13 mysqld --version

$downloadPath = Join-Path (Get-Location).Path '.setup\downloads'
docker run --rm --network none --mount "type=bind,source=$downloadPath,target=/downloads,readonly" php:8.4.27-cli-bookworm php /downloads/composer-2.10.3.phar --version
```

These disposable containers do not run an application server or initialize a database. They prove that the downloaded binaries execute. They do not prove Laravel login, database connectivity, provider authentication or private engine networking.

## Changes and next task

Added `.gitignore`, this setup record, `runtime-versions.md`, `provider-matrix.md`, `downloads.json` and `scripts/verify-downloads.ps1`. Updated the plan's progress and the blueprint's runtime-selection note. The two original planning documents remain in the project root.

Next: task **1.1**, scaffold the official Laravel React starter into this project while preserving the planning/setup documents. Build Sail's PHP runtime with required extensions, install the selected Composer/frontend dependencies, generate lockfiles, build assets and check the starter login page. Task 1.2 then configures MySQL persistence; task 1.3 installs the private Pi service and its separate dependencies.

The downloaded PHP CLI base is not a ready Sail application image. Do not skip Laravel's required extensions or use `--ignore-platform-reqs` to mask missing runtime requirements. Use MySQL's exact `8.4.13` image rather than changing tags used by other local projects.

Optimization suggestion: before installing the large `vendor` and `node_modules` trees, use an Ubuntu Linux-filesystem checkout if practical. This follows the blueprint's WSL recommendation and improves filesystem watching and container bind-mount performance. Keep one authoritative checkout and record any relocation.
