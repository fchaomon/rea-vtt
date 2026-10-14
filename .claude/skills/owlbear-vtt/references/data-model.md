# Owlbear Rodeo data model (from @owlbear-rodeo/sdk v3 types, MIT)

## Item (base)

```ts
type Layer = "MAP" | "GRID" | "DRAWING" | "PROP" | "MOUNT" | "CHARACTER" | "ATTACHMENT"
  | "NOTE" | "TEXT" | "RULER" | "FOG" | "POINTER" | "POST_PROCESS" | "CONTROL" | "POPOVER";

interface Item {
  readonly id: string;            // uuid
  readonly type: string;          // "IMAGE" | "SHAPE" | "CURVE" | "LINE" | "PATH" | "TEXT" | "LABEL" | "RULER" | "POINTER" | "WALL" | "LIGHT" | ...
  name: string;
  visible: boolean;               // false => hidden from players, faded for GM
  locked: boolean;                // locked => not selectable/draggable
  createdUserId: string;
  zIndex: number;                 // order within a layer (OBR uses Date.now())
  readonly lastModified: string;  // ISO timestamp, set by server
  readonly lastModifiedUserId: string;
  position: Vector2;              // world units
  rotation: number;               // degrees
  scale: Vector2;
  metadata: Record<string, unknown>; // extensions namespace keys like "com.example/foo"
  layer: Layer;
  attachedTo?: string;            // parent item id
  disableHit?: boolean;
  disableAutoZIndex?: boolean;
  disableAttachmentBehavior?: ("VISIBLE"|"SCALE"|"ROTATION"|"POSITION"|"DELETE"|"LOCKED"|"COPY")[];
  description?: string;
}
```

## Item subtypes

| type | extra fields | typical layer |
|---|---|---|
| IMAGE | `image {width,height,mime,url}`, `grid {offset:Vector2, dpi}`, `text: TextContent`, `textItemType` | MAP, CHARACTER, PROP, MOUNT, ATTACHMENT |
| SHAPE | `width, height, shapeType: RECTANGLE|CIRCLE|TRIANGLE|HEXAGON, style: ShapeStyle` | DRAWING, FOG |
| CURVE | `points: Vector2[]` (relative to position), `style: ShapeStyle & {tension, closed?}` | DRAWING, FOG |
| LINE | `startPosition, endPosition, style: {strokeColor, strokeOpacity, strokeWidth, strokeDash}` | DRAWING |
| PATH | `commands: [cmd, ...nums][]` (MOVE/LINE/QUAD/CONIC/CUBIC/CLOSE), `fillRule` | FOG (cut paths), DRAWING |
| TEXT | `text: TextContent` (plain or Slate-style rich text) | TEXT |
| LABEL | `text`, `style {backgroundColor, backgroundOpacity, cornerRadius, pointer*}` | TEXT / ATTACHMENT |
| RULER | `startPosition, endPosition, measurement: string, style.variant FILLED|DASHED` | RULER |
| POINTER | `color, radius` | POINTER |
| WALL / LIGHT | dynamic-fog extensions: wall polyline, light radii/angles | FOG / extension layers |

`ShapeStyle = { fillColor, fillOpacity, strokeColor, strokeOpacity, strokeWidth, strokeDash: number[] }`

## Scene-level state

```ts
interface Grid {
  dpi: number;                    // world units per cell (default 150)
  type: "SQUARE" | "HEX_VERTICAL" | "HEX_HORIZONTAL" | "DIMETRIC" | "ISOMETRIC";
  measurement: "CHEBYSHEV" | "ALTERNATING" | "EUCLIDEAN" | "MANHATTAN";
  scale: string;                  // "5ft" -> parsed {multiplier:5, unit:"ft", digits:0}
  style: { lineType: "SOLID"|"DASHED"|"DOTTED", lineOpacity, lineColor: "DARK"|"LIGHT"|"HIGHLIGHT"|string, lineWidth };
}
interface Fog { filled: boolean; style: { color: string; strokeWidth?: number } }
```

## Players and permissions

```ts
interface Player {
  id: string; connectionId: string; role: "GM" | "PLAYER";
  selection?: string[]; name: string; color: string; syncView: boolean;
  metadata: Record<string, unknown>;
}
type Permission = `${"FOG"|"MAP"|"PROP"|"MOUNT"|"CHARACTER"|"ATTACHMENT"|"NOTE"|"DRAWING"|"RULER"|"POINTER"|"TEXT"}_${"CREATE"|"UPDATE"|"DELETE"}`
  | "CHARACTER_OWNER_ONLY";       // players may only move characters they created
```

The GM implicitly has every permission. Room permissions are the set granted to players.

## APIs that reveal behaviour

- `scene.items.updateItems(filter, draft => ...)`: immer-draft patches. The wire format is per-item partial diffs.
- `scene.local.*`: local-only items that are never synced (selection boxes, previews).
- `interaction.startItemInteraction(base)` returns `[update, stop]`. These are high-frequency, low-latency updates that are not persisted. Callers commit with `updateItems` after `stop()`.
- `broadcast.sendMessage(channel, data, {destination: REMOTE|LOCAL|ALL})`: ephemeral, size-limited.
- `scene.grid.snapPosition(pos, sensitivity, useCorners, useCenter)` and `scene.grid.getDistance(a, b)` returns distance in cells.
- `scene.history.undo/redo`: per-scene undo stack.
- `viewport.transformPoint` / `inverseTransformPoint`: screen ⇄ world.
- `player.syncView`: the GM can force players' viewports to follow theirs.
