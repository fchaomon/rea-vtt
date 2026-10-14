import { canApply, type Actor, type Operation } from "../../shared/permissions";
import type { Fog, Grid, Item, ItemUpdate } from "../../shared/types";
import { send } from "./net/connection";
import { applyItems, get, set, showToast } from "./store";

type Op = { kind: "add"; items: Item[] } | { kind: "update"; updates: ItemUpdate[] } | { kind: "delete"; ids: string[] };

interface HistoryEntry {
  undo: Op;
  redo: Op;
}

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
const MAX_HISTORY = 100;

export function actor(): Actor | null {
  const { self, permissions } = get();
  return self ? { role: self.role, userId: self.id, permissions } : null;
}

export function isGM(): boolean {
  return get().self?.role === "GM";
}

export function allowed(op: Operation, item: Item, update?: ItemUpdate): boolean {
  const a = actor();
  return !!a && canApply(a, op, item, update) === null;
}

function run(op: Op): void {
  switch (op.kind) {
    case "add":
      applyItems({ upsert: op.items });
      send({ t: "items.add", items: op.items });
      break;
    case "update": {
      const items = get().scene?.items ?? {};
      const merged = op.updates.filter((u) => items[u.id]).map((u) => ({ ...items[u.id], ...u }) as Item);
      applyItems({ upsert: merged });
      send({ t: "items.update", updates: op.updates });
      break;
    }
    case "delete":
      applyItems({ remove: op.ids });
      send({ t: "items.delete", ids: op.ids });
      break;
  }
}

function record(entry: HistoryEntry): void {
  undoStack.push(entry);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

export function addItems(items: Item[]): void {
  if (items.length === 0) return;
  const denied = items.find((i) => !allowed("CREATE", i));
  if (denied) return showToast(`You can't add items to ${denied.layer}`);
  run({ kind: "add", items });
  record({ undo: { kind: "delete", ids: items.map((i) => i.id) }, redo: { kind: "add", items } });
}

export function updateItems(updates: ItemUpdate[]): void {
  const items = get().scene?.items ?? {};
  const valid = updates.filter((u) => items[u.id] && allowed("UPDATE", items[u.id], u));
  if (valid.length === 0) return;
  const inverse: ItemUpdate[] = valid.map((u) => {
    const prev = items[u.id] as unknown as Record<string, unknown>;
    return { id: u.id, ...Object.fromEntries(Object.keys(u).filter((k) => k !== "id").map((k) => [k, prev[k]])) };
  });
  run({ kind: "update", updates: valid });
  record({ undo: { kind: "update", updates: inverse }, redo: { kind: "update", updates: valid } });
}

export function deleteItems(ids: string[]): void {
  const items = get().scene?.items ?? {};
  const targets = ids.filter((id) => items[id] && allowed("DELETE", items[id]));
  if (targets.length === 0) return;
  // Include attachments so undo can restore them too (the server cascades the delete).
  const all = new Set(targets);
  for (const item of Object.values(items)) if (item.attachedTo && all.has(item.attachedTo)) all.add(item.id);
  const removed = [...all].map((id) => items[id]);
  run({ kind: "delete", ids: targets });
  record({ undo: { kind: "add", items: removed }, redo: { kind: "delete", ids: targets } });
}

export function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  run(entry.undo);
  redoStack.push(entry);
}

export function redo(): void {
  const entry = redoStack.pop();
  if (!entry) return;
  run(entry.redo);
  undoStack.push(entry);
}

export function updateScene(change: { grid?: Partial<Grid>; fog?: Partial<Fog>; name?: string }): void {
  set((s) => {
    if (!s.scene) return s;
    return {
      scene: {
        ...s.scene,
        name: change.name ?? s.scene.name,
        grid: change.grid ? { ...s.scene.grid, ...change.grid, style: { ...s.scene.grid.style, ...change.grid.style } } : s.scene.grid,
        fog: change.fog ? { ...s.scene.fog, ...change.fog, style: { ...s.scene.fog.style, ...change.fog.style } } : s.scene.fog,
      },
    };
  });
  send({ t: "scene.update", ...change });
}

export function select(ids: string[]): void {
  set({ selection: ids });
  send({ t: "player.update", selection: ids });
}

/** Bring to front / send to back within the item's layer. */
export function reorder(ids: string[], where: "front" | "back"): void {
  const items = Object.values(get().scene?.items ?? {});
  const z = items.map((i) => i.zIndex);
  const base = where === "front" ? Math.max(0, ...z) + 1 : Math.min(0, ...z) - ids.length;
  updateItems(ids.map((id, i) => ({ id, zIndex: base + i })));
}

export async function uploadImage(file: File): Promise<{ url: string; width: number; height: number; mime: string }> {
  const res = await fetch("/api/assets", { method: "POST", headers: { "content-type": file.type }, body: file });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = body.url;
  });
  return { url: body.url, width, height, mime: body.mime };
}
