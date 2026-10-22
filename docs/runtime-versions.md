# Initial runtime versions

Recorded: 22 October 2026 (Asia/Shanghai). Build Plan task 0.2.

These versions are installed in the Phase 1 application. `composer.lock`, root `package-lock.json` and `agent-service/package-lock.json` record exact resolutions. See [validation.md](validation.md) for build and integration evidence.

## Host and workspace

- Project: `C:\Users\e\Documents\Laravel- Projects\Chatbot`.
- Development OS: Windows 11 Pro, build `10.0.26300.9711`, x64.
- Git: `2.56.0.windows.2`; local repository on `main`, without a configured remote.
- WSL: `2.6.3.0`, kernel `6.6.87.2-1`; Ubuntu `24.04.5` LTS installed and verified at WSL version 2. Initial user setup and Docker integration remain; see `setup.md`.
- Docker Engine/CLI: `29.8.2`; Compose: `5.6.0`; Linux engine started and verified.
- Existing Windows Node: `25.4.0`, npm `11.7.0`. Use the downloaded Node 24 container for this project. The global Windows installation was not changed.

The current Windows folder remains the authoritative project location. PowerShell/Compose works through Docker Desktop's WSL2 backend. For better bind-mount and watcher performance, consider a future move of this single checkout to Ubuntu's Linux filesystem after completing its initial user and Docker integration. Do not maintain two independently edited copies.

## Selected versions

| Component | Initial selection | Evidence and state |
| --- | --- | --- |
| Laravel framework | `13.38.0` | Installed and locked; project requires PHP `^8.4`. |
| Official React starter | Commit `717b8f55aefd82d25d4119eaebdc8e3a72b8d7e5` | Source archive downloaded and manifests inspected. Requires Laravel `^13.17` and PHP `^8.3`. |
| PHP | `8.4.27` | Custom Sail-compatible image with MySQL, SQLite, mbstring, intl, zip, bcmath and pcntl support. |
| Composer | `2.10.3` | PHAR downloaded, checked against the official SHA-256 checksum, executed successfully with PHP 8.4.27. |
| Laravel Sail | `1.69.0` | Installed and locked; Windows uses the equivalent Compose commands. |
| Node | `24.22.1` LTS | Official Debian Bookworm slim image downloaded; runtime version passed. |
| npm in Node container | `11.19.1` | Runtime version passed. |
| MySQL | `8.4.13` LTS | Exact image runs the migrated application database in a project-specific named volume. |
| `@earendil-works/pi-ai` | `1.4.0` | Installed in the agent image; Node `>=22.19.0`; MIT license. |
| `@earendil-works/pi-agent-core` | `1.4.0` | Installed in the agent image; depends on `pi-ai` exactly `1.4.0`. |

The historical Pi `0.87.1` snapshot is not used. The selected release uses the `@earendil-works` package scope. Its current provider API must be used when implementing the engine.

Frontend resolutions include React `19.3.1`, Inertia React `3.9.1`, TypeScript `5.9.3`, Tailwind `4.3.3` and Lucide `0.475.0`. The official starter's shadcn/ui components are checked-in source. PHP uses Inertia `3.5.2` and Fortify `1.41.0`.

The downloaded starter's Vite+ `0.3.x` dependency tree produced seven npm advisories (four moderate and three critical). Vite+ was updated to `1.3.0`, with the matching `vite` alias `npm:@voidzero-dev/vite-plus-core@1.3.0` and an npm override so plugins share the same Vite runtime. The resolved frontend and agent audits both report zero advisories. See the [Vite+ 1.3.0 release](https://github.com/voidzero-dev/vite-plus/releases/tag/v1.3.0) and [migration documentation](https://viteplus.dev/guide/migrate). Engine tooling is TypeScript `5.9.3`, tsx `4.23.15` and Node types `24.19.2`.

## Downloaded image identities

Use explicit versions or digests when creating project configuration:

| Image | Downloaded manifest digest |
| --- | --- |
| `php:8.4.27-cli-bookworm` | `sha256:496b5e02fe9fe44fcfb715023b931048111dc4e0bc719789d83c906be9f04b05` |
| `node:24.22.1-bookworm-slim` | `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205` |
| `mysql:8.4.13` | `sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69` |

The pre-existing `laravelsail/php84-composer:latest` image was inspected and contains PHP `8.4.1` / Composer `2.8.3`. It is not the selected runtime. Use the verified current PHP/Composer downloads or build the selected Sail runtime during scaffolding. The plain PHP CLI image is a base image, not a completed Laravel server.

The MySQL download initially refreshed the shared `mysql:8.4` tag. The downloaded image was given its exact `mysql:8.4.13` tag and `mysql:8.4` was restored to the pre-existing image `sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70`, used by another local project. Existing containers and volumes were not recreated or started.

## Compatibility sources

Sources were checked on 22 October 2026:

- [Laravel release support](https://laravel.com/docs/releases).
- [Laravel framework package metadata](https://repo.packagist.org/p2/laravel/framework.json).
- [Pinned React starter PHP manifest](https://github.com/laravel/react-starter-kit/blob/717b8f55aefd82d25d4119eaebdc8e3a72b8d7e5/composer.json) and [frontend manifest](https://github.com/laravel/react-starter-kit/blob/717b8f55aefd82d25d4119eaebdc8e3a72b8d7e5/package.json).
- [Sail package metadata](https://repo.packagist.org/p2/laravel/sail.json) and [WSL2 support](https://laravel.com/docs/sail).
- [PHP 8.4 release metadata](https://www.php.net/releases/index.php?json&version=8.4).
- [Composer release metadata](https://getcomposer.org/versions).
- [Node release status](https://nodejs.org/en/about/previous-releases) and [release index](https://nodejs.org/dist/index.json).
- [Published Pi AI 1.4.0 metadata](https://registry.npmjs.org/@earendil-works/pi-ai/1.4.0), [agent-core metadata](https://registry.npmjs.org/@earendil-works/pi-agent-core/1.4.0) and [versioned provider documentation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/README.md).
- [Docker WSL2 integration](https://docs.docker.com/desktop/features/wsl/) and [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).

Dependency audits are observations from 22 October 2026, not a guarantee against future advisories. Provider compatibility and authentication remain unverified until Phase 3.
