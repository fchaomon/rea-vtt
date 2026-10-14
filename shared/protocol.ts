import type { Permission } from "./permissions";
import type { Fog, Grid, Item, ItemUpdate, Player, Scene } from "./types";

/** Ephemeral broadcast channels used by the built-in tools. */
export const CHANNEL = {
  /** `{ position: Vector2 | null, color }`: laser pointer. */
  pointer: "rea.pointer",
  /** `{ start, end, measurement, color } | null`: live ruler. */
  ruler: "rea.ruler",
  /** `{ items: { id, position }[] } | { done: true, ids }`: drag in progress. */
  interaction: "rea.interaction",
} as const;

export type ClientMessage =
  | { t: "join"; roomId: string; name: string; gmKey?: string; userId: string }
  | { t: "items.add"; items: Item[] }
  | { t: "items.update"; updates: ItemUpdate[] }
  | { t: "items.delete"; ids: string[] }
  | { t: "scene.update"; grid?: Partial<Grid>; fog?: Partial<Fog>; name?: string }
  | { t: "permissions.set"; permissions: Permission[] }
  | { t: "player.update"; name?: string; color?: string; selection?: string[] }
  | { t: "broadcast"; channel: string; data: unknown };

export type ServerMessage =
  | { t: "welcome"; self: Player; scene: Scene; players: Player[]; permissions: Permission[] }
  | { t: "items.added"; items: Item[] }
  | { t: "items.updated"; items: Item[] }
  | { t: "items.deleted"; ids: string[] }
  | { t: "scene.updated"; grid: Grid; fog: Fog; name: string }
  | { t: "players"; players: Player[] }
  | { t: "permissions"; permissions: Permission[] }
  | { t: "broadcast"; channel: string; data: unknown; connectionId: string }
  | { t: "error"; message: string };

/** Max size of a broadcast payload, in bytes of JSON. */
export const MAX_BROADCAST_BYTES = 16 * 1024;
