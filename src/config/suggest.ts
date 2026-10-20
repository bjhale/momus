// src/config/suggest.ts
import { z } from "zod";

/** Edit distance, for "did you mean". Configs are small; O(n·m) is fine. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The known key closest to a typo, or nothing when none is plausibly meant:
 * a suggestion that's wrong is worse than none. */
export function suggest(key: string, known: readonly string[]): string | undefined {
  const k = key.toLowerCase();
  const limit = Math.max(2, Math.floor(key.length / 3));
  let best: string | undefined, bestD = Infinity;
  for (const c of known) {
    const d = distance(k, c.toLowerCase());
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= limit && bestD < key.length ? best : undefined;
}

/** Strip the wrappers that don't change which keys an object takes. */
function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  for (;;) {
    if (s instanceof z.ZodDefault) s = s._def.innerType;
    else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodEffects) s = s.innerType();
    else return s;
  }
}

function objects(s: z.ZodTypeAny): z.AnyZodObject[] {
  const u = unwrap(s);
  if (u instanceof z.ZodObject) return [u];
  if (u instanceof z.ZodUnion) return (u.options as z.ZodTypeAny[]).flatMap(objects);
  return [];
}

/** The keys the object at `path` in `schema` accepts, as Zod paths spell it
 * (array indices included). Empty when the path isn't an object. */
export function knownKeys(schema: z.ZodTypeAny, path: ReadonlyArray<string | number>): string[] {
  let level: z.ZodTypeAny[] = [schema];
  for (const seg of path) {
    level = level.flatMap((s) => {
      if (typeof seg === "number") {
        const u = unwrap(s);
        return u instanceof z.ZodArray ? [u.element as z.ZodTypeAny] : [];
      }
      return objects(s).flatMap((o) => (Object.hasOwn(o.shape, seg) ? [o.shape[seg] as z.ZodTypeAny] : []));
    });
  }
  return [...new Set(level.flatMap(objects).flatMap((o) => Object.keys(o.shape)))];
}
