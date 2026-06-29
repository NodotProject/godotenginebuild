# Godot build service — Linux + Windows (mingw) cross-compile toolchain.
# macOS templates require osxcross + an Apple SDK and must be built on a host
# that has it; this image intentionally does not include them.
FROM node:20-bookworm

# Engine build dependencies (mirror README "Quick start" apt set) + tini as PID 1
# so scons' grandchild processes are reaped and SIGTERM reaches Node cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini build-essential git pkg-config python3 scons zip mingw-w64 \
      libx11-dev libxcursor-dev libxinerama-dev libxrandr-dev libxi-dev \
      libasound2-dev libpulse-dev libudev-dev libgl1-mesa-dev libglu1-mesa-dev \
      libwayland-dev wayland-protocols libxkbcommon-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Install deps first so the layer is cached unless manifests change.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# Copy the rest and build the static web bundle (served by the API).
COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_ROOT=/data \
    WEB_DIST=/app/apps/web/dist

# All mutable state lives on a volume; run as an unprivileged user that owns it.
RUN useradd -m -u 10001 builder && mkdir -p /data && chown -R builder:builder /data
USER builder
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]
