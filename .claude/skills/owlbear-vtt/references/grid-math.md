# Grid math

All world coordinates are in scene units. `s = grid.dpi` = size of one cell.

## Square grid
- Cell of point p: `(floor(p.x / s), floor(p.y / s))`.
- Snap to center: `((floor(x/s) + 0.5) * s, ...)`. Snap to corner: `(round(x/s) * s, ...)`.
- Tokens with an **odd** size in cells snap to centers. **Even** sizes snap to corners. OBR's
  `snapPosition(pos, sensitivity, useCorners, useCenter)` picks the nearest allowed point within
  `sensitivity * s`.
- Distance in cells between a and b (dx, dy = |cell delta|):
  - CHEBYSHEV: `max(dx, dy)` (D&D 5e default: diagonals cost 1)
  - ALTERNATING: `max + floor(min / 2)` (5-10-5 diagonals, Pathfinder)
  - MANHATTAN: `dx + dy`
  - EUCLIDEAN: `hypot(Δx, Δy) / s` using raw positions (not cells)
- Displayed measurement = `cells * scale.multiplier` + `scale.unit`, e.g. `"5ft"` → 3 cells = `15ft`.

## Hex grids (cell size s = distance between opposite flat sides)
- HEX_VERTICAL = pointy-top (columns are vertical). HEX_HORIZONTAL = flat-top.
- Pointy-top: hex "radius" `r = s / √3`, width `s`, height `2r`. Axial conversion:
  `q = (√3/3 * x - 1/3 * y) / r`, `rr = (2/3 * y) / r`. Round with cube rounding.
- Flat-top: swap the roles of x and y.
- Distance = cube distance `(|dq| + |dr| + |dq + dr|) / 2` (measurement mode is ignored).
- Snap = center of the rounded hex.

## Image scale
An image whose source has `image.grid.dpi` pixels per cell renders at scale
`grid.dpi / image.grid.dpi`, offset by `-image.grid.offset`. A 1-cell token image of 300 px is `dpi: 300`.
A battle map 3000 px wide with 30 cells across is `dpi: 100`.
