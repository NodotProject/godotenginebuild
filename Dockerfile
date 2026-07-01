# syntax=docker/dockerfile:1
# Godot build service — Linux + Windows (mingw) + macOS (osxcross) cross-compile.
#
# All three platforms build inside this image. macOS is cross-compiled with
# osxcross against an Apple SDK that is fetched at build time (the SDK is
# Apple-licensed and not redistributable, so it is pulled from MACOS_SDK_URL —
# override it to point at your own SDK tarball if you prefer). The macOS template
# is ad-hoc signed with rcodesign so its arm64 slice loads on Apple Silicon.

# ---------------------------------------------------------------------------
# Stage 1 — build the osxcross macOS cross toolchain from an Apple SDK tarball.
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS osxcross

# Apple SDK tarball used to assemble the toolchain. Pin a version your target
# Godot releases support (4.3+ wants a reasonably recent SDK).
ARG MACOS_SDK_URL=https://github.com/joseluisq/macosx-sdks/releases/download/14.5/MacOSX14.5.sdk.tar.xz

# clang-19, not Debian's default clang-14: the macOS 14.5 SDK headers
# (CoreText/AppKit) miscompile under clang-14 ("unknown type name
# 'CFAttributedStringRef'"), and Godot's Apple sources reference the visionOS
# availability platform, which clang only learned in 17. osxcross resolves the
# bare `clang`/`clang++` it was configured with at runtime, so the version put on
# PATH here (and matched in the runtime stage) is what every macOS build uses.
RUN apt-get update && apt-get install -y --no-install-recommends \
      clang-19 llvm-19-dev libssl-dev liblzma-dev libxml2-dev uuid-dev \
      cmake make patch git python3 bash xz-utils bzip2 cpio zlib1g-dev \
      libbz2-dev curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && update-alternatives --install /usr/bin/clang clang /usr/bin/clang-19 100 \
  && update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-19 100

RUN git clone --depth 1 https://github.com/tpoechtrager/osxcross /osxcross
# Keep the SDK's original filename so osxcross can infer its version from it.
RUN curl -fSL "$MACOS_SDK_URL" -o "/osxcross/tarballs/$(basename "$MACOS_SDK_URL")"
RUN cd /osxcross && UNATTENDED=1 ./build.sh

# ---------------------------------------------------------------------------
# Stage 2 — the service image (API + built web bundle) with all three toolchains.
# ---------------------------------------------------------------------------
FROM node:20-bookworm

# Engine build deps (mirror README "Quick start" apt set) + llvm (for llvm-lipo,
# used to fuse the macOS arm64/x86_64 slices) + lld-19 (ld64.lld — osxcross's
# cctools ld64-711 is too old to synthesize the `_objc_msgSend$<selector>` stubs
# that modern MoltenVK static libs reference; ld64.lld does) + tini as PID 1 so
# scons' grandchild processes are reaped and SIGTERM reaches Node cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini build-essential git pkg-config python3 scons zip mingw-w64 \
      llvm-19 clang-19 lld-19 \
      libx11-dev libxcursor-dev libxinerama-dev libxrandr-dev libxi-dev \
      libasound2-dev libpulse-dev libudev-dev libgl1-mesa-dev libglu1-mesa-dev \
      libwayland-dev wayland-protocols libxkbcommon-dev ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Godot's Windows build requires the POSIX-threads mingw variant; Debian defaults
# to the win32 variant, which scons rejects ("not using posix threads").
RUN update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix \
 && update-alternatives --set x86_64-w64-mingw32-gcc /usr/bin/x86_64-w64-mingw32-gcc-posix

# The osxcross wrappers invoke bare `clang`/`clang++`; expose clang-19 under those
# names so the macOS toolchain resolves the same compiler it was built against.
RUN update-alternatives --install /usr/bin/clang clang /usr/bin/clang-19 100 \
 && update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-19 100

# Put ld64.lld on PATH so the macOS link step's `-fuse-ld=lld` resolves it (Debian
# keeps it under the versioned llvm libdir, off PATH). This is the linker that can
# emit the Objective-C msgSend selector stubs that osxcross's ld64 cannot.
RUN ln -sf /usr/lib/llvm-19/bin/ld64.lld /usr/local/bin/ld64.lld

