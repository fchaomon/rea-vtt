import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { RoomData } from "./room";

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
export const ROOMS_DIR = join(DATA_DIR, "rooms");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

mkdirSync(ROOMS_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });

const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function isValidRoomId(id: string): boolean {
  return ROOM_ID.test(id);
}

export function loadRoom(id: string): RoomData | null {
  if (!isValidRoomId(id)) return null;
  const file = join(ROOMS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as RoomData;
}

const timers = new Map<string, NodeJS.Timeout>();

/** Debounced atomic write so a drag-heavy session doesn't hammer the disk. */
export function saveRoom(data: RoomData, delayMs = 500): void {
  clearTimeout(timers.get(data.id));
  timers.set(
    data.id,
    setTimeout(() => {
      timers.delete(data.id);
      saveRoomNow(data);
    }, delayMs),
  );
}

export function saveRoomNow(data: RoomData): void {
  const file = join(ROOMS_DIR, `${data.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(data));
  renameSync(`${file}.tmp`, file);
}
