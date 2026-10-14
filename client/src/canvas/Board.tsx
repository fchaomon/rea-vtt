import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Arrow, Circle, Ellipse, Group, Label, Layer, Line, Rect, Stage, Tag, Text, Transformer } from "react-konva";
import { formatDistance, gridDistance, imageScale, snapPosition } from "../../../shared/grid";
import { CHANNEL } from "../../../shared/protocol";
import { FOG_CUT_KEY, compareItems, isFogCut, type Item, type ItemUpdate, type Vector2 } from "../../../shared/types";
import { addItems, allowed, select, updateItems } from "../actions";
import { createCurve, createLine, createShape, createText, itemBounds, sizeInCells, SNAP_LAYERS, styleFrom } from "../items";
import { broadcast, throttledBroadcast } from "../net/connection";
import { get, set, useStore, type RulerState } from "../store";
import { GridShape, type Bounds } from "./GridShape";
import { ItemNode } from "./ItemNode";
import { RemotePointers } from "./RemotePointers";

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const sendPointer = throttledBroadcast(CHANNEL.pointer);
const sendRuler = throttledBroadcast(CHANNEL.ruler);
const sendInteraction = throttledBroadcast(CHANNEL.interaction);

/** In-progress gesture state. Kept in a ref so pointermove doesn't re-render the whole board. */
type Gesture =
  | { kind: "pan"; startPointer: Vector2; startView: Vector2 }
  | { kind: "shape"; start: Vector2; end: Vector2 }
  | { kind: "brush"; points: Vector2[] }
  | { kind: "measure"; ruler: RulerState }
  | { kind: "pointer" };

