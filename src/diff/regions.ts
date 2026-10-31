// src/diff/regions.ts
import type { Region } from "../types";

/** Cluster changed pixels into bounding boxes, so a report can say "3 regions
 * changed" and outline them (RFC-0006, ADR-0035). The mask is one byte per
 * pixel, nonzero = changed. Pixels are bucketed into `cell`-sized squares, and
 * marked cells that touch, diagonals included, form one region; each box is
 * tight to the real pixels it holds, not to the cells. So two changes about a
 * cell apart read as one region, and changes further apart as separate ones.
 * Only the `max` largest regions are returned; `count` is the true total. */
export function changeRegions(
  mask: Uint8Array, width: number, height: number, cell = 16, max = 100,
): { regions: Region[]; count: number } {
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  // Per cell: the pixel extents seen in it. minX = Infinity means unmarked.
  const minX = new Float64Array(cols * rows).fill(Infinity);
  const minY = new Float64Array(cols * rows), maxX = new Float64Array(cols * rows), maxY = new Float64Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      const c = row + Math.floor(x / cell);
      if (minX[c] === Infinity) { minX[c] = x; minY[c] = y; maxX[c] = x; maxY[c] = y; continue; }
      if (x < minX[c]!) minX[c] = x;
      if (x > maxX[c]!) maxX[c] = x;
      if (y > maxY[c]!) maxY[c] = y; // rows ascend, so minY is the first seen
    }
  }

  const seen = new Uint8Array(cols * rows);
  const regions: Region[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || minX[start] === Infinity) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      x0 = Math.min(x0, minX[c]!); y0 = Math.min(y0, minY[c]!);
      x1 = Math.max(x1, maxX[c]!); y1 = Math.max(y1, maxY[c]!);
      const cx = c % cols, cy = (c - cx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (!seen[n] && minX[n] !== Infinity) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    regions.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  // Stable sort: equal areas keep reading order (top-left first).
  regions.sort((a, b) => b.width * b.height - a.width * a.height);
  return { regions: regions.slice(0, max), count: regions.length };
}
