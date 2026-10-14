import type { Item, ItemUpdate, Layer, Role } from "./types";

export type Operation = "CREATE" | "UPDATE" | "DELETE";

/** Layers whose permissions the GM can grant to players. */
export const PERMISSION_LAYERS = [
  "MAP",
  "FOG",
  "DRAWING",
  "PROP",
  "MOUNT",
  "CHARACTER",
  "ATTACHMENT",
  "NOTE",
  "TEXT",
  "RULER",
  "POINTER",
] as const satisfies readonly Layer[];

export type Permission = `${(typeof PERMISSION_LAYERS)[number]}_${Operation}` | "CHARACTER_OWNER_ONLY";

const ops: Operation[] = ["CREATE", "UPDATE", "DELETE"];

/** OBR's default: players can do everything except touch the map and fog. */
export const DEFAULT_PLAYER_PERMISSIONS: Permission[] = PERMISSION_LAYERS.filter(
  (l) => l !== "MAP" && l !== "FOG",
).flatMap((l) => ops.map((o) => `${l}_${o}` as Permission));

export interface Actor {
  role: Role;
  userId: string;
  permissions: readonly Permission[];
}

/** Fields only the GM may change. */
const GM_ONLY_FIELDS = ["visible", "locked"] as const;

function hasLayerPermission(actor: Actor, layer: Layer, op: Operation): boolean {
  return (actor.permissions as readonly string[]).includes(`${layer}_${op}`);
}

/**
 * Returns null if `actor` may perform `op` on `item`, otherwise a human-readable reason.
 * For UPDATE, `item` is the current item and `update` is the requested patch.
 */
export function canApply(actor: Actor, op: Operation, item: Item, update?: ItemUpdate): string | null {
  if (actor.role === "GM") return null;

  if (!hasLayerPermission(actor, item.layer, op)) return `Players cannot ${op.toLowerCase()} ${item.layer} items`;

  if (op === "CREATE") {
    if (!item.visible) return "Players cannot create hidden items";
    if (item.locked) return "Players cannot create locked items";
    return null;
  }

  if (!item.visible) return "Item not found";
  if (item.locked) return "Item is locked";
  if (
    item.layer === "CHARACTER" &&
    actor.permissions.includes("CHARACTER_OWNER_ONLY") &&
    item.createdUserId !== actor.userId
  ) {
    return "You can only modify your own characters";
  }

  if (op === "UPDATE" && update) {
    for (const field of GM_ONLY_FIELDS) {
      if (field in update && update[field] !== item[field]) return `Only the GM can change ${field}`;
    }
    if (update.layer && update.layer !== item.layer && !hasLayerPermission(actor, update.layer, "CREATE")) {
      return `Players cannot move items to ${update.layer}`;
    }
  }
  return null;
}

/** Can this role see the item at all? Hidden items never reach players. */
export function canSee(role: Role, item: Item): boolean {
  return role === "GM" || item.visible;
}