export function Board() {
  const scene = useStore((s) => s.scene)!;
  const self = useStore((s) => s.self)!;
  const tool = useStore((s) => s.tool);
  const drawMode = useStore((s) => s.drawMode);
  const fogMode = useStore((s) => s.fogMode);
  const fogCut = useStore((s) => s.fogCut);
  const drawStyle = useStore((s) => s.drawStyle);
  const viewport = useStore((s) => s.viewport);
  const stageSize = useStore((s) => s.stageSize);
  const selection = useStore((s) => s.selection);
  const transient = useStore((s) => s.transient);
  const remoteRulers = useStore((s) => s.remoteRulers);
  useStore((s) => s.permissions); // re-render when permissions change

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const fogLayerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const gesture = useRef<Gesture | null>(null);
  const dragStart = useRef<Record<string, Vector2>>({});
  const spaceDown = useRef(false);
  // A small render tick for previews (brush, shapes, ruler) without touching the global store.
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [polygon, setPolygon] = useState<Vector2[]>([]);
  const [cursor, setCursor] = useState<Vector2 | null>(null);

  const gm = self.role === "GM";
  const grid = scene.grid;
  const sorted = useMemo(() => Object.values(scene.items).sort(compareItems), [scene.items]);
  const mapItems = sorted.filter((i) => i.layer === "MAP");
  const worldItems = sorted.filter((i) => i.layer !== "MAP" && i.layer !== "FOG");
  const fogItems = sorted.filter((i) => i.layer === "FOG");

  // Resize the stage with its container.
  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => set({ stageSize: { width: el.clientWidth, height: el.clientHeight } }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // GM sees fog translucent; players see it opaque. CSS opacity keeps destination-out cuts exact.
  useEffect(() => {
    const canvas = fogLayerRef.current?.getNativeCanvasElement();
    if (canvas) canvas.style.opacity = gm ? "0.55" : "1";
  }, [gm]);

  // Attach the transformer to the selected nodes.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const transformable = tool === "move" || (tool === "fog" && fogMode === "select");
    const nodes = transformable
      ? selection
          .map((id) => scene.items[id])
          .filter((i): i is Item => !!i && !i.locked && allowed("UPDATE", i) && i.type !== "LINE")
          .map((i) => stage.findOne(`#${i.id}`))
          .filter((n): n is Konva.Node => !!n)
      : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, scene.items, tool, fogMode]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) spaceDown.current = true;
      if (e.key === "Escape") {
        setPolygon([]);
        gesture.current = null;
        rerender();
      }
      if (e.key === "Enter" && polygon.length >= 3) finishPolygon(polygon);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const worldPointer = (): Vector2 => stageRef.current!.getRelativePointerPosition() ?? { x: 0, y: 0 };

  const visibleBounds: Bounds = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: stageSize.width / viewport.scale,
    height: stageSize.height / viewport.scale,
  };
  const gridBounds: Bounds = useMemo(() => {
    if (mapItems.length === 0) return visibleBounds;
    const b = mapItems.map((m) => itemBounds(m, grid));
    const x = Math.min(...b.map((r) => r.x));
    const y = Math.min(...b.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...b.map((r) => r.x + r.width)) - x,
      height: Math.max(...b.map((r) => r.y + r.height)) - y,
    };
  }, [mapItems, grid, visibleBounds.x, visibleBounds.y, visibleBounds.width, visibleBounds.height]);

  // ---------- viewport ----------
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const pointer = stage.getPointerPosition()!;
    const { x, y, scale } = get().viewport;
    const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015));
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const world = { x: (pointer.x - x) / scale, y: (pointer.y - y) / scale };
    set({ viewport: { scale: next, x: pointer.x - world.x * next, y: pointer.y - world.y * next } });
  };

  // ---------- item drag (interaction) ----------
  const canDrag = (item: Item) => {
    if (item.locked || !allowed("UPDATE", item)) return false;
    if (item.layer === "FOG") return tool === "fog" && fogMode === "select";
    return tool === "move";
  };

  const onItemPointerDown = (e: Konva.KonvaEventObject<PointerEvent>, item: Item) => {
    const selectable = item.layer === "FOG" ? tool === "fog" && fogMode === "select" : tool === "move";
    if (!selectable || e.evt.button !== 0 || spaceDown.current) return;
    e.cancelBubble = true;
    if (item.locked && !gm) return;
    const sel = get().selection;
    if (e.evt.shiftKey) select(sel.includes(item.id) ? sel.filter((id) => id !== item.id) : [...sel, item.id]);
    else if (!sel.includes(item.id)) select([item.id]);
  };

  const onItemDragStart = (_: Konva.KonvaEventObject<DragEvent>, item: Item) => {
    const items = get().scene!.items;
    const ids = get().selection.includes(item.id) ? get().selection : [item.id];
    dragStart.current = Object.fromEntries(ids.filter((id) => items[id] && canDrag(items[id])).map((id) => [id, items[id].position]));
  };

  const onItemDragMove = (e: Konva.KonvaEventObject<DragEvent>, item: Item) => {
    const start = dragStart.current[item.id];
    if (!start) return;
    const node = e.target;
    const delta = { x: node.x() - start.x, y: node.y() - start.y };
    const moved = Object.entries(dragStart.current).map(([id, p]) => ({ id, position: { x: p.x + delta.x, y: p.y + delta.y } }));
    set((s) => ({ transient: { ...s.transient, ...Object.fromEntries(moved.filter((m) => m.id !== item.id).map((m) => [m.id, m.position])) } }));
    sendInteraction({ items: moved });
  };

  const onItemDragEnd = (e: Konva.KonvaEventObject<DragEvent>, item: Item) => {
    const start = dragStart.current[item.id];
    if (!start) return;
    const node = e.target;
    let final = { x: node.x(), y: node.y() };
    if (SNAP_LAYERS.includes(item.layer) && !e.evt.altKey) final = snapPosition(grid, final, sizeInCells(item, grid));
    node.position(final); // react-konva won't reset the node if the prop value didn't change
    const delta = { x: final.x - start.x, y: final.y - start.y };
    const ids = Object.keys(dragStart.current);
    const updates: ItemUpdate[] = ids.map((id) => ({ id, position: { x: dragStart.current[id].x + delta.x, y: dragStart.current[id].y + delta.y } }));
    // Attachments follow their parent.
    const items = get().scene!.items;
    for (const child of Object.values(items)) {
      if (child.attachedTo && ids.includes(child.attachedTo) && !ids.includes(child.id)) {
        updates.push({ id: child.id, position: { x: child.position.x + delta.x, y: child.position.y + delta.y } });
      }
    }
    dragStart.current = {};
    set((s) => {
      const t = { ...s.transient };
      for (const id of ids) delete t[id];
      return { transient: t };
    });
    broadcast(CHANNEL.interaction, { done: ids });
    if (delta.x !== 0 || delta.y !== 0) updateItems(updates);
  };

  const onTransformEnd = () => {
    const items = get().scene!.items;
    const updates: ItemUpdate[] = trRef.current!.nodes().map((node) => {
      const item = items[node.id()];
      const s = item.type === "IMAGE" ? imageScale(grid, item.grid.dpi) : 1;
      return {
        id: item.id,
        position: { x: node.x(), y: node.y() },
        rotation: node.rotation(),
        scale: { x: node.scaleX() / s, y: node.scaleY() / s },
      };
    });
    updateItems(updates);
  };

  // ---------- tools ----------
  const finishPolygon = (points: Vector2[]) => {
    setPolygon([]);
    if (points.length < 3) return;
    addFog(createCurve("FOG", points, true, styleFrom("#000000", "#000000", 1, 0)));
  };

  const addFog = (item: Item) => {
    if (get().fogCut) item.metadata = { ...item.metadata, [FOG_CUT_KEY]: true };
    addItems([item]);
  };

  const onStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const evt = e.evt;
    const stage = stageRef.current!;
    const p = worldPointer();
    const pan = evt.button === 1 || evt.button === 2 || spaceDown.current;
    const onBackground = e.target === stage || e.target.getLayer()?.attrs.name === "map";

    if (pan || ((tool === "move" || (tool === "fog" && fogMode === "select")) && onBackground)) {
      if (!pan && !evt.shiftKey) select([]);
      gesture.current = { kind: "pan", startPointer: stage.getPointerPosition()!, startView: { x: viewport.x, y: viewport.y } };
      return;
    }
    if (evt.button !== 0) return;

    switch (tool) {
      case "draw":
        gesture.current = drawMode === "brush" ? { kind: "brush", points: [p] } : { kind: "shape", start: p, end: p };
        break;
      case "fog":
        if (fogMode === "polygon") {
          const first = polygon[0];
          if (first && Math.hypot(first.x - p.x, first.y - p.y) < 12 / viewport.scale && polygon.length >= 3) finishPolygon(polygon);
          else setPolygon([...polygon, p]);
        } else if (fogMode === "brush") gesture.current = { kind: "brush", points: [p] };
        else if (fogMode === "rectangle") gesture.current = { kind: "shape", start: p, end: p };
        break;
      case "measure": {
        const start = snapPosition(grid, p);
        gesture.current = { kind: "measure", ruler: { start, end: start, measurement: formatDistance(grid, 0), color: self.color } };
        break;
      }
      case "pointer":
        gesture.current = { kind: "pointer" };
        setCursor(p);
        sendPointer({ position: p });
        break;
      case "text": {
        const text = window.prompt("Text");
        if (text?.trim()) addItems([createText(p, text.trim(), drawStyle.strokeColor, grid.dpi * 0.4)]);
        break;
      }
    }
    rerender();
  };

  const onStagePointerMove = () => {
    const g = gesture.current;
    const p = worldPointer();
    if (tool === "fog" && fogMode === "polygon" && polygon.length) setCursor(p);
    if (!g) return;
    switch (g.kind) {
      case "pan": {
        const ptr = stageRef.current!.getPointerPosition()!;
        set({ viewport: { ...get().viewport, x: g.startView.x + ptr.x - g.startPointer.x, y: g.startView.y + ptr.y - g.startPointer.y } });
        return;
      }
      case "shape":
        g.end = p;
        break;
      case "brush": {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(last.x - p.x, last.y - p.y) > 4 / viewport.scale) g.points.push(p);
        break;
      }
      case "measure": {
        const end = snapPosition(grid, p);
        g.ruler = { ...g.ruler, end, measurement: formatDistance(grid, gridDistance(grid, g.ruler.start, end)) };
        sendRuler(g.ruler);
        break;
      }
      case "pointer":
        setCursor(p);
        sendPointer({ position: p });
        break;
    }
    rerender();
  };

  const onStagePointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const style = styleFrom(drawStyle.strokeColor, drawStyle.fillColor, drawStyle.fillOpacity, drawStyle.strokeWidth);
    switch (g.kind) {
      case "shape": {
        const x = Math.min(g.start.x, g.end.x);
        const y = Math.min(g.start.y, g.end.y);
        const w = Math.abs(g.end.x - g.start.x);
        const h = Math.abs(g.end.y - g.start.y);
        if (w < 4 && h < 4) break;
        if (tool === "fog") {
          addFog(createShape("FOG", "RECTANGLE", { x, y }, w, h, styleFrom("#000000", "#000000", 1, 0)));
        } else if (drawMode === "rectangle") addItems([createShape("DRAWING", "RECTANGLE", { x, y }, w, h, style)]);
        else if (drawMode === "circle") addItems([createShape("DRAWING", "CIRCLE", { x: x + w / 2, y: y + h / 2 }, w, h, style)]);
        else if (drawMode === "line") addItems([createLine("DRAWING", g.start, g.end, style)]);
        break;
      }
      case "brush":
        if (g.points.length < 2) break;
        if (tool === "fog") addFog(createCurve("FOG", g.points, true, styleFrom("#000000", "#000000", 1, 0)));
        else addItems([{ ...createCurve("DRAWING", g.points, false, style), tension: 0.4 }]);
        break;
      case "measure":
        broadcast(CHANNEL.ruler, null);
        break;
      case "pointer":
        setCursor(null);
        broadcast(CHANNEL.pointer, { position: null });
        break;
    }
    rerender();
  };

  // ---------- render ----------
  const g = gesture.current;
  const fogListening = gm && tool === "fog" && fogMode === "select";
  const nodeProps = (item: Item) => ({
    item,
    grid,
    position: transient[item.id] ?? item.position,
    draggable: canDrag(item),
    listening: item.layer === "FOG" ? fogListening : true,
    ghost: !item.visible,
    onPointerDown: onItemPointerDown,
    onDragStart: onItemDragStart,
    onDragMove: onItemDragMove,
    onDragEnd: onItemDragEnd,
  });
  const preview = g?.kind === "shape" || g?.kind === "brush" ? g : null;
  const previewColor = tool === "fog" ? (fogCut ? "#4dabf7" : "#ffffff") : drawStyle.strokeColor;
  const rulers = [...Object.values(remoteRulers), ...(g?.kind === "measure" ? [g.ruler] : [])];

  return (
    <div
      ref={containerRef}
      className={`board tool-${tool}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={onWheel}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerLeave={onStagePointerUp}
      >
        <Layer name="map">
          {mapItems.map((item) => (
            <ItemNode key={item.id} {...nodeProps(item)} />
          ))}
          <GridShape grid={grid} bounds={gridBounds} viewScale={viewport.scale} />
        </Layer>
        <Layer name="world">
          {worldItems.map((item) => (
            <ItemNode key={item.id} {...nodeProps(item)} />
          ))}
        </Layer>
        <Layer name="fog" ref={fogLayerRef} listening={fogListening}>
          {scene.fog.filled && (
            <Rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill={scene.fog.style.color} listening={false} />
          )}
          {fogItems.filter((i) => !isFogCut(i)).map((item) => (
            <ItemNode key={item.id} {...nodeProps(item)} fogColor={scene.fog.style.color} />
          ))}
          {fogItems.filter(isFogCut).map((item) => (
            <ItemNode key={item.id} {...nodeProps(item)} fogColor={scene.fog.style.color} fogCut />
          ))}
        </Layer>
        <Layer name="overlay">
          {gm && tool === "fog" &&
            fogItems.map((item) => <FogOutline key={item.id} item={item} position={transient[item.id] ?? item.position} scale={viewport.scale} />)}
          {preview && <Preview gesture={preview} shape={tool === "fog" ? "rectangle" : drawMode} color={previewColor} width={tool === "fog" ? 2 / viewport.scale : drawStyle.strokeWidth} closed={tool === "fog"} />}
          {polygon.length > 0 && (
            <>
              <Line points={[...polygon, ...(cursor ? [cursor] : [])].flatMap((p) => [p.x, p.y])} stroke={previewColor} strokeWidth={2 / viewport.scale} dash={[8 / viewport.scale, 6 / viewport.scale]} />
              <Circle x={polygon[0].x} y={polygon[0].y} radius={8 / viewport.scale} stroke={previewColor} strokeWidth={2 / viewport.scale} />
            </>
          )}
          {rulers.map((r, i) => (
            <Ruler key={i} ruler={r} scale={viewport.scale} />
          ))}
          <RemotePointers local={tool === "pointer" ? cursor : null} localColor={self.color} scale={viewport.scale} />
          <Transformer
            ref={trRef}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            keepRatio
            onTransformEnd={onTransformEnd}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>
    </div>
  );
}

function Preview({ gesture, shape, color, width, closed }: { gesture: Gesture; shape: string; color: string; width: number; closed: boolean }) {
  if (gesture.kind === "brush") {
    return <Line points={gesture.points.flatMap((p) => [p.x, p.y])} stroke={color} strokeWidth={width} closed={closed} lineCap="round" lineJoin="round" tension={closed ? 0 : 0.4} />;
  }
  if (gesture.kind !== "shape") return null;
  const { start, end } = gesture;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (shape === "circle") return <Ellipse x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} stroke={color} strokeWidth={width} />;
  if (shape === "line") return <Line points={[start.x, start.y, end.x, end.y]} stroke={color} strokeWidth={width} lineCap="round" />;
  return <Rect x={x} y={y} width={w} height={h} stroke={color} strokeWidth={width} />;
}

function Ruler({ ruler, scale }: { ruler: RulerState; scale: number }) {
  const k = 1 / scale;
  return (
    <Group listening={false}>
      <Arrow
        points={[ruler.start.x, ruler.start.y, ruler.end.x, ruler.end.y]}
        stroke={ruler.color}
        fill={ruler.color}
        strokeWidth={4 * k}
        pointerLength={12 * k}
        pointerWidth={12 * k}
        dash={[12 * k, 8 * k]}
      />
      <Circle x={ruler.start.x} y={ruler.start.y} radius={6 * k} fill={ruler.color} />
      <Label x={ruler.end.x + 14 * k} y={ruler.end.y - 14 * k}>
        <Tag fill="rgba(20,20,24,0.85)" cornerRadius={6 * k} />
        <Text text={ruler.measurement} fill="#fff" fontSize={16 * k} padding={6 * k} fontStyle="bold" />
      </Label>
    </Group>
  );
}

function FogOutline({ item, position, scale }: { item: Item; position: Vector2; scale: number }) {
  const common = {
    x: position.x,
    y: position.y,
    rotation: item.rotation,
    scaleX: item.scale.x,
    scaleY: item.scale.y,
    stroke: isFogCut(item) ? "#4dabf7" : "#ffffff",
    strokeWidth: 1.5 / scale,
    dash: [6 / scale, 4 / scale],
    listening: false,
  };
  if (item.type === "CURVE") return <Line {...common} points={item.points.flatMap((p) => [p.x, p.y])} closed />;
  if (item.type === "SHAPE") return <Rect {...common} width={item.width} height={item.height} />;
  return null;
}

