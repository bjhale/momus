// src/version.ts
import pkg from "../package.json";

/** Recorded on every run (RFC-0002). The Docker image runs from source, so
 * package.json is always present; the release workflow checks that the tag
 * matches it. */
export const MOMUS_VERSION: string = pkg.version;
