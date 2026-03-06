/**
 * Dense 2D Grid Packing Engine — v2
 *
 * Fine-grained hidden lattice (12 units wide on desktop).
 * Best-fit placement with fragmentation scoring.
 * Multi-pass compaction with hole scanning.
 * True pinning: fixed-position vs floating.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface Footprint { w: number; h: number }

export interface GridItem {
  id: string;
  footprint: Footprint;
  /** Alternate smaller footprints this card can use to fill tighter spaces */
  altFootprints?: Footprint[];
  /** Fixed grid position — immune to compaction */
  pinnedAt?: { x: number; y: number };
  /** Lower = placed first */
  priority?: number;
}

export interface PlacedItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  placements: PlacedItem[];
  rows: number;
  cols: number;
}

// ── Occupancy Grid ─────────────────────────────────────────────────

class OccupancyGrid {
  private cells: (string | null)[][];
  readonly cols: number;
  private _rows: number;

  constructor(cols: number, initialRows = 40) {
    this.cols = cols;
    this._rows = initialRows;
    this.cells = Array.from({ length: initialRows }, () => Array(cols).fill(null));
  }

  get rows() { return this._rows; }

  private grow(needed: number) {
    while (this._rows < needed) {
      this.cells.push(Array(this.cols).fill(null));
      this._rows++;
    }
  }

  canPlace(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.cols) return false;
    this.grow(y + h);
    for (let r = y; r < y + h; r++)
      for (let c = x; c < x + w; c++)
        if (this.cells[r][c] !== null) return false;
    return true;
  }

  place(id: string, x: number, y: number, w: number, h: number) {
    this.grow(y + h);
    for (let r = y; r < y + h; r++)
      for (let c = x; c < x + w; c++)
        this.cells[r][c] = id;
  }

  remove(id: string) {
    for (let r = 0; r < this._rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.cells[r][c] === id) this.cells[r][c] = null;
  }

  /** Count empty cells adjacent to a placement — lower = tighter fit */
  fragmentation(x: number, y: number, w: number, h: number): number {
    let empty = 0;
    // Check cells around the perimeter
    for (let r = y - 1; r <= y + h; r++) {
      for (let c = x - 1; c <= x + w; c++) {
        if (r < 0 || c < 0 || c >= this.cols) continue;
        if (r >= y && r < y + h && c >= x && c < x + w) continue; // skip interior
        this.grow(r + 1);
        if (r < this._rows && this.cells[r][c] === null) empty++;
      }
    }
    return empty;
  }

  /** Find all valid positions for a footprint, scored by quality */
  findBestFit(w: number, h: number): { x: number; y: number } | null {
    let best: { x: number; y: number; score: number } | null = null;
    const maxRow = this.maxOccupiedRow() + h + 2;

    for (let r = 0; r <= maxRow; r++) {
      this.grow(r + h);
      for (let c = 0; c <= this.cols - w; c++) {
        if (!this.canPlace(c, r, w, h)) continue;
        // Score: primary = row (top), secondary = column (left), tertiary = low fragmentation
        const frag = this.fragmentation(c, r, w, h);
        const score = r * 10000 + c * 100 + frag;
        if (!best || score < best.score) {
          best = { x: c, y: r, score };
        }
        // Early exit: can't beat row 0
        if (r === 0 && frag === 0) return { x: c, y: r };
      }
      // If we found something on this row, don't scan further rows
      // (top-preference with best horizontal fit)
      if (best && best.y === r) break;
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** Find first valid position (fast path for compaction) */
  findFirst(w: number, h: number): { x: number; y: number } | null {
    for (let r = 0; ; r++) {
      this.grow(r + h);
      for (let c = 0; c <= this.cols - w; c++) {
        if (this.canPlace(c, r, w, h)) return { x: c, y: r };
      }
      if (r > this.maxOccupiedRow() + h + 5) break;
    }
    return null;
  }

  maxOccupiedRow(): number {
    for (let r = this._rows - 1; r >= 0; r--)
      if (this.cells[r].some(c => c !== null)) return r;
    return -1;
  }

  /** Find all packable holes (empty rectangles that could fit at least minW×minH) */
  findHoles(minW: number, minH: number): { x: number; y: number; w: number; h: number }[] {
    const holes: { x: number; y: number; w: number; h: number }[] = [];
    const maxR = this.maxOccupiedRow();
    const visited = new Set<string>();

    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c] !== null) continue;
        const key = `${r},${c}`;
        if (visited.has(key)) continue;

        // Measure hole extent
        let maxW = 0;
        while (c + maxW < this.cols && this.cells[r][c + maxW] === null) maxW++;
        let maxH = 1;
        outer: while (r + maxH <= maxR) {
          for (let cc = c; cc < c + maxW; cc++) {
            this.grow(r + maxH + 1);
            if (this.cells[r + maxH][cc] !== null) break outer;
          }
          maxH++;
        }

        if (maxW >= minW && maxH >= minH) {
          holes.push({ x: c, y: r, w: maxW, h: maxH });
        }
        for (let rr = r; rr < r + maxH; rr++)
          for (let cc = c; cc < c + maxW; cc++)
            visited.add(`${rr},${cc}`);
      }
    }
    return holes;
  }
}

