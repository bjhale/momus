# ADR-0003: Pad mismatched screenshots, never scale

**Date:** 2026-07-03 · **Status:** Accepted

## Context

momus takes **full-page** screenshots, so dev and prod images routinely differ in
height — that is often the very change being detected. `pixelmatch` requires both
inputs to have identical dimensions, so something has to reconcile them.

The two options are scaling the smaller image up, or padding it out.

## Decision

**Pad** the smaller image with transparent pixels to the pair's
`max(width) × max(height)` before diffing. Never scale.

## Consequences

- Scaling would resample every pixel in one image and produce diff noise across
  the entire page — the comparison would be meaningless. Padding leaves every
  real pixel byte-identical to what was captured.
- The padded region reads as a diff, which is correct: the page changed size.
- Height differences therefore produce large diff scores. That is intended
  signal, not a false positive, but it does mean a page that grew by one section
  scores high.
- Normalization lives in `src/diff/normalize.ts`, separate from the diff itself,
  and is unit-tested against fixture PNGs of differing sizes.
