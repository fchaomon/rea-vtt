import { CHANNEL, type ClientMessage, type ServerMessage } from "../../../shared/protocol";
import type { Vector2 } from "../../../shared/types";
import { applyItems, get, set, showToast, type RulerState } from "../store";

let ws: WebSocket | null = null;
let joinMsg: Extract<ClientMessage, { t: "join" }> | null = null;
let retry = 0;
let closedByUs = false;

export function getUserId(): string {
  try {
    let id = localStorage.getItem("rea.userId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("rea.userId", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function connect(roomId: string, name: string, gmKey?: string): void {
  joinMsg = { t: "join", roomId, name, gmKey, userId: getUserId() };
  closedByUs = false;
  set({ roomId, status: "connecting" });
  open();
}

export function disconnect(): void {
  closedByUs = true;
  ws?.close();
  ws = null;
}

/** Drop and re-establish the socket; the welcome message replaces local state with the server's. */
export function resync(): void {
  ws?.close();
}

function open(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;
  socket.onopen = () => {
    retry = 0;
    socket.send(JSON.stringify(joinMsg));
  };
  socket.onmessage = (e) => handle(JSON.parse(e.data) as ServerMessage);
  socket.onclose = (e) => {
    if (ws !== socket) return;
    set({ status: "closed" });
    if (closedByUs || e.code === 4404) return;
    setTimeout(open, Math.min(500 * 2 ** retry++, 8000));
  };
}

export function send(msg: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const listeners = new Map<string, Set<(data: unknown, connectionId: string) => void>>();

export function onBroadcast(channel: string, cb: (data: unknown, connectionId: string) => void): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(cb);
  return () => listeners.get(channel)!.delete(cb);
}

export function broadcast(channel: string, data: unknown): void {
  send({ t: "broadcast", channel, data });
}

/** Returns a function that sends at most once per `ms`, always delivering the latest payload. */
export function throttledBroadcast(channel: string, ms = 33): (data: unknown) => void {
  let last = 0;
  let pending: unknown;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (data) => {
    pending = data;
    const wait = last + ms - Date.now();
    if (wait <= 0) {
      last = Date.now();
      broadcast(channel, data);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        broadcast(channel, pending);
      }, wait);
    }
  };
}

function handle(msg: ServerMessage): void {
  switch (msg.t) {
    case "welcome":
      set({
        status: "open",
        self: msg.self,
        scene: msg.scene,
        players: msg.players,
        permissions: msg.permissions,
        transient: {},
        selection: get().selection.filter((id) => msg.scene.items[id]),
      });
      return;
    case "items.added":
    case "items.updated":
      applyItems({ upsert: msg.items });
      clearTransient(msg.items.map((i) => i.id));
      return;
    case "items.deleted":
      applyItems({ remove: msg.ids });
      return;
    case "scene.updated":
      set((s) => (s.scene ? { scene: { ...s.scene, grid: msg.grid, fog: msg.fog, name: msg.name } } : s));
      return;
    case "players": {
      const selfConn = get().self?.connectionId;
      const live = new Set(msg.players.map((p) => p.connectionId));
      set((s) => ({
        players: msg.players,
        self: msg.players.find((p) => p.connectionId === selfConn) ?? s.self,
        remotePointers: pick(s.remotePointers, live),
        remoteRulers: pick(s.remoteRulers, live),
      }));
      return;
    }
    case "permissions":
      set({ permissions: msg.permissions });
      return;
    case "broadcast":
      handleBroadcast(msg.channel, msg.data, msg.connectionId);
      listeners.get(msg.channel)?.forEach((cb) => cb(msg.data, msg.connectionId));
      return;
    case "error":
      showToast(msg.message);
      // Our optimistic state may now differ from the server's; fetch the truth.
      resync();
      return;
  }
}

function handleBroadcast(channel: string, data: unknown, connectionId: string): void {
  const player = get().players.find((p) => p.connectionId === connectionId);
  if (channel === CHANNEL.pointer) {
    const d = data as { position: Vector2 | null };
    set((s) => {
      const remotePointers = { ...s.remotePointers };
      if (d.position) {
        remotePointers[connectionId] = {
          position: d.position,
          color: player?.color ?? "#fff",
          name: player?.name ?? "",
          at: Date.now(),
        };
      } else delete remotePointers[connectionId];
      return { remotePointers };
    });
  } else if (channel === CHANNEL.ruler) {
    set((s) => {
      const remoteRulers = { ...s.remoteRulers };
      if (data) remoteRulers[connectionId] = data as RulerState;
      else delete remoteRulers[connectionId];
      return { remoteRulers };
    });
  } else if (channel === CHANNEL.interaction) {
    const d = data as { items?: { id: string; position: Vector2 }[]; done?: string[] };
    if (d.items) set((s) => ({ transient: { ...s.transient, ...Object.fromEntries(d.items!.map((i) => [i.id, i.position])) } }));
    if (d.done) clearTransient(d.done);
  }
}

function clearTransient(ids: string[]): void {
  const t = get().transient;
  if (!ids.some((id) => id in t)) return;
  const next = { ...t };
  for (const id of ids) delete next[id];
  set({ transient: next });
}

function pick<T>(obj: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.has(k)));
}
