import { useEffect } from "react";
import { deleteItems, redo, undo } from "../actions";
import { Board } from "../canvas/Board";
import { connect, disconnect } from "../net/connection";
import { get, set, useStore } from "../store";
import { Sidebar } from "./Sidebar";
import { Toolbar, TOOL_SHORTCUTS } from "./Toolbar";

function storedName(): string {
  try {
    return localStorage.getItem("rea.name") ?? "";
  } catch {
    return "";
  }
}

function gmKeyFor(roomId: string): string | undefined {
  try {
    return localStorage.getItem(`rea.gmKey.${roomId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function Room({ roomId }: { roomId: string }) {
  const status = useStore((s) => s.status);
  const ready = useStore((s) => !!s.scene && !!s.self);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    let name = storedName();
    if (!name) {
      name = window.prompt("Your name?", "Adventurer")?.trim() || "Adventurer";
      try {
        localStorage.setItem("rea.name", name);
      } catch {}
    }
    connect(roomId, name, gmKeyFor(roomId));
    return () => {
      disconnect();
      set({ scene: null, self: null, players: [], selection: [] });
    };
  }, [roomId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (mod && e.key.toLowerCase() === "y") return redo();
      if (e.key === "Delete" || e.key === "Backspace") return deleteItems(get().selection);
      if (!mod && !e.altKey && TOOL_SHORTCUTS[e.key.toLowerCase()]) set({ tool: TOOL_SHORTCUTS[e.key.toLowerCase()] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <div className="center">
        {status === "closed" ? (
          <p>
            Room not found or connection lost. <a href="#/">Back home</a>
          </p>
        ) : (
          <p>Connecting…</p>
        )}
      </div>
    );
  }

  return (
    <div className="room">
      <main>
        <Board />
        <Toolbar />
        {status !== "open" && <div className="banner">Reconnecting…</div>}
        {toast && <div className="toast">{toast}</div>}
      </main>
      <Sidebar />
    </div>
  );
}
