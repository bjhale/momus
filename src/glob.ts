// src/glob.ts
// Tiny glob matcher for URL paths. Interface is pinned regardless of backing
// implementation (spec §6). Supports: literal text, `*` (any chars except `/`),
// `**` (any chars including `/`).
export function matchPath(path: string, pattern: string): boolean {
  const rx = globToRegExp(pattern);
  return rx.test(path);
}

function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "/" && pattern[i + 1] === "*" && pattern[i + 2] === "*") {
      // "/**" matches an empty suffix OR "/anything", so "/blog/**" matches both
      // "/blog" and "/blog/post/comments". Consumes the slash + both stars.
      re += "(?:/.*)?";
      i += 2;
    } else if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"; // bare globstar: cross segments
        i++;
      } else {
        re += "[^/]*"; // single segment
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re);
}
