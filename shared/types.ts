// Scene data model, mirroring Owlbear Rodeo's item model (see .claude/skills/owlbear-vtt).

export interface Vector2 {
  x: number;
  y: number;
}

/** Bottom → top draw order. */
export const LAYERS = [
  "MAP",
  "GRID",
  "DRAWING",
  "PROP",
  "MOUNT",
  "CHARACTER",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
  "RULER",
  "FOG",
  "POINTER",
] as const;
export type Layer = (typeof LAYERS)[number];

export type Role = "GM" | "PLAYER";

export interface ItemBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  createdUserId: string;
  zIndex: number;
  lastModified: string;
  lastModifiedUserId: string;
  position: Vector2;
  rotation: number;
  scale: Vector2;
  layer: Layer;
  metadata: Record<string, unknown>;
  attachedTo?: string | null;
}

export interface ShapeStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  strokeDash: number[];
}

export interface ImageItem extends ItemBase {
  type: "IMAGE";
  image: { width: number; height: number; mime: string; url: string };
  /** `dpi` = image pixels per grid cell; `offset` = image pixel that sits at `position`. */
  grid: { dpi: number; offset: Vector2 };
}

export type ShapeType = "RECTANGLE" | "CIRCLE";

export interface ShapeItem extends ItemBase {
  type: "SHAPE";
  shapeType: ShapeType;
  width: number;
  height: number;
  style: ShapeStyle;
  /** Optional label rendered on the shape (used for quick colored tokens). */
  label?: string;
}

export interface CurveItem extends ItemBase {
  type: "CURVE";
  /** Points relative to `position`. */
  points: Vector2[];
  closed: boolean;
  tension: number;
  style: ShapeStyle;
}

export interface LineItem extends ItemBase {
  type: "LINE";
  startPosition: Vector2;
  endPosition: Vector2;
  style: ShapeStyle;
}

export interface TextItem extends ItemBase {
  type: "TEXT";
  text: string;
  fontSize: number;
  color: string;
}

export type Item = ImageItem | ShapeItem | CurveItem | LineItem | TextItem;
export type ItemType = Item["type"];

/** A partial update for one item. `id` is required; `type` cannot change. */
export type ItemUpdate = { id: string } & Partial<Omit<ItemBase, "id">> & Record<string, unknown>;

export type GridType = "SQUARE" | "HEX_VERTICAL" | "HEX_HORIZONTAL";
export type GridMeasurement = "CHEBYSHEV" | "ALTERNATING" | "EUCLIDEAN" | "MANHATTAN";

export interface Grid {
  dpi: number;
  type: GridType;
  measurement: GridMeasurement;
  /** e.g. "5ft" */
  scale: string;
  style: { lineColor: string; lineOpacity: number; lineWidth: number; visible: boolean };
}

export interface Fog {
  filled: boolean;
  style: { color: string };
}

export interface Scene {
  name: string;
  items: Record<string, Item>;
  grid: Grid;
  fog: Fog;
}

export interface Player {
  id: string;
  connectionId: string;
  role: Role;
  name: string;
  color: string;
  selection: string[];
}

export const DEFAULT_GRID: Grid = {
  dpi: 150,
  type: "SQUARE",
  measurement: "CHEBYSHEV",
  scale: "5ft",
  style: { lineColor: "#000000", lineOpacity: 0.4, lineWidth: 2, visible: true },
};

export const DEFAULT_FOG: Fog = { filled: false, style: { color: "#222222" } };

export function createEmptyScene(name = "Untitled scene"): Scene {
  return { name, items: {}, grid: structuredClone(DEFAULT_GRID), fog: structuredClone(DEFAULT_FOG) };
}

export function layerIndex(layer: Layer): number {
  return LAYERS.indexOf(layer);
}

/** Sort comparator: layer order first, then zIndex. */
export function compareItems(a: Item, b: Item): number {
  return layerIndex(a.layer) - layerIndex(b.layer) || a.zIndex - b.zIndex;
}

/** Fog shapes with this metadata flag subtract from other fog (reveal). */
export const FOG_CUT_KEY = "fog.cut";

export function isFogCut(item: Item): boolean {
  return item.layer === "FOG" && item.metadata[FOG_CUT_KEY] === true;
}
