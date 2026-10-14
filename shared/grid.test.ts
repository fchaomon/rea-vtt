import { describe, expect, it } from "vitest";
import { formatDistance, gridDistance, hexToPoint, parseScale, pointToHex, snapPosition } from "./grid";
import { DEFAULT_GRID, type Grid } from "./types";

const square = (measurement: Grid["measurement"]): Grid => ({ ...DEFAULT_GRID, dpi: 100, measurement });
const cell = (cx: number, cy: number) => ({ x: cx * 100 + 50, y: cy * 100 + 50 });

describe("parseScale", () => {
  it("parses number and unit", () => {
    expect(parseScale("5ft")).toEqual({ multiplier: 5, unit: "ft", digits: 0 });
    expect(parseScale("1.5 m")).toEqual({ multiplier: 1.5, unit: "m", digits: 1 });
    expect(parseScale("garbage")).toEqual({ multiplier: 1, unit: "", digits: 0 });
  });
});

describe("square snapping", () => {
  it("snaps odd-sized tokens to cell centres", () => {
    expect(snapPosition(square("CHEBYSHEV"), { x: 130, y: 280 }, 1)).toEqual({ x: 150, y: 250 });
  });
  it("snaps even-sized tokens to corners", () => {
    expect(snapPosition(square("CHEBYSHEV"), { x: 130, y: 280 }, 2)).toEqual({ x: 100, y: 300 });
  });
});

describe("square distance", () => {
  const a = cell(0, 0);
  const b = cell(3, 2);
  it("chebyshev counts diagonals as 1", () => expect(gridDistance(square("CHEBYSHEV"), a, b)).toBe(3));
  it("manhattan disallows diagonals", () => expect(gridDistance(square("MANHATTAN"), a, b)).toBe(5));
  it("alternating charges every second diagonal double", () => {
    expect(gridDistance(square("ALTERNATING"), a, b)).toBe(4);
    expect(gridDistance(square("ALTERNATING"), a, cell(4, 4))).toBe(6);
  });
  it("euclidean uses raw positions", () => expect(gridDistance(square("EUCLIDEAN"), a, b)).toBeCloseTo(Math.hypot(3, 2)));
  it("formats with the scale", () => expect(formatDistance(square("CHEBYSHEV"), 3)).toBe("15ft"));
});

describe.each(["HEX_VERTICAL", "HEX_HORIZONTAL"] as const)("%s", (type) => {
  const grid: Grid = { ...DEFAULT_GRID, dpi: 100, type };
  it("round-trips hex centres", () => {
    for (const h of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }]) {
      expect(pointToHex(grid, hexToPoint(grid, h))).toEqual(h);
    }
  });
  it("adjacent hex centres are one cell (dpi) apart", () => {
    const a = hexToPoint(grid, { q: 0, r: 0 });
    const b = hexToPoint(grid, { q: 1, r: 0 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100);
  });
  it("measures hex distance", () => {
    expect(gridDistance(grid, hexToPoint(grid, { q: 0, r: 0 }), hexToPoint(grid, { q: 3, r: -1 }))).toBe(3);
  });
  it("snaps to the nearest hex centre", () => {
    const c = hexToPoint(grid, { q: 2, r: 1 });
    expect(snapPosition(grid, { x: c.x + 10, y: c.y - 12 })).toEqual(c);
  });
});
