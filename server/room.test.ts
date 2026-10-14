import { describe, expect, it, beforeEach } from "vitest";
import type { ServerMessage } from "../shared/protocol";
import type { Item, ShapeItem } from "../shared/types";
import { Room, createRoomData, type Connection } from "./room";

function shape(id: string, layer: Item["layer"], extra: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id,
    type: "SHAPE",
    shapeType: "CIRCLE",
    width: 100,
    height: 100,
    style: { fillColor: "#f00", fillOpacity: 1, strokeColor: "#fff", strokeOpacity: 1, strokeWidth: 2, strokeDash: [] },
    name: id,
    visible: true,
    locked: false,
    createdUserId: "",
    zIndex: 1,
    lastModified: "",
    lastModifiedUserId: "",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    layer,
    metadata: {},
    ...extra,
  };
}

function client(room: Room, userId: string, gmKey?: string) {
  const inbox: ServerMessage[] = [];
  const conn = room.join({ id: `conn-${userId}`, userId, send: (m) => inbox.push(m) }, userId, gmKey);
  const last = <T extends ServerMessage["t"]>(t: T) =>
    [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  return { conn, inbox, last, clear: () => (inbox.length = 0) };
}

let room: Room;
let gm: ReturnType<typeof client>;
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;
const handle = (c: { conn: Connection }, msg: Parameters<Room["handle"]>[1]) => room.handle(c.conn, msg);

beforeEach(() => {
  room = new Room(createRoomData("r1", "secret"));
  gm = client(room, "gm", "secret");
  alice = client(room, "alice");
  bob = client(room, "bob", "wrong-key");
});

describe("roles", () => {
  it("grants GM only with the right key", () => {
    expect(gm.conn.player.role).toBe("GM");
    expect(alice.conn.player.role).toBe("PLAYER");
    expect(bob.conn.player.role).toBe("PLAYER");
  });
});

describe("items", () => {
  it("broadcasts adds to everyone and stamps the creator", () => {
    handle(alice, { t: "items.add", items: [shape("t1", "CHARACTER", { createdUserId: "spoofed" })] });
    expect(room.scene.items.t1.createdUserId).toBe("alice");
    expect(bob.last("items.added")?.items[0].id).toBe("t1");
    expect(gm.last("items.added")?.items[0].id).toBe("t1");
  });

  it("rejects players editing the map or fog", () => {
    handle(alice, { t: "items.add", items: [shape("m1", "MAP")] });
    handle(alice, { t: "items.add", items: [shape("f1", "FOG")] });
    expect(room.scene.items.m1).toBeUndefined();
    expect(room.scene.items.f1).toBeUndefined();
    expect(alice.last("error")).toBeDefined();
  });

  it("rejects players moving locked items or changing visibility", () => {
    handle(gm, { t: "items.add", items: [shape("t1", "CHARACTER", { locked: true })] });
    handle(alice, { t: "items.update", updates: [{ id: "t1", position: { x: 5, y: 5 } }] });
    expect(room.scene.items.t1.position).toEqual({ x: 0, y: 0 });
    handle(gm, { t: "items.update", updates: [{ id: "t1", locked: false }] });
    handle(alice, { t: "items.update", updates: [{ id: "t1", visible: false }] });
    expect(room.scene.items.t1.visible).toBe(true);
  });

  it("applies a batch atomically", () => {
    handle(gm, { t: "items.add", items: [shape("a", "CHARACTER"), shape("m", "MAP")] });
    handle(alice, {
      t: "items.update",
      updates: [
        { id: "a", position: { x: 9, y: 9 } },
        { id: "m", position: { x: 9, y: 9 } },
      ],
    });
    expect(room.scene.items.a.position).toEqual({ x: 0, y: 0 });
  });

  it("does not let updates change immutable fields", () => {
    handle(alice, { t: "items.add", items: [shape("t1", "CHARACTER")] });
    handle(alice, { t: "items.update", updates: [{ id: "t1", type: "IMAGE", createdUserId: "bob" } as never] });
    expect(room.scene.items.t1.type).toBe("SHAPE");
    expect(room.scene.items.t1.createdUserId).toBe("alice");
  });

  it("cascades deletes to attachments", () => {
    handle(alice, { t: "items.add", items: [shape("parent", "CHARACTER"), shape("child", "ATTACHMENT", { attachedTo: "parent" })] });
    handle(alice, { t: "items.delete", ids: ["parent"] });
    expect(Object.keys(room.scene.items)).toEqual([]);
    expect(bob.last("items.deleted")?.ids.sort()).toEqual(["child", "parent"]);
  });

  it("enforces CHARACTER_OWNER_ONLY", () => {
    handle(gm, { t: "permissions.set", permissions: [...room.data.permissions, "CHARACTER_OWNER_ONLY"] });
    handle(alice, { t: "items.add", items: [shape("t1", "CHARACTER")] });
    handle(bob, { t: "items.update", updates: [{ id: "t1", position: { x: 1, y: 1 } }] });
    expect(room.scene.items.t1.position).toEqual({ x: 0, y: 0 });
    handle(alice, { t: "items.update", updates: [{ id: "t1", position: { x: 1, y: 1 } }] });
    expect(room.scene.items.t1.position).toEqual({ x: 1, y: 1 });
  });
});

describe("hidden items", () => {
  it("never sends hidden items to players, and converts visibility flips to add/delete", () => {
    handle(gm, { t: "items.add", items: [shape("secret", "CHARACTER", { visible: false })] });
    expect(alice.last("items.added")).toBeUndefined();
    expect(gm.last("items.added")?.items[0].id).toBe("secret");
    expect(room.filteredScene("PLAYER").items.secret).toBeUndefined();

    handle(gm, { t: "items.update", updates: [{ id: "secret", visible: true }] });
    expect(alice.last("items.added")?.items[0].id).toBe("secret");
    expect(gm.last("items.updated")?.items[0].id).toBe("secret");

    alice.clear();
    handle(gm, { t: "items.update", updates: [{ id: "secret", visible: false }] });
    expect(alice.last("items.deleted")?.ids).toEqual(["secret"]);
    expect(alice.last("items.updated")).toBeUndefined();
  });

  it("treats hidden items as missing for players", () => {
    handle(gm, { t: "items.add", items: [shape("secret", "CHARACTER", { visible: false })] });
    handle(alice, { t: "items.delete", ids: ["secret"] });
    expect(room.scene.items.secret).toBeDefined();
  });
});

describe("scene and broadcast", () => {
  it("only the GM changes grid and fog", () => {
    handle(alice, { t: "scene.update", grid: { type: "HEX_VERTICAL" } });
    expect(room.scene.grid.type).toBe("SQUARE");
    handle(gm, { t: "scene.update", grid: { type: "HEX_VERTICAL" }, fog: { filled: true } });
    expect(room.scene.grid.type).toBe("HEX_VERTICAL");
    expect(alice.last("scene.updated")?.fog.filled).toBe(true);
  });

  it("relays broadcasts to everyone but the sender without persisting", () => {
    alice.clear();
    handle(alice, { t: "broadcast", channel: "rea.pointer", data: { position: { x: 1, y: 2 } } });
    expect(bob.last("broadcast")).toMatchObject({ channel: "rea.pointer", connectionId: "conn-alice" });
    expect(alice.last("broadcast")).toBeUndefined();
  });
});
