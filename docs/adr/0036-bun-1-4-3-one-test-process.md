# ADR-0036: Bun 1.4.3, because 1.3.14 double-closes child-process descriptors; browser tests share one process again

**Date:** 2026-10-19 · **Status:** Accepted · **Supersedes:** [ADR-0031](0031-per-engine-test-processes.md)

## Context

The browser tests flaked: "Target page, context or browser has been closed"
in whichever e2e file was unlucky, Bun segfaults and SIGILL crashes, a
`browser.close()` that never settled, and later launches failing once a second
engine had run in the process (the reason for ADR-0031). On the WSL dev host
about two full runs in three failed.

`strace -f -y` showed one cause behind all of them. When Playwright closes a
browser, Bun 1.3.14 closes that child's stdio sockets, and then, seconds later
at an unpredictable moment, closes the same descriptor numbers a second time.
By then the kernel has reused them: for the next browser's
`--remote-debugging-pipe` socket (the test sees the browser close), or for a
Worker's epoll (Bun crashes). The traces show the same pair of numbers closed at
`browser.close()` and again about four seconds later, while the browser using
them was mid-test. Neither momus nor Playwright touches descriptors.

Bun 1.4.3 on the same host: 16 of 16 full runs clean, and no repeated closes in
the trace. The ADR-0031 symptom (a second engine in the process) and the hang
that once forced two browser test files into their own processes are gone too.
An isolated Docker container made the 1.3.14 race rare (0 of 17) but not
absent (2 of 14 sharing the host's PID namespace), so a container hides it
rather than fixing it.

## Decision

**Bun is 1.4.3** in the Dockerfile and the release workflow, which also gives
the shipped image the fix: `momus run` spawns browsers through the same code.

**Every browser test runs in the one `bun test` process.** Multi-engine files
loop over all three engines by default, each skipped where it can't launch
(WebKit on WSL); `MOMUS_ENGINE` narrows to one. `test:engines` is gone.
"One browser per file" stays, as a speed convention, not a workaround.

## Consequences

- `bun run test` is a single `bun test` again.
- If browser tests start flaking again, check the Bun version first. The
  signature is a burst of `close()` calls returning EBADF on Bun's main thread
  (`strace -f -e trace=close`).
- A Bun downgrade below 1.4.3 brings all of this back.
