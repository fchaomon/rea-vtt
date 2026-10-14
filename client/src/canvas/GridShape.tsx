import { Shape } from "react-konva";
import { hexCorners, hexToPoint, pointToHex } from "../../../shared/grid";
import type { Grid } from "../../../shared/types";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_CELLS = 40_000;

/** Grid lines clipped to `bounds` (the map area, or the viewport when there is no map). */
export function GridShape({ grid, bounds, viewScale }: { grid: Grid; bounds: Bounds; viewScale: number }) {
  if (!grid.style.visible) return null;
  const s = grid.dpi;
  if ((bounds.width / s) * (bounds.height / s) > MAX_CELLS) return null;
  return (
    <Shape
      listening={false}
      stroke={grid.style.lineColor}
      opacity={grid.style.lineOpacity}
      // Keep lines a constant on-screen width regardless of zoom.
      strokeWidth={grid.style.lineWidth / viewScale}
      sceneFunc={(ctx, shape) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.clip();
        ctx.beginPath();
        if (grid.type === "SQUARE") {
          const x0 = Math.floor(bounds.x / s) * s;
          const y0 = Math.floor(bounds.y / s) * s;
          for (let x = x0; x <= bounds.x + bounds.width; x += s) {
            ctx.moveTo(x, bounds.y);
            ctx.lineTo(x, bounds.y + bounds.height);
          }
          for (let y = y0; y <= bounds.y + bounds.height; y += s) {
            ctx.moveTo(bounds.x, y);
            ctx.lineTo(bounds.x + bounds.width, y);
          }
        } else {
          // Walk axial coordinates covering the bounds (padded by one hex).
          const pad = s * 1.2;
          const corners = [
            pointToHex(grid, { x: bounds.x - pad, y: bounds.y - pad }),
            pointToHex(grid, { x: bounds.x + bounds.width + pad, y: bounds.y - pad }),
            pointToHex(grid, { x: bounds.x - pad, y: bounds.y + bounds.height + pad }),
            pointToHex(grid, { x: bounds.x + bounds.width + pad, y: bounds.y + bounds.height + pad }),
          ];
          const qs = corners.map((c) => c.q);
          const rs = corners.map((c) => c.r);
          for (let q = Math.min(...qs); q <= Math.max(...qs); q++) {
            for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
              const c = hexToPoint(grid, { q, r });
              if (c.x < bounds.x - pad || c.x > bounds.x + bounds.width + pad) continue;
              if (c.y < bounds.y - pad || c.y > bounds.y + bounds.height + pad) continue;
              const pts = hexCorners(grid, c);
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
              ctx.closePath();
            }
          }
        }
        ctx.strokeShape(shape);
        ctx.restore();
      }}
    />
  );
}
