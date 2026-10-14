import { imageScale } from "../../shared/grid";
import type {
  CurveItem,
  Grid,
  ImageItem,
  Item,
  ItemBase,
  Layer,
  LineItem,
  ShapeItem,
  ShapeStyle,
  TextItem,
  Vector2,
} from "../../shared/types";
import { get } from "./store";

function base(layer: Layer, name: string, position: Vector2): ItemBase {
  const userId = get().self?.id ?? "";
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    locked: false,
    createdUserId: userId,
    zIndex: Date.now(),
    lastModified: new Date().toISOString(),
    lastModifiedUserId: userId,
    position,
    rotation: 0,
    scale: { x: 1, y: 1 },
    layer,
    metadata: {},
  };
}

export function createImage(
  layer: Layer,
  name: string,
  position: Vector2,
  image: ImageItem["image"],
  dpi: number,
  centered: boolean,
): ImageItem {
  return {
    ...base(layer, name, position),
    type: "IMAGE",
    image,
    grid: { dpi, offset: centered ? { x: image.width / 2, y: image.height / 2 } : { x: 0, y: 0 } },
  };
}

export function createShape(
  layer: Layer,
  shapeType: ShapeItem["shapeType"],
  position: Vector2,
  width: number,
  height: number,
  style: ShapeStyle,
  label?: string,
): ShapeItem {
  return { ...base(layer, shapeType.toLowerCase(), position), type: "SHAPE", shapeType, width, height, style, label };
}

export function createCurve(layer: Layer, points: Vector2[], closed: boolean, style: ShapeStyle): CurveItem {
  const origin = points[0];
  return {
    ...base(layer, closed ? "polygon" : "drawing", origin),
    type: "CURVE",
    points: points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })),
    closed,
    tension: 0,
    style,
  };
}

export function createLine(layer: Layer, start: Vector2, end: Vector2, style: ShapeStyle): LineItem {
  return {
    ...base(layer, "line", start),
    type: "LINE",
    startPosition: { x: 0, y: 0 },
    endPosition: { x: end.x - start.x, y: end.y - start.y },
    style,
  };
}

export function createText(position: Vector2, text: string, color: string, fontSize: number): TextItem {
  return { ...base("TEXT", text.slice(0, 20), position), type: "TEXT", text, color, fontSize };
}

export function styleFrom(stroke: string, fill: string, fillOpacity: number, strokeWidth: number): ShapeStyle {
  return { strokeColor: stroke, strokeOpacity: 1, strokeWidth, strokeDash: [], fillColor: fill, fillOpacity };
}

/** Size of a token in grid cells, used to choose centre vs corner snapping. */
export function sizeInCells(item: Item, grid: Grid): number {
  switch (item.type) {
    case "IMAGE":
      return (item.image.width * imageScale(grid, item.grid.dpi) * item.scale.x) / grid.dpi;
    case "SHAPE":
      return (item.width * item.scale.x) / grid.dpi;
    default:
      return 1;
  }
}

/** Layers whose items snap to the grid when dropped. */
export const SNAP_LAYERS: Layer[] = ["CHARACTER", "PROP", "MOUNT"];

/** Axis-aligned world bounds of an item (ignores rotation). */
export function itemBounds(item: Item, grid: Grid): { x: number; y: number; width: number; height: number } {
  const p = item.position;
  switch (item.type) {
    case "IMAGE": {
      const s = imageScale(grid, item.grid.dpi);
      return {
        x: p.x - item.grid.offset.x * s * item.scale.x,
        y: p.y - item.grid.offset.y * s * item.scale.y,
        width: item.image.width * s * item.scale.x,
        height: item.image.height * s * item.scale.y,
      };
    }
    case "SHAPE": {
      const w = item.width * item.scale.x;
      const h = item.height * item.scale.y;
      return item.shapeType === "CIRCLE" ? { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h } : { x: p.x, y: p.y, width: w, height: h };
    }
    case "CURVE": {
      const xs = item.points.map((q) => q.x + p.x);
      const ys = item.points.map((q) => q.y + p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    case "LINE": {
      const a = { x: p.x + item.startPosition.x, y: p.y + item.startPosition.y };
      const b = { x: p.x + item.endPosition.x, y: p.y + item.endPosition.y };
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    }
    case "TEXT":
      return { x: p.x, y: p.y, width: item.text.length * item.fontSize * 0.6, height: item.fontSize * 1.2 };
  }
}
