import { useState } from "react";

export function Home() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("Could not create room");
      const { roomId, gmKey } = await res.json();
      // Whoever holds the GM key for a room joins as GM; share the plain link with players.
      localStorage.setItem(`rea.gmKey.${roomId}`, gmKey);
      location.hash = `#/r/${roomId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const join = () => {
    const id = code.trim().split("/").pop();
    if (id) location.hash = `#/r/${id}`;
  };

  return (
    <div className="home">
      <h1>rea-vtt</h1>
      <p className="tag">A lightweight virtual tabletop. Create a room, drop in a map, share the link.</p>
      <button className="primary" disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Start a game as GM"}
      </button>
      <div className="row">
        <input placeholder="Room code or link" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && join()} />
        <button onClick={join}>Join</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
