import { canApply, canSee, DEFAULT_PLAYER_PERMISSIONS, type Actor, type Permission } from "../shared/permissions";
import { MAX_BROADCAST_BYTES, type ClientMessage, type ServerMessage } from "../shared/protocol";
import { LAYERS, createEmptyScene, type Item, type ItemUpdate, type Player, type Role, type Scene } from "../shared/types";

export interface RoomData {
  id: string;
  gmKey: string;
  scene: Scene;
  permissions: Permission[];
}

export interface Connection {
  id: string;
  userId: string;
  player: Player;
  send(msg: ServerMessage): void;
}

const ITEM_TYPES = new Set(["IMAGE", "SHAPE", "CURVE", "LINE", "TEXT"]);
const IMMUTABLE_FIELDS = new Set(["id", "type", "createdUserId", "lastModified", "lastModifiedUserId"]);
const PLAYER_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c"];

export function createRoomData(id: string, gmKey: string): RoomData {
  return { id, gmKey, scene: createEmptyScene(), permissions: [...DEFAULT_PLAYER_PERMISSIONS] };
}

/** Server-authoritative room: validates every op, filters hidden items per role, fans out changes. */
export class Room {
  readonly conns = new Map<string, Connection>();

  constructor(
    readonly data: RoomData,
    private readonly onChange: (room: Room) => void = () => {},
  ) {}

  get scene(): Scene {
    return this.data.scene;
  }

  /** Register a connection and send it the role-filtered scene. */
  join(conn: Omit<Connection, "player">, name: string, gmKey: string | undefined): Connection {
    const role: Role = gmKey && gmKey === this.data.gmKey ? "GM" : "PLAYER";
    const player: Player = {
      id: conn.userId,
      connectionId: conn.id,
      role,
      name: name.slice(0, 40) || "Player",
      color: PLAYER_COLORS[this.conns.size % PLAYER_COLORS.length],
      selection: [],
    };
    const full: Connection = { ...conn, player };
    this.conns.set(conn.id, full);
    full.send({
      t: "welcome",
      self: player,
      scene: this.filteredScene(role),
      players: this.players(),
      permissions: this.data.permissions,
    });
    this.broadcastPlayers();
    return full;
  }

  leave(connId: string): void {
    if (this.conns.delete(connId)) this.broadcastPlayers();
  }