# macOS cross toolchain from stage 1. Godot's scons finds it via OSXCROSS_ROOT
# (it expects "$OSXCROSS_ROOT/target/bin"); the wrappers also need to be on PATH.
COPY --from=osxcross /osxcross/target /opt/osxcross/target
ENV OSXCROSS_ROOT=/opt/osxcross
ENV PATH="/opt/osxcross/target/bin:${PATH}"
# osxcross's cctools `ld` is dynamically linked against libxar/libtapi, which it
# builds and stages under target/lib (not a system path). Register that dir with
# the loader or `ld` aborts with "libxar.so.1: cannot open shared object file".
RUN echo /opt/osxcross/target/lib > /etc/ld.so.conf.d/osxcross.conf && ldconfig
# Godot's Metal driver compiles with -fmodules; the community macOS 14.5 SDK
# ships a duplicate libxml2 modulemap under usr/include/libxml that collides with
# usr/include/libxml2 ("redefinition of module 'libxml2'"). Drop the stray copy.
RUN rm -f /opt/osxcross/target/SDK/MacOSX14.5.sdk/usr/include/libxml/module.modulemap
# Godot's universal-binary step and the macOS host probe call a bare `lipo`;
# llvm-lipo is a drop-in for the `-create` we use and is host-arch independent.
# Debian ships it version-suffixed (llvm-lipo-19), so resolve whichever exists.
RUN set -eu; \
    src="$(command -v llvm-lipo || ls /usr/bin/llvm-lipo-* 2>/dev/null | sort -V | tail -1)"; \
    test -n "$src"; \
    ln -sf "$src" /usr/local/bin/lipo; \
    test -x /usr/local/bin/lipo

# Darwin compiler-rt builtins. Godot's Objective-C sources use `@available`, which
# clang lowers to a call to `__isPlatformVersionAtLeast` — a builtin that lives in
# libclang_rt.osx.a. Debian's clang ships only the Linux runtimes, and osxcross
# doesn't build the darwin runtime by default, so the macOS link fails with an
# undefined `___isPlatformVersionAtLeast`. The full runtime needs an LLVM-source
# cmake build; we only need that one builtin, so compile its single source file
# (os_version_check.c, pinned to the clang version) for both arches into the
# archive clang auto-links from its resource dir.
RUN set -eu; \
    rtdir="$(arm64-apple-darwin23.5-clang -print-runtime-dir)"; \
    mkdir -p "$rtdir"; \
    curl -fSL "https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-19.1.7/compiler-rt/lib/builtins/os_version_check.c" -o /tmp/os_version_check.c; \
    arm64-apple-darwin23.5-clang  -O2 -c /tmp/os_version_check.c -o /tmp/osvc.arm64.o; \
    x86_64-apple-darwin23.5-clang -O2 -c /tmp/os_version_check.c -o /tmp/osvc.x86_64.o; \
    arm64-apple-darwin23.5-ar  rcs /tmp/osvc.arm64.a  /tmp/osvc.arm64.o; \
    x86_64-apple-darwin23.5-ar rcs /tmp/osvc.x86_64.a /tmp/osvc.x86_64.o; \
    lipo -create /tmp/osvc.arm64.a /tmp/osvc.x86_64.a -output "$rtdir/libclang_rt.osx.a"; \
    rm -f /tmp/os_version_check.c /tmp/osvc.*; \
    llvm-nm-19 "$rtdir/libclang_rt.osx.a" | grep -q isPlatformVersionAtLeast

# rcodesign (apple-codesign) for ad-hoc signing the macOS template on Linux.
ARG RCODESIGN_VERSION=0.29.0
RUN curl -fSL "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      | tar -xz -C /tmp \
  && install -m 0755 "/tmp/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl/rcodesign" /usr/local/bin/rcodesign \
  && rm -rf /tmp/apple-codesign-*

# MoltenVK static lib — Godot's macOS build links libMoltenVK.a for its Vulkan
# backend and aborts if absent. Stage the universal static xcframework where
# Godot's `vulkan_sdk_path` lookup finds it ("<path>/MoltenVK/MoltenVK.xcframework").
#
# Pinned to 1.3.0, not latest: MoltenVK 1.4.x is built against the macOS 15 SDK and
# references Metal classes that only exist there (e.g. MTLResidencySetDescriptor),
# so it fails to link against our macOS 14.5 SDK with an undefined ObjC class. 1.3.0
# is the newest release that stays within the 14.x SDK surface. The post-copy check
# fails the build if a future bump reintroduces a macOS 15-only symbol.
ARG MOLTENVK_VERSION=1.3.0
RUN curl -fSL "https://github.com/KhronosGroup/MoltenVK/releases/download/v${MOLTENVK_VERSION}/MoltenVK-macos.tar" -o /tmp/mvk.tar \
  && tar -xf /tmp/mvk.tar -C /tmp \
  && mkdir -p /opt/vulkan-sdk/MoltenVK \
  && cp -a /tmp/MoltenVK/MoltenVK/static/MoltenVK.xcframework /opt/vulkan-sdk/MoltenVK/MoltenVK.xcframework \
  && rm -rf /tmp/mvk.tar /tmp/MoltenVK \
  && ! llvm-nm-19 /opt/vulkan-sdk/MoltenVK/MoltenVK.xcframework/macos-arm64_x86_64/libMoltenVK.a \
       | grep -q MTLResidencySetDescriptor
ENV VULKAN_SDK_PATH=/opt/vulkan-sdk

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
    WEB_DIST=/app/apps/web/dist \
    BUILD_PLATFORMS=linuxbsd,windows,macos

# All mutable state lives on a volume; run as an unprivileged user that owns it.
RUN useradd -m -u 10001 builder && mkdir -p /data && chown -R builder:builder /data
USER builder
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]
