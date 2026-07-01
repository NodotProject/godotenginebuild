# Custom Godot Builds

A free web app where users pick engine features from a comprehensive menu and
download a Godot export template compiled to their exact configuration. The
server compiles Godot from source with `scons` and **caches every configuration**
— so the same options download instantly, and *similar* options reuse shared
compile steps.

Inspired by [NodotProject/GodotLite](https://github.com/NodotProject/GodotLite):
the user's selections become a Godot `custom.py` of scons flags, which is built
into a stripped-down template.

## How it works

```
apps/web        Vite + React + Tailwind UI (option menu, live cache status, log stream)
apps/api        Express + TypeScript API (REST + SSE, job queue, build worker)
packages/shared Option catalog, cache-key + custom.py logic shared by both
```

1. The browser builds a config and calls `POST /api/builds/check` as you edit —
   the bundle shows either a **Download** link (already cached) or a
   **Generate (~N min)** button.
2. **Generate** validates the config against an allowlist, computes a cache key,
   and either serves the cache or enqueues a build.
3. The worker clones the pinned Godot version (once per version), creates an
   isolated **git worktree**, then for each platform (Linux, Windows, macOS)
   writes `custom.py`, runs `scons`, and streams the live build log over **SSE**.
   The per-platform templates are zipped into one bundle artifact.
4. On success the bundle is published to a hash-addressed cache directory with
   a `.complete` sentinel; the browser gets a download link + sha256.

### Versions

The list of offered Godot versions is **fetched live** from the Godot git repo
(`git ls-remote --tags`), filtered to stable `4.3+` releases and sorted
newest-first, so new releases appear automatically. The list is cached in memory
with a TTL and refreshed in the background, persisted to `DATA_ROOT/versions.json`
for offline/restart resilience, and falls back to a built-in seed list if the
remote is unreachable. A requested version is always validated against the known
list before any clone — an arbitrary git ref is never checked out.

### Caching

- **Per-configuration cache**: key = `sha256(version + target + per-platform
  canonical options)`. One build produces every platform, so a config maps to a
  single bundle. Identical configs are served instantly; an in-flight build is
  shared by all requesters (dedupe).
- **Shared build-step cache**: a persistent `SCONS_CACHE` per Godot version means
  two configs that differ by a few toggles reuse most already-compiled objects.
  Only the *first* build of a version is a true cold (~30 min) build.

## Prerequisites

This service compiles Godot **on the host with native toolchains**. Install the
Godot build dependencies for each platform you want to offer
([official docs](https://docs.godotengine.org/en/stable/contributing/development/compiling/)).

Node ≥ 20 and `pnpm`, plus:

| Target  | Requires |
| ------- | -------- |
| Linux   | `git`, `python3`, `scons`, `g++`/`clang`, `pkg-config`, and the X11/Wayland/ALSA/PulseAudio dev libraries |
| Windows | the above + `mingw-w64` (cross-compile; POSIX threads variant recommended) |
| macOS   | the above + [`osxcross`](https://github.com/tpoechtrager/osxcross) with an Apple SDK and `lipo` (set `OSXCROSS_ROOT`) |

On Debian/Ubuntu the Linux + Windows set is:

```bash
sudo apt-get install -y build-essential git pkg-config python3 scons zip mingw-w64 \
  libx11-dev libxcursor-dev libxinerama-dev libxrandr-dev libxi-dev \
  libasound2-dev libpulse-dev libudev-dev libgl1-mesa-dev libglu1-mesa-dev \
  libwayland-dev wayland-protocols libxkbcommon-dev
```

The set of platforms every bundle covers is configurable via `BUILD_PLATFORMS`
(default: all three; comma-separated subset of `linuxbsd,windows,macos`). The app
**probes the host on startup** for each offered platform's toolchain. Because a
build bundles all offered platforms, any missing toolchain is surfaced as a
warning in the UI and rejected up front (the bundle is all-or-nothing) rather
than failing mid-build. The provided [`Dockerfile`](./Dockerfile) installs all
three toolchains, so it offers the full bundle out of the box; a bare host
without an Apple SDK should drop `macos` from `BUILD_PLATFORMS`.

## Quick start

```bash
pnpm install
pnpm dev          # API on :8787, web on :5173 (proxied to the API)
```

Open http://localhost:5173, pick a version, optionally tweak options, and click
**Generate** to build the all-platform template bundle.

Run the test suite:

```bash
pnpm test         # unit tests for the validation / cache-key / custom.py logic
```

Production-style run:

```bash
pnpm build        # builds the static web bundle (apps/web/dist)
pnpm start        # runs the API; it also serves apps/web/dist (SPA fallback) when present
```

The API serves the built web bundle on the same origin, so a single process can
front the whole app. Put a TLS-terminating reverse proxy (nginx/Caddy/Cloudflare)
in front and set `TRUST_PROXY` to the number of proxy hops so per-IP rate
limiting sees the real client address.

Configuration is via environment variables — see [`.env.example`](./.env.example).
All mutable state lives under `DATA_ROOT` (default `./.data`).

### Docker

A [`Dockerfile`](./Dockerfile) builds **all three** toolchains — Linux,
Windows (mingw), and macOS (osxcross + `rcodesign`) — builds the web bundle, and
serves everything from one container. The macOS cross toolchain is assembled at
image-build time from an Apple SDK tarball: the SDK is Apple-licensed and not
redistributable, so it is fetched from `MACOS_SDK_URL` (override the build arg to
use your own):

```bash
docker build --build-arg MACOS_SDK_URL=<your-sdk-url> -t godotbuild .
```

The default points at a community-hosted SDK so `docker build` works unmodified.
To build a Linux + Windows-only image, set `BUILD_PLATFORMS=linuxbsd,windows`.

```bash
docker compose up --build      # serves the app on http://localhost:8787
```

Build state persists in the `godot-data` volume. `tini` runs as PID 1 so build
subprocesses are reaped and `SIGTERM` triggers a graceful drain.

## Production hardening

- **Rate limiting** — per-client-IP limits on the check, build, and download
  endpoints (tunable via `RATE_LIMIT_*`); abusive callers get `429`s with
  `Retry-After`. Honors `TRUST_PROXY` for the real client IP.
- **Disk guard** — new builds are refused (cached downloads still work) once free
  space on `DATA_ROOT` drops below `MIN_FREE_DISK_GIB`.
- **Graceful shutdown** — `SIGTERM`/`SIGINT` stops accepting connections, kills
  in-flight build process groups, and closes the queue DB; a 10s watchdog forces
  exit if a connection hangs.
- **Health & metrics** — `GET /api/health` (liveness), `GET /api/ready`
  (readiness: queue depth, free disk, available platforms), `GET /api/metrics`
  (request/response/build counters). One structured access-log line per request.

## Security

User selections never become raw shell or Python strings:

- Only **bool/enum** options from a versioned **allowlist catalog** are accepted;
  free-string compiler options (`ccflags`, `CXX`, `extra_suffix`, `custom_modules`,
  …) are deliberately excluded and rejected.
- Every value is validated to a closed set before it is written to `custom.py`
  (emitted as quoted literals) or passed to `scons` (argv array, `shell:false`,
  sanitized env).
- Only allowlisted Godot version tags are ever cloned — never an arbitrary ref.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET  | `/api/versions` | Supported Godot versions (live from the Godot repo) |
| GET  | `/api/catalog?version=<tag>` | Option catalog (flags + discovered modules + host platforms) |
| POST | `/api/builds/check` | Bundle cache status + time estimate (no enqueue) |
| POST | `/api/builds` | Validate + enqueue (or serve cache); returns one job |
| GET  | `/api/builds/:jobId/events` | SSE: live log, status, completion |
| GET  | `/api/builds/:jobId` | Job status (polling fallback) |
| GET  | `/api/builds/:cacheKey/download` | Download the compiled artifact |
| GET  | `/api/health` | Liveness probe |
| GET  | `/api/ready` | Readiness: queue depth, free disk, available platforms |
| GET  | `/api/metrics` | Process counters (requests, responses, builds, queue) |

The web app also exposes `/privacy` and `/terms` pages, a `robots.txt`, and a
`/.well-known/security.txt`.

## License

MIT — see [`LICENSE`](./LICENSE). Godot Engine is a separate MIT-licensed project
and a trademark of the Godot Foundation; this service is not affiliated with it.
