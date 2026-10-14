import { useRef, useState } from "react";
import { snapPosition } from "../../../shared/grid";
import { PERMISSION_LAYERS, type Permission } from "../../../shared/permissions";
import { FOG_CUT_KEY, type GridMeasurement, type GridType, type Item, type Layer, type Vector2 } from "../../../shared/types";
import { addItems, allowed, deleteItems, isGM, reorder, select, updateItems, updateScene, uploadImage } from "../actions";
import { createImage, createShape, styleFrom } from "../items";
import { send } from "../net/connection";
import { get, showToast, useStore } from "../store";

function viewCenter(): Vector2 {
  const { viewport, stageSize } = get();
  return { x: (stageSize.width / 2 - viewport.x) / viewport.scale, y: (stageSize.height / 2 - viewport.y) / viewport.scale };
}

export function Sidebar() {
  const gm = useStore((s) => s.self?.role === "GM");
  return (
    <aside className="sidebar">
      <RoomHeader />
      <Party />
      <AddPanel />
      <Inspector />
      {gm && <ScenePanel />}
      {gm && <PermissionsPanel />}
    </aside>
  );
}

function RoomHeader() {
  const roomId = useStore((s) => s.roomId);
  const status = useStore((s) => s.status);
  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}/#/r/${roomId}`);
    showToast("Player link copied");
  };
  return (
    <section>
      <div className="row between">
        <a href="#/" className="brand">rea-vtt</a>
        <span className={`status ${status}`}>{status === "open" ? "Connected" : status}</span>
      </div>
      <button className="wide" onClick={copy}>🔗 Copy player invite link</button>
    </section>
  );
}

