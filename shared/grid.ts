import type { Grid, Vector2 } from "./types";

export interface ParsedScale {
  multiplier: number;
  unit: string;
  digits: number;
}

/** Parse "5ft" / "1.5 m" / "1" into multiplier + unit, like OBR's GridScale. */
export function parseScale(raw: string): ParsedScale {
  const m = raw.trim().match(/^(\d*\.?\d+)\s*(.*)$/);
  if (!m) return { multiplier: 1, unit: "", digits: 0 };
  const num = m[1];
  const dot = num.indexOf(".");
  return { multiplier: parseFloat(num), unit: m[2].trim(), digits: dot === -1 ? 0 : num.length - dot - 1 };
}

const SQRT3 = Math.sqrt(3);

interface Axial {
  q: number;
  r: number;
}

function cubeRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

/** Hex "radius" (center → corner) for a grid whose cell size (flat side to flat side) is dpi. */
export function hexRadius(grid: Grid): number {
  return grid.dpi / SQRT3;
}

export function pointToHex(grid: Grid, p: Vector2): Axial {
  const size = hexRadius(grid);
  if (grid.type === "HEX_VERTICAL") {
    // pointy-top
    return cubeRound(((SQRT3 / 3) * p.x - (1 / 3) * p.y) / size, ((2 / 3) * p.y) / size);
  }
  // flat-top
  return cubeRound(((2 / 3) * p.x) / size, ((-1 / 3) * p.x + (SQRT3 / 3) * p.y) / size);
}

export function hexToPoint(grid: Grid, h: Axial): Vector2 {
  const size = hexRadius(grid);
  if (grid.type === "HEX_VERTICAL") {
    return { x: size * (SQRT3 * h.q + (SQRT3 / 2) * h.r), y: size * ((3 / 2) * h.r) };
  }
  return { x: size * ((3 / 2) * h.q), y: size * ((SQRT3 / 2) * h.q + SQRT3 * h.r) };
}

/** Corner points of the hex centred at `center`. */
export function hexCorners(grid: Grid, center: Vector2): Vector2[] {
  const size = hexRadius(grid);
  const offset = grid.type === "HEX_VERTICAL" ? 30 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - offset) * Math.PI) / 180;
    return { x: center.x + size * Math.cos(a), y: center.y + size * Math.sin(a) };
  });
}

/**
 * Snap a world position to the grid.
 * `sizeInCells` controls square-grid behaviour: odd sizes snap to cell centres, even sizes to corners.
 */
export function snapPosition(grid: Grid, p: Vector2, sizeInCells = 1): Vector2 {
  if (grid.type === "SQUARE") {
    const s = grid.dpi;
    const even = Math.round(sizeInCells) % 2 === 0;
    if (even) return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
    return { x: (Math.floor(p.x / s) + 0.5) * s, y: (Math.floor(p.y / s) + 0.5) * s };
  }
  return hexToPoint(grid, pointToHex(grid, p));
}

/** Distance between two world points in grid cells, honouring the grid's measurement rule. */
export function gridDistance(grid: Grid, a: Vector2, b: Vector2): number {
  if (grid.type !== "SQUARE") {
    const ha = pointToHex(grid, a);
    const hb = pointToHex(grid, b);
    const dq = ha.q - hb.q;
    const dr = ha.r - hb.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }
  const s = grid.dpi;
  if (grid.measurement === "EUCLIDEAN") return Math.hypot(b.x - a.x, b.y - a.y) / s;
  const dx = Math.abs(Math.floor(b.x / s) - Math.floor(a.x / s));
  const dy = Math.abs(Math.floor(b.y / s) - Math.floor(a.y / s));
  switch (grid.measurement) {
    case "CHEBYSHEV":
      return Math.max(dx, dy);
    case "MANHATTAN":
      return dx + dy;
    case "ALTERNATING":
      return Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
  }
}

/** Human-readable measurement such as "15ft". */
export function formatDistance(grid: Grid, cells: number): string {
  const scale = parseScale(grid.scale);
  const value = cells * scale.multiplier;
  const digits = grid.measurement === "EUCLIDEAN" && grid.type === "SQUARE" ? Math.max(1, scale.digits) : scale.digits;
  return `${Number(value.toFixed(digits))}${scale.unit}`;
}

/** Render scale for an image so its own grid lines up with the scene grid. */
export function imageScale(grid: Grid, imageDpi: number): number {
  return grid.dpi / imageDpi;
}
