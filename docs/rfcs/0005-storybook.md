# RFC-0005: Storybook stories as targets

**Status:** Withdrawn · **Milestone:** ~~M4~~ · **Created:** 2026-10-16

> **Withdrawn 2026-10-17.** momus won't add anything Storybook-specific: no
> `storybook` source, no `index.json` discovery, no `parameters.momus`. A
> story's iframe URL (`/iframe.html?id=<id>&viewMode=story`) can be listed in
> `urlList` like any page, since query strings are kept
> ([ADR-0014](../adr/0014-urllist-normalized-to-paths.md)). Element capture
> and setup steps come from [RFC-0004](0004-scripted-interactions.md) and apply
> to stories the same way. The text below is kept as the record of what was
> proposed.

## Summary

Add a `storybook` target source. It reads a Storybook build's `index.json`,
turns each story into a target, and captures each story's isolated iframe
rendering. Diffs then happen at the component level, before a component reaches
any page.

## Motivation

Page-level diffs tell you *that* something changed. Story-level diffs tell you
*which component* changed, and they catch changes to components no page
currently renders. Storybook is the de facto component catalogue, and
component-level visual testing is where much of the industry already is.

## Today

Not supported. A story iframe URL could be listed in `urlList` by hand, but
there are no story ids, no args, no per-story parameters, and the report labels
each one with its raw URL.

## Proposal

```ts
storybook: {
  dev: "http://localhost:6006",          // or a static build directory
  prod: "./storybook-static-main",       // or a deployed main-branch Storybook
  include: ["components-*"],              // story-id globs
  exclude: ["*--playground"],
},
```

- **Discovery:** fetch `<base>/index.json` (Storybook 7+). Keep entries where
  `type === "story"`. Target `id` is `storybook:<story id>`, `label` is
  `title / name`, and `path` is `/<story id>`, so the existing globs work.
- **Capture:** load `iframe.html?id=<id>&viewMode=story`, wait for Storybook to
  report that the story rendered, then capture the story's root element (not
  the full page) by default.
- **Static builds:** when `dev` or `prod` is a directory, serve it locally for
  the run with `Bun.serve`. CI typically has a `storybook-static/` folder and
  no running server.
- **Per-story parameters:** read a `momus` key from story `parameters`
  (`{ skip, viewports, mask, steps, delayMs }`). Settings stay next to the
  component instead of in one central config.
- **The baseline is a main-branch build.** Most teams have no "prod
  Storybook." In 1.x the baseline is always a snapshot of `prod`
  ([ADR-0028](../adr/0028-approval-belongs-to-the-server.md)), so `prod` points at a Storybook built from the default
  branch: a static build directory or a deployed one.

## Non-goals

- Support for Storybook versions older than 7 (no `index.json`).
- Other component catalogues (Ladle, Histoire). The target-source interface
  makes them possible; nobody has asked for them yet.
- Running Storybook's own test runner or play functions. Play functions are an
  open question.

## Compatibility

Purely additive. Story recipes, meaning per-story `mask` and `steps`, join the
per-target compatibility gate ([RFC-0001](0001-targets.md)).

## Open questions

- **Play functions:** should momus wait for a story's `play` function to finish
  before capture? That would reuse interaction logic teams already wrote, but
  play functions often assert behavior rather than set up a visual state.
- How should momus detect that a story finished rendering, given Storybook
  changes its internal render events between versions? Is there a public signal
  that is stable across 7, 8 and later?
- Is the story's root element the right default capture, or should it be the
  whole iframe viewport, which includes decorators?

## Done when

- [ ] Stories are discovered from a served Storybook and from a static build
      directory.
- [ ] Story id globs and `parameters.momus` work.
- [ ] e2e against a checked-in minimal Storybook static build fixture.
- [ ] A documented recipe for "Storybook in CI against a main-branch build."
