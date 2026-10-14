import { updateScene, isGM, undo, redo } from "../actions";
import { useStore, set, type DrawMode, type FogMode, type ToolId } from "../store";

const TOOLS: { id: ToolId; label: string; icon: string; key: string; gmOnly?: boolean }[] = [
  { id: "move", label: "Move", icon: "✥", key: "W" },
  { id: "draw", label: "Draw", icon: "✎", key: "D" },
  { id: "fog", label: "Fog", icon: "☁", key: "F", gmOnly: true },
  { id: "measure", label: "Measure", icon: "📏", key: "M" },
  { id: "pointer", label: "Pointer", icon: "●", key: "P" },
  { id: "text", label: "Text", icon: "T", key: "T" },
];

export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

const DRAW_MODES: { id: DrawMode; label: string }[] = [
  { id: "rectangle", label: "▭ Rect" },
  { id: "circle", label: "◯ Circle" },
  { id: "line", label: "╱ Line" },
  { id: "brush", label: "〰 Brush" },
];

const FOG_MODES: { id: FogMode; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "polygon", label: "⬠ Polygon" },
  { id: "rectangle", label: "▭ Rect" },
  { id: "brush", label: "〰 Brush" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const drawMode = useStore((s) => s.drawMode);
  const fogMode = useStore((s) => s.fogMode);
  const fogCut = useStore((s) => s.fogCut);
  const fog = useStore((s) => s.scene!.fog);
  const style = useStore((s) => s.drawStyle);
  const permissions = useStore((s) => s.permissions);
  const gm = isGM();
  const fogAllowed = gm || permissions.includes("FOG_CREATE");

  return (
    <div className="toolbar">
      <div className="tool-row">
        {TOOLS.filter((t) => !t.gmOnly || fogAllowed).map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : ""}
            title={`${t.label} (${t.key})`}
            onClick={() => set({ tool: t.id })}
          >
            <span className="icon">{t.icon}</span>
            <span className="label">{t.label}</span>
          </button>
        ))}
        <span className="sep" />
        <button title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
        <button title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
      </div>

      {tool === "draw" && (
        <div className="tool-row sub">
          {DRAW_MODES.map((m) => (
            <button key={m.id} className={drawMode === m.id ? "active" : ""} onClick={() => set({ drawMode: m.id })}>
              {m.label}
            </button>
          ))}
          <span className="sep" />
          <label title="Stroke color">
            <input type="color" value={style.strokeColor} onChange={(e) => set({ drawStyle: { ...style, strokeColor: e.target.value } })} />
          </label>
          <label title="Fill color">
            Fill
            <input type="color" value={style.fillColor} onChange={(e) => set({ drawStyle: { ...style, fillColor: e.target.value } })} />
          </label>
          <label title="Fill opacity">
            <input type="range" min={0} max={1} step={0.1} value={style.fillOpacity} onChange={(e) => set({ drawStyle: { ...style, fillOpacity: +e.target.value } })} />
          </label>
          <label title="Stroke width">
            Width
            <input type="range" min={1} max={40} value={style.strokeWidth} onChange={(e) => set({ drawStyle: { ...style, strokeWidth: +e.target.value } })} />
          </label>
        </div>
      )}

      {tool === "text" && (
        <div className="tool-row sub">
          <span className="hint">Click the map to place text.</span>
          <input type="color" value={style.strokeColor} onChange={(e) => set({ drawStyle: { ...style, strokeColor: e.target.value } })} />
        </div>
      )}

      {tool === "fog" && (
        <div className="tool-row sub">
          {FOG_MODES.map((m) => (
            <button key={m.id} className={fogMode === m.id ? "active" : ""} onClick={() => set({ fogMode: m.id })}>
              {m.label}
            </button>
          ))}
          <span className="sep" />
          <button className={fogCut ? "active" : ""} title="New fog shapes reveal instead of hide" onClick={() => set({ fogCut: !fogCut })}>
            ✂ Cut
          </button>
          {gm && (
            <button className={fog.filled ? "active" : ""} title="Cover everything in fog; cut shapes reveal" onClick={() => updateScene({ fog: { filled: !fog.filled } })}>
              ▦ Fill fog
            </button>
          )}
          {fogMode === "polygon" && <span className="hint">Click points, click the first point or press Enter to close.</span>}
        </div>
      )}

      {tool === "measure" && (
        <div className="tool-row sub">
          <span className="hint">Drag to measure. Everyone sees your ruler.</span>
        </div>
      )}
      {tool === "pointer" && (
        <div className="tool-row sub">
          <span className="hint">Hold the mouse button to show a laser pointer to everyone.</span>
        </div>
      )}
    </div>
  );
}
