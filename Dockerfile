# syntax=docker/dockerfile:1

# momus runs in SOURCE mode here (bun + node_modules), not as the compiled
# single-file binary. Reason: `bun build --compile` cannot fully bundle
# Playwright — at runtime Playwright dynamically resolves `playwright-core` from
# node_modules, so the standalone binary needs node_modules present to run.
# Source mode is exactly the path the test suite and e2e exercise, so it is the
# reliable way to ship a working momus in a container.
#
# The base image ships Chromium plus every OS library/font it needs, matched to
# this Playwright version; this Dockerfile additionally bakes in Firefox and
# WebKit at build time (see below), so all three engines are available. The tag
# MUST track the `playwright` version in bun.lock (currently 1.61.1) — bump both
# together.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# Bun runtime (matches the version momus was built and tested against). Copied
# from the official image so it tracks the target arch under buildx.
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun

# Install dependencies. Bun does not run lifecycle scripts by default, so
# Playwright's browser-download postinstall does NOT fire — we intentionally use
# the Chromium already baked into the base image (same Playwright version).
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Ensure Firefox and WebKit are present so the `browser` config can select any
# engine. The Playwright base image already bundles all three matched browsers,
# so this is a fast no-op that also guarantees the engines if a future base tag
# ships fewer. `bun x` (not `bunx`) — only the `bun` binary is copied in above.
RUN bun x playwright install firefox webkit
COPY tsconfig.json ./
COPY src ./src

# Users mount their project here (config in, report/db out):
#   docker run --rm -v "$PWD:/work" <image> run --config momus.config.ts
WORKDIR /work

ENTRYPOINT ["bun", "run", "/app/src/cli.ts"]
CMD ["--help"]
