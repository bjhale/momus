# ADR-0033: The rendering environment is one gated value, set by the Docker image

**Date:** 2026-10-18 · **Status:** Accepted · **Implements:** [RFC-0006](../rfcs/0006-capture-determinism-and-diff-quality.md)

## Context

GPU compositing, font hinting and subpixel text vary by host, so a baseline
captured in the Docker image and a dev capture on a laptop differ on nearly
every page with no code change. RFC-0006 makes the image the reference
rendering environment and asks that a mismatch be refused, not diffed.

## Decision

**`MOMUS_RENDERING` names the environment: `pinned` or `host`.** The Dockerfile
sets `pinned`. Unset or empty means `host`. Any other value is a config error
(exit 2): a typo would otherwise silently turn into `host`, and the result, a
refused pinned baseline, would be hard to trace back to it.

**Pinned launches Chromium with fixed flags**: `--disable-gpu`,
`--font-render-hinting=none`, `--disable-font-subpixel-positioning`,
`--disable-lcd-text`, `--force-color-profile=srgb`. Firefox and WebKit get no
flags; for them, pinned means the image's fixed fonts and libraries. The device
scale factor was already fixed at 1 everywhere.

**The snapshot records one value, `rendering`, and the gate compares it**
(migration v5; NULL reads as `host`, which is true of every older baseline).
The flags themselves aren't recorded or compared: they're an implementation
detail of `pinned`, so tuning them is a momus change, not a reason to refuse
every baseline. The run's baseline identity JSON includes `rendering`.

An environment variable rather than a config key, because it describes where
momus runs, not what the project wants. A config key would let a laptop claim
to be the image.

## Consequences

- A pinned baseline can't be diffed outside the image, and the reverse. CI and
  local runs must agree, or keep separate DBs.
- Anyone can set `MOMUS_RENDERING=pinned` outside the image. They get the
  flags, not the image's fonts; that is their call, and the RFC's non-goal
  already says captures outside the image are best effort.
- Changing the pinned flags in a momus release silently shifts pinned
  captures. Releases that do so should say so.
- The engine version is still not gated; that is RFC-0006's remaining open
  question.