// ── Layout Engine ──────────────────────────────────────────────────

function sortForPlacement(items: GridItem[]): GridItem[] {
  return [...items].sort((a, b) => {
    // Pinned-at items first (they have fixed positions)
    if (a.pinnedAt && !b.pinnedAt) return -1;
    if (!a.pinnedAt && b.pinnedAt) return 1;
    // Priority (feed order) is primary — preserves chronological reading
    const pa = a.priority ?? 50;
    const pb = b.priority ?? 50;
    return pa - pb;
  });
}

export function computeLayout(items: GridItem[], cols: number): LayoutResult {
  const grid = new OccupancyGrid(cols);
  const placements = new Map<string, PlacedItem>();
  const sorted = sortForPlacement(items);
  const pinnedIds = new Set<string>();

  // Phase 1: Place pinned cards at their fixed positions
  for (const item of sorted) {
    if (!item.pinnedAt) continue;
    const { w, h } = item.footprint;
    const cw = Math.min(w, cols);
    const { x, y } = item.pinnedAt;
    if (grid.canPlace(x, y, cw, h)) {
      grid.place(item.id, x, y, cw, h);
      placements.set(item.id, { id: item.id, x, y, w: cw, h });
      pinnedIds.add(item.id);
    }
  }

  // Phase 2: Best-fit placement for floating cards
  for (const item of sorted) {
    if (item.pinnedAt) continue;
    const { w, h } = item.footprint;
    const cw = Math.min(w, cols);
    const pos = grid.findBestFit(cw, h);
    if (pos) {
      grid.place(item.id, pos.x, pos.y, cw, h);
      placements.set(item.id, { id: item.id, x: pos.x, y: pos.y, w: cw, h });
    }
  }

  // Phase 3: Multi-pass compaction
  const floatingIds = sorted.filter(i => !i.pinnedAt).map(i => i.id);
  const itemMap = new Map(sorted.map(i => [i.id, i]));
  let changed = true;
  let passes = 0;
  while (changed && passes < 25) {
    changed = false;
    passes++;

    // 3a: Try moving each card to an earlier position
    for (const id of floatingIds) {
      const current = placements.get(id);
      if (!current) continue;
      grid.remove(id);
      const better = grid.findFirst(current.w, current.h);
      if (better && (better.y < current.y || (better.y === current.y && better.x < current.x))) {
        grid.place(id, better.x, better.y, current.w, current.h);
        placements.set(id, { ...current, x: better.x, y: better.y });
        changed = true;
      } else {
        grid.place(id, current.x, current.y, current.w, current.h);
      }
    }

    // 3b: Hole-filling — find holes and try to move a later card into them
    if (!changed) {
      const holes = grid.findHoles(2, 2);
      for (const hole of holes) {
        let filled = false;
        for (const id of floatingIds) {
          const p = placements.get(id);
          if (!p || p.y <= hole.y) continue;
          // Try original size
          if (p.w <= hole.w && p.h <= hole.h) {
            grid.remove(id);
            if (grid.canPlace(hole.x, hole.y, p.w, p.h)) {
              grid.place(id, hole.x, hole.y, p.w, p.h);
              placements.set(id, { ...p, x: hole.x, y: hole.y });
              changed = true;
              filled = true;
              break;
            }
            grid.place(id, p.x, p.y, p.w, p.h);
          }
          // Try alternate (smaller) footprints
          const item = itemMap.get(id);
          if (!item?.altFootprints) continue;
          for (const alt of item.altFootprints) {
            if (alt.w <= hole.w && alt.h <= hole.h) {
              grid.remove(id);
              if (grid.canPlace(hole.x, hole.y, alt.w, alt.h)) {
                grid.place(id, hole.x, hole.y, alt.w, alt.h);
                placements.set(id, { id, x: hole.x, y: hole.y, w: alt.w, h: alt.h });
                changed = true;
                filled = true;
                break;
              }
              grid.place(id, p.x, p.y, p.w, p.h);
            }
          }
          if (filled) break;
        }
        if (changed) break;
      }
    }

    // 3c: Expand cards into adjacent empty space — max 1 unit in each direction
    if (!changed) {
      for (const id of floatingIds) {
        const p = placements.get(id);
        const item = itemMap.get(id);
        if (!p || !item) continue;
        const maxW = item.footprint.w + 1;
        const maxH = item.footprint.h + 1;
        // Try expanding right by 1 unit (only if not already over original)
        if (p.w < maxW && p.x + p.w < cols && grid.canPlace(p.x + p.w, p.y, 1, p.h)) {
          grid.place(id, p.x + p.w, p.y, 1, p.h);
          placements.set(id, { ...p, w: p.w + 1 });
          changed = true;
          break;
        }
        // Try expanding down by 1 unit
        if (p.h < maxH && grid.canPlace(p.x, p.y + p.h, p.w, 1)) {
          grid.place(id, p.x, p.y + p.h, p.w, 1);
          placements.set(id, { ...p, h: p.h + 1 });
          changed = true;
          break;
        }
      }
    }
  }

  return {
    placements: Array.from(placements.values()),
    rows: grid.maxOccupiedRow() + 1,
    cols,
  };
}

