# ADR-0042: Each image platform builds on its own architecture

**Date:** 2026-10-30 · **Status:** Accepted

## Context

The release workflow built the multi-arch image in one buildx call on an arm64
runner: arm64 natively, amd64 under QEMU emulation. After the move to Bun 1.4.3
([ADR-0036](0036-bun-1-4-3-one-test-process.md)), the amd64 half aborts at the Dockerfile's
browser launch check. Bun reports `MemoryExhaustion` at a 22 MB peak and QEMU
reports signal 6. JavaScriptCore reserves large regions of virtual address
space at startup, and QEMU's user-mode emulation can't satisfy them. Every
`bun` step after `bun install` would fail the same way. The launch check is
just the first one.

The options were:

- **Skip the launch check when emulating.** That publishes an amd64 image no
  one has started, and the later `bun` steps still crash.
- **Pin Bun back to 1.3.14.** That brings back the fd double-close that ADR-0036
  fixed.
- **Build each platform natively.** amd64 builds on `ubuntu-latest` and arm64
  on `ubuntu-24.04-arm`, each pushes by digest, and a final job joins the
  digests under the release tags with `docker buildx imagetools create`.

## Decision

Native builds, one runner per platform, merged into one manifest list. QEMU is
not set up anywhere in the release workflow.

## Consequences

- The launch check runs on real hardware for both platforms, so each published
  image has started all three browser engines.
- A release takes one more job. The two platform builds run in parallel and
  neither is emulated, so wall-clock time drops.
- Release tags only appear once both platforms have built. A failure on one
  pushes untagged digests and no tags.
- Each platform has its own GitHub Actions cache scope. Sharing one scope
  would make the two builds evict each other's layers.
- Adding a platform means adding a matrix row with a runner of that
  architecture. If no such runner exists, revisit this record instead of
  bringing QEMU back.
