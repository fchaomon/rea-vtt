import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { customAlphabet } from "nanoid";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { Room, createRoomData, type Connection } from "./room";
import { UPLOADS_DIR, isValidRoomId, loadRoom, saveRoom, saveRoomNow } from "./store";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DIST_DIR = join(process.cwd(), "dist");
const roomIdGen = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
};

const rooms = new Map<string, Room>();

function getRoom(id: string): Room | null {
  const cached = rooms.get(id);
  if (cached) return cached;
  const data = loadRoom(id);
  if (!data) return null;
  const room = new Room(data, (r) => saveRoom(r.data));
  rooms.set(id, room);
  return room;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function serveFile(res: ServerResponse, file: string, cache = false): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    ...(cache ? { "cache-control": "public, max-age=31536000, immutable" } : {}),
  });
  createReadStream(file).pipe(res);
  return true;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const id = roomIdGen();
      const gmKey = randomUUID();
      const data = createRoomData(id, gmKey);
      saveRoomNow(data);
      rooms.set(id, new Room(data, (r) => saveRoom(r.data)));
      return json(res, 201, { roomId: id, gmKey });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === "GET" && roomMatch) {
      const room = isValidRoomId(roomMatch[1]) ? getRoom(roomMatch[1]) : null;
      return room ? json(res, 200, { roomId: room.data.id }) : json(res, 404, { error: "Room not found" });
    }

    if (req.method === "POST" && url.pathname === "/api/assets") {
      const mime = (req.headers["content-type"] ?? "").split(";")[0];
      const ext = IMAGE_EXT[mime];
      if (!ext) return json(res, 415, { error: "Only PNG, JPEG, WebP and GIF images are supported" });
      const body = await readBody(req, MAX_UPLOAD_BYTES);
      const name = `${randomUUID()}${ext}`;
      writeFileSync(join(UPLOADS_DIR, name), body);
      return json(res, 201, { url: `/assets/uploads/${name}`, mime });
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/uploads/")) {
      const name = url.pathname.slice("/assets/uploads/".length);
      if (/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(name) && serveFile(res, join(UPLOADS_DIR, name), true)) return;
      return json(res, 404, { error: "Not found" });
    }

    // Production: serve the built client with SPA fallback.
    if (req.method === "GET" && existsSync(DIST_DIR)) {
      const file = normalize(join(DIST_DIR, decodeURIComponent(url.pathname)));
      if (file.startsWith(DIST_DIR) && serveFile(res, file, url.pathname.startsWith("/assets/"))) return;
      if (serveFile(res, join(DIST_DIR, "index.html"))) return;
    }
    json(res, 404, { error: "Not found" });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2 * 1024 * 1024 });

wss.on("connection", (ws: WebSocket) => {
  let room: Room | null = null;
  let conn: Connection | null = null;
  const send = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ t: "error", message: "Malformed message" });
    }
    if (!conn) {
      if (msg.t !== "join" || typeof msg.roomId !== "string" || typeof msg.userId !== "string") {
        return send({ t: "error", message: "Join a room first" });
      }
      room = isValidRoomId(msg.roomId) ? getRoom(msg.roomId) : null;
      if (!room) {
        send({ t: "error", message: "Room not found" });
        return ws.close(4404, "Room not found");
      }
      conn = room.join({ id: randomUUID(), userId: msg.userId.slice(0, 64), send }, String(msg.name ?? ""), msg.gmKey);
      return;
    }
    room!.handle(conn, msg);
  });

  ws.on("close", () => {
    if (room && conn) room.leave(conn.id);
  });
});

server.listen(PORT, () => {
  console.log(`rea-vtt server listening on http://localhost:${PORT}`);
});