// ── Footprint Catalog ──────────────────────────────────────────────

export type CardSize = "tiny" | "small" | "medium" | "wide" | "tall" | "large" | "hero";

// On a 12-unit lattice:
const FOOTPRINTS: Record<CardSize, Footprint> = {
  tiny:   { w: 2, h: 2 },   // compact square
  small:  { w: 3, h: 2 },   // small rectangle
  medium: { w: 3, h: 3 },   // medium square
  wide:   { w: 5, h: 2 },   // wide banner
  tall:   { w: 3, h: 5 },   // tall column
  large:  { w: 5, h: 4 },   // large rectangle
  hero:   { w: 7, h: 4 },   // hero card
};

export function getFootprint(size: CardSize): Footprint {
  return FOOTPRINTS[size];
}

/** Allowed smaller footprints per size — used during hole-filling */
export const ALT_FOOTPRINTS: Record<CardSize, Footprint[] | undefined> = {
  tiny:   undefined,
  small:  [FOOTPRINTS.tiny],
  medium: [FOOTPRINTS.small, FOOTPRINTS.tiny],
  wide:   [FOOTPRINTS.small],
  tall:   [FOOTPRINTS.medium, FOOTPRINTS.small],
  large:  [FOOTPRINTS.wide, FOOTPRINTS.medium],
  hero:   [FOOTPRINTS.large, FOOTPRINTS.wide],
};

// ── Responsive lattice width ───────────────────────────────────────

export function getLatticeColumns(containerWidth: number): number {
  if (containerWidth >= 1400) return 14;
  if (containerWidth >= 1100) return 12;
  if (containerWidth >= 800) return 10;
  if (containerWidth >= 600) return 8;
  return 6;
}

// ── Pixel conversion ───────────────────────────────────────────────

export function toPixelPositions(
  layout: LayoutResult,
  containerWidth: number,
  gap: number,
  rowHeight: number,
): Map<string, { x: number; y: number; w: number; h: number }> {
  const unitW = (containerWidth - gap * (layout.cols - 1)) / layout.cols;
  const result = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const p of layout.placements) {
    result.set(p.id, {
      x: p.x * (unitW + gap),
      y: p.y * (rowHeight + gap),
      w: p.w * unitW + (p.w - 1) * gap,
      h: p.h * rowHeight + (p.h - 1) * gap,
    });
  }
  return result;
}
