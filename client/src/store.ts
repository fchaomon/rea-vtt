import { create } from "zustand";
import type { Permission } from "../../shared/permissions";
import type { Item, Player, Scene, Vector2 } from "../../shared/types";

export type ToolId = "move" | "draw" | "fog" | "measure" | "pointer" | "text";
export type DrawMode = "rectangle" | "circle" | "brush" | "line";
export type FogMode = "select" | "polygon" | "rectangle" | "brush";

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface RemotePointer {
  position: Vector2;
  color: string;
  name: string;
  at: number;
}

export interface RulerState {
  start: Vector2;
  end: Vector2;
  measurement: string;
  color: string;
}

export interface DrawStyle {
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
}

interface State {
  status: "idle" | "connecting" | "open" | "closed";
  roomId: string | null;
  self: Player | null;
  players: Player[];
  permissions: Permission[];
  scene: Scene | null;

  selection: string[];
  tool: ToolId;
  drawMode: DrawMode;
  fogMode: FogMode;
  /** New fog shapes subtract (reveal) instead of add. */
  fogCut: boolean;
  drawStyle: DrawStyle;

  viewport: Viewport;
  stageSize: { width: number; height: number };

  /** Positions of items being dragged (locally or by others); not persisted. */
  transient: Record<string, Vector2>;
  remotePointers: Record<string, RemotePointer>;
  remoteRulers: Record<string, RulerState>;
  toast: string | null;
}

export const useStore = create<State>(() => ({
  status: "idle",
  roomId: null,
  self: null,
  players: [],
  permissions: [],
  scene: null,

  selection: [],
  tool: "move",
  drawMode: "rectangle",
  fogMode: "polygon",
  fogCut: false,
  drawStyle: { strokeColor: "#e03131", fillColor: "#e03131", fillOpacity: 0, strokeWidth: 8 },

  viewport: { x: 0, y: 0, scale: 1 },
  stageSize: { width: 800, height: 600 },

  transient: {},
  remotePointers: {},
  remoteRulers: {},
  toast: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

/** Apply server or optimistic item changes to the local scene. */
export function applyItems(change: { upsert?: Item[]; remove?: string[] }): void {
  set((s) => {
    if (!s.scene) return s;
    const items = { ...s.scene.items };
    for (const item of change.upsert ?? []) items[item.id] = item;
    for (const id of change.remove ?? []) delete items[id];
    const selection = change.remove ? s.selection.filter((id) => items[id]) : s.selection;
    return { scene: { ...s.scene, items }, selection };
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string): void {
  clearTimeout(toastTimer);
  set({ toast: message });
  toastTimer = setTimeout(() => set({ toast: null }), 3500);
}