  handle(conn: Connection, msg: ClientMessage): void {
    switch (msg.t) {
      case "items.add":
        return this.addItems(conn, msg.items);
      case "items.update":
        return this.updateItems(conn, msg.updates);
      case "items.delete":
        return this.deleteItems(conn, msg.ids);
      case "scene.update": {
        if (conn.player.role !== "GM") return this.reject(conn, "Only the GM can change scene settings");
        const s = this.scene;
        if (msg.grid) s.grid = { ...s.grid, ...msg.grid, style: { ...s.grid.style, ...msg.grid.style } };
        if (msg.fog) s.fog = { ...s.fog, ...msg.fog, style: { ...s.fog.style, ...msg.fog.style } };
        if (typeof msg.name === "string") s.name = msg.name.slice(0, 80);
        this.sendAll({ t: "scene.updated", grid: s.grid, fog: s.fog, name: s.name });
        return this.onChange(this);
      }
      case "permissions.set": {
        if (conn.player.role !== "GM") return this.reject(conn, "Only the GM can change permissions");
        this.data.permissions = [...new Set(msg.permissions)];
        this.sendAll({ t: "permissions", permissions: this.data.permissions });
        return this.onChange(this);
      }
      case "player.update": {
        if (typeof msg.name === "string") conn.player.name = msg.name.slice(0, 40) || conn.player.name;
        if (typeof msg.color === "string" && /^#[0-9a-f]{6}$/i.test(msg.color)) conn.player.color = msg.color;
        if (Array.isArray(msg.selection)) conn.player.selection = msg.selection.filter((s) => typeof s === "string");
        return this.broadcastPlayers();
      }
      case "broadcast": {
        if (typeof msg.channel !== "string") return;
        if (JSON.stringify(msg.data ?? null).length > MAX_BROADCAST_BYTES) return this.reject(conn, "Broadcast too large");
        for (const other of this.conns.values()) {
          if (other.id !== conn.id) other.send({ t: "broadcast", channel: msg.channel, data: msg.data, connectionId: conn.id });
        }
        return;
      }
      case "join":
        return; // handled by the transport
    }
  }

  private actor(conn: Connection): Actor {
    return { role: conn.player.role, userId: conn.userId, permissions: this.data.permissions };
  }

  private addItems(conn: Connection, items: Item[]): void {
    if (!Array.isArray(items)) return;
    const now = new Date().toISOString();
    const added: Item[] = [];
    for (const raw of items) {
      const invalid = validateNewItem(raw);
      if (invalid) return this.reject(conn, invalid);
      if (this.scene.items[raw.id]) return this.reject(conn, `Item ${raw.id} already exists`);
      const reason = canApply(this.actor(conn), "CREATE", raw);
      if (reason) return this.reject(conn, reason);
      added.push({ ...raw, createdUserId: conn.userId, lastModified: now, lastModifiedUserId: conn.userId });
    }
    for (const item of added) this.scene.items[item.id] = item;
    this.fanOut({ added });
    this.onChange(this);
  }

  private updateItems(conn: Connection, updates: ItemUpdate[]): void {
    if (!Array.isArray(updates)) return;
    const actor = this.actor(conn);
    const now = new Date().toISOString();
    const next: Item[] = [];
    // Validate everything first so a batch applies atomically.
    for (const update of updates) {
      const item = this.scene.items[update?.id];
      if (!item || !canSee(actor.role, item)) return this.reject(conn, "Item not found");
      const reason = canApply(actor, "UPDATE", item, update);
      if (reason) return this.reject(conn, reason);
      if (update.layer && !LAYERS.includes(update.layer)) return this.reject(conn, "Invalid layer");
      const patch = Object.fromEntries(Object.entries(update).filter(([k]) => !IMMUTABLE_FIELDS.has(k)));
      next.push({ ...item, ...patch, lastModified: now, lastModifiedUserId: conn.userId } as Item);
    }
    const before = next.map((i) => this.scene.items[i.id]);
    for (const item of next) this.scene.items[item.id] = item;
    this.fanOut({ updated: next, before });
    this.onChange(this);
  }

  private deleteItems(conn: Connection, ids: string[]): void {
    if (!Array.isArray(ids)) return;
    const actor = this.actor(conn);
    const targets = new Set<string>();
    for (const id of ids) {
      const item = this.scene.items[id];
      if (!item || !canSee(actor.role, item)) continue;
      const reason = canApply(actor, "DELETE", item);
      if (reason) return this.reject(conn, reason);
      targets.add(id);
    }
    // Cascade to attachments (transitively).
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of Object.values(this.scene.items)) {
        if (item.attachedTo && targets.has(item.attachedTo) && !targets.has(item.id)) {
          targets.add(item.id);
          grew = true;
        }
      }
    }
    if (targets.size === 0) return;
    const removed = [...targets].map((id) => this.scene.items[id]);
    for (const id of targets) delete this.scene.items[id];
    this.fanOut({ removed });
    this.onChange(this);
  }

  /**
   * Send item changes to every connection, filtered by what its role may see.
   * A visibility flip turns into an add/delete for players, so hidden items never leak.
   */
  private fanOut(change: { added?: Item[]; updated?: Item[]; before?: Item[]; removed?: Item[] }): void {
    for (const conn of this.conns.values()) {
      const role = conn.player.role;
      const added = (change.added ?? []).filter((i) => canSee(role, i));
      const updated: Item[] = [];
      const deleted = (change.removed ?? []).filter((i) => canSee(role, i)).map((i) => i.id);
      (change.updated ?? []).forEach((item, idx) => {
        const wasVisible = canSee(role, change.before![idx]);
        const isVisible = canSee(role, item);
        if (wasVisible && isVisible) updated.push(item);
        else if (!wasVisible && isVisible) added.push(item);
        else if (wasVisible && !isVisible) deleted.push(item.id);
      });
      if (added.length) conn.send({ t: "items.added", items: added });
      if (updated.length) conn.send({ t: "items.updated", items: updated });
      if (deleted.length) conn.send({ t: "items.deleted", ids: deleted });
    }
  }

  filteredScene(role: Role): Scene {
    const items = Object.fromEntries(Object.entries(this.scene.items).filter(([, i]) => canSee(role, i)));
    return { ...this.scene, items };
  }

  players(): Player[] {
    return [...this.conns.values()].map((c) => c.player);
  }

  private broadcastPlayers(): void {
    this.sendAll({ t: "players", players: this.players() });
  }

  private sendAll(msg: ServerMessage): void {
    for (const conn of this.conns.values()) conn.send(msg);
  }

  private reject(conn: Connection, message: string): void {
    conn.send({ t: "error", message });
  }
}

function validateNewItem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "Invalid item";
  const i = raw as Partial<Item>;
  if (typeof i.id !== "string" || i.id.length === 0 || i.id.length > 64) return "Invalid item id";
  if (!ITEM_TYPES.has(i.type as string)) return `Unknown item type ${String(i.type)}`;
  if (!LAYERS.includes(i.layer as Item["layer"])) return "Invalid layer";
  if (!i.position || typeof i.position.x !== "number" || typeof i.position.y !== "number") return "Invalid position";
  return null;
}