function Party() {
  const players = useStore((s) => s.players);
  const self = useStore((s) => s.self)!;
  const [name, setName] = useState(self.name);
  return (
    <section>
      <h3>Party</h3>
      <ul className="party">
        {players.map((p) => (
          <li key={p.connectionId}>
            <span className="dot" style={{ background: p.color }} />
            {p.connectionId === self.connectionId ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  send({ t: "player.update", name });
                  try {
                    localStorage.setItem("rea.name", name);
                  } catch {}
                }}
              />
            ) : (
              <span>{p.name}</span>
            )}
            {p.role === "GM" && <span className="badge">GM</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddPanel() {
  const permissions = useStore((s) => s.permissions);
  const grid = useStore((s) => s.scene!.grid);
  const gm = isGM();
  const can = (layer: Layer) => gm || permissions.includes(`${layer}_CREATE` as Permission);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Layer>("CHARACTER");
  const [tokenName, setTokenName] = useState("");
  const [tokenColor, setTokenColor] = useState("#4363d8");
  const [busy, setBusy] = useState(false);

  const pick = (layer: Layer) => {
    pending.current = layer;
    fileRef.current!.value = "";
    fileRef.current!.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await uploadImage(file);
      const layer = pending.current;
      const name = file.name.replace(/\.[^.]+$/, "");
      if (layer === "MAP") {
        const guess = Math.max(1, Math.round(img.width / 100));
        const cells = Number(window.prompt("How many grid cells wide is this map?", String(guess))) || guess;
        const c = viewCenter();
        const dpi = img.width / cells;
        const s = grid.dpi / dpi;
        // Place the map's top-left on a grid corner near the view centre.
        const topLeft = snapPosition(grid, { x: c.x - (img.width * s) / 2, y: c.y - (img.height * s) / 2 }, 2);
        addItems([{ ...createImage("MAP", name, topLeft, img, dpi, false), locked: true }]);
      } else {
        // Tokens: the whole image is one cell, centred on its position.
        const item = createImage(layer, name, snapPosition(grid, viewCenter(), 1), img, img.width, true);
        addItems([item]);
        select([item.id]);
      }
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const quickToken = () => {
    const label = tokenName.trim() || "?";
    const item = createShape(
      "CHARACTER",
      "CIRCLE",
      snapPosition(grid, viewCenter(), 1),
      grid.dpi * 0.9,
      grid.dpi * 0.9,
      styleFrom("#ffffff", tokenColor, 1, grid.dpi * 0.04),
      label.slice(0, 3),
    );
    item.name = label;
    addItems([item]);
    select([item.id]);
    setTokenName("");
  };

  return (
    <section>
      <h3>Add {busy && <span className="hint">uploading…</span>}</h3>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="grid2">
        {can("MAP") && <button onClick={() => pick("MAP")}>🗺 Map</button>}
        {can("CHARACTER") && <button onClick={() => pick("CHARACTER")}>🧙 Token</button>}
        {can("PROP") && <button onClick={() => pick("PROP")}>📦 Prop</button>}
        {can("MOUNT") && <button onClick={() => pick("MOUNT")}>🐎 Mount</button>}
      </div>
      {can("CHARACTER") && (
        <div className="row">
          <input placeholder="Quick token name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && quickToken()} />
          <input type="color" value={tokenColor} onChange={(e) => setTokenColor(e.target.value)} />
          <button onClick={quickToken}>+</button>
        </div>
      )}
    </section>
  );
}

const LAYER_CHOICES: Layer[] = ["MAP", "DRAWING", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "TEXT"];

function Inspector() {
  const selection = useStore((s) => s.selection);
  const items = useStore((s) => s.scene!.items);
  const grid = useStore((s) => s.scene!.grid);
  const selected = selection.map((id) => items[id]).filter((i): i is Item => !!i);
  const gm = isGM();
  if (selected.length === 0) return null;
  const first = selected[0];
  const ids = selected.map((i) => i.id);
  const canEdit = selected.every((i) => allowed("UPDATE", i));
  const canDelete = selected.every((i) => allowed("DELETE", i));
  const all = (fn: (i: Item) => boolean) => selected.every(fn);

  return (
    <section>
      <h3>{selected.length === 1 ? first.name || first.type : `${selected.length} items`}</h3>
      {selected.length === 1 && canEdit && (
        <label className="field">
          Name
          <input defaultValue={first.name} key={first.id} onBlur={(e) => e.target.value !== first.name && updateItems([{ id: first.id, name: e.target.value }])} />
        </label>
      )}
      {selected.length === 1 && first.type === "SHAPE" && first.label !== undefined && canEdit && (
        <label className="field">
          Label
          <input defaultValue={first.label} key={`${first.id}-label`} maxLength={3} onBlur={(e) => updateItems([{ id: first.id, label: e.target.value }])} />
        </label>
      )}
      {selected.length === 1 && first.type === "IMAGE" && first.layer === "MAP" && gm && (
        <label className="field">
          Grid cells across
          <input
            type="number"
            min={1}
            key={`${first.id}-cells`}
            defaultValue={Math.round(first.image.width / first.grid.dpi)}
            onBlur={(e) => {
              const cells = Number(e.target.value);
              if (cells > 0) updateItems([{ id: first.id, grid: { ...first.grid, dpi: first.image.width / cells } }]);
            }}
          />
        </label>
      )}
      {selected.length === 1 && first.layer !== "MAP" && first.layer !== "FOG" && canEdit && (first.type === "IMAGE" || first.type === "SHAPE") && (
        <label className="field">
          Size (cells)
          <select
            value={String(Math.round(first.scale.x * 2) / 2)}
            onChange={(e) => updateItems([{ id: first.id, scale: { x: +e.target.value, y: +e.target.value } }])}
          >
            {[0.5, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}×{n}
              </option>
            ))}
          </select>
        </label>
      )}
      {gm && selected.length === 1 && first.layer !== "FOG" && (
        <label className="field">
          Layer
          <select value={first.layer} onChange={(e) => updateItems([{ id: first.id, layer: e.target.value as Layer }])}>
            {LAYER_CHOICES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      <div className="grid2">
        {gm && (
          <button onClick={() => updateItems(selected.map((i) => ({ id: i.id, visible: !all((x) => x.visible) })))}>
            {all((i) => i.visible) ? "🙈 Hide" : "👁 Show"}
          </button>
        )}
        {gm && (
          <button onClick={() => updateItems(selected.map((i) => ({ id: i.id, locked: !all((x) => x.locked) })))}>
            {all((i) => i.locked) ? "🔓 Unlock" : "🔒 Lock"}
          </button>
        )}
        {canEdit && <button onClick={() => reorder(ids, "front")}>⬆ Front</button>}
        {canEdit && <button onClick={() => reorder(ids, "back")}>⬇ Back</button>}
        {all((i) => i.layer === "FOG") && canEdit && (
          <button onClick={() => updateItems(selected.map((i) => ({ id: i.id, metadata: { ...i.metadata, [FOG_CUT_KEY]: !i.metadata[FOG_CUT_KEY] } })))}>
            ✂ {first.metadata[FOG_CUT_KEY] ? "Uncut" : "Cut"}
          </button>
        )}
        {selected.length === 2 && gm && (
          <button title="Attach the second selected item to the first" onClick={() => updateItems([{ id: selected[1].id, attachedTo: selected[0].id }])}>
            📎 Attach
          </button>
        )}
        {selected.length === 1 && first.attachedTo && canEdit && (
          <button onClick={() => updateItems([{ id: first.id, attachedTo: null }])}>Detach</button>
        )}
        {canDelete && (
          <button className="danger" onClick={() => deleteItems(ids)}>
            🗑 Delete
          </button>
        )}
      </div>
      {selected.length === 1 && first.layer === "CHARACTER" && (
        <p className="hint">Snaps to the {grid.type === "SQUARE" ? "square" : "hex"} grid on drop. Hold Alt to place freely.</p>
      )}
    </section>
  );
}

function ScenePanel() {
  const scene = useStore((s) => s.scene!);
  const { grid, fog } = scene;
  const fogIds = Object.values(scene.items).filter((i) => i.layer === "FOG").map((i) => i.id);
  return (
    <section>
      <h3>Scene</h3>
      <label className="field">
        Grid
        <select value={grid.type} onChange={(e) => updateScene({ grid: { type: e.target.value as GridType } })}>
          <option value="SQUARE">Square</option>
          <option value="HEX_VERTICAL">Hex (pointy-top)</option>
          <option value="HEX_HORIZONTAL">Hex (flat-top)</option>
        </select>
      </label>
      {grid.type === "SQUARE" && (
        <label className="field">
          Diagonals
          <select value={grid.measurement} onChange={(e) => updateScene({ grid: { measurement: e.target.value as GridMeasurement } })}>
            <option value="CHEBYSHEV">Chebyshev (5e: 1 per diagonal)</option>
            <option value="ALTERNATING">Alternating (5-10-5)</option>
            <option value="MANHATTAN">Manhattan (no diagonals)</option>
            <option value="EUCLIDEAN">Euclidean (exact)</option>
          </select>
        </label>
      )}
      <label className="field">
        Cell scale
        <input defaultValue={grid.scale} onBlur={(e) => updateScene({ grid: { scale: e.target.value || "5ft" } })} />
      </label>
      <div className="row">
        <label className="field inline">
          <input type="checkbox" checked={grid.style.visible} onChange={(e) => updateScene({ grid: { style: { ...grid.style, visible: e.target.checked } } })} />
          Show grid
        </label>
        <input type="color" value={grid.style.lineColor} onChange={(e) => updateScene({ grid: { style: { ...grid.style, lineColor: e.target.value } } })} />
        <input type="range" min={0.05} max={1} step={0.05} value={grid.style.lineOpacity} onChange={(e) => updateScene({ grid: { style: { ...grid.style, lineOpacity: +e.target.value } } })} />
      </div>
      <div className="row">
        <span>Fog color</span>
        <input type="color" value={fog.style.color} onChange={(e) => updateScene({ fog: { style: { color: e.target.value } } })} />
        <button disabled={fogIds.length === 0} onClick={() => window.confirm("Remove all fog shapes?") && deleteItems(fogIds)}>
          Clear fog
        </button>
      </div>
    </section>
  );
}

function PermissionsPanel() {
  const permissions = useStore((s) => s.permissions);
  const toggle = (p: Permission) => {
    const next = permissions.includes(p) ? permissions.filter((x) => x !== p) : [...permissions, p];
    send({ t: "permissions.set", permissions: next });
  };
  return (
    <section>
      <details>
        <summary>
          <h3>Player permissions</h3>
        </summary>
        <table className="perms">
          <thead>
            <tr>
              <th />
              <th>Add</th>
              <th>Edit</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_LAYERS.map((layer) => (
              <tr key={layer}>
                <td>{layer.toLowerCase()}</td>
                {(["CREATE", "UPDATE", "DELETE"] as const).map((op) => {
                  const p = `${layer}_${op}` as Permission;
                  return (
                    <td key={op}>
                      <input type="checkbox" checked={permissions.includes(p)} onChange={() => toggle(p)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <label className="field inline">
          <input type="checkbox" checked={permissions.includes("CHARACTER_OWNER_ONLY")} onChange={() => toggle("CHARACTER_OWNER_ONLY")} />
          Players can only move their own characters
        </label>
      </details>
    </section>
  );
}
