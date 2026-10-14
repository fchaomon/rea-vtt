# Architecture: how OBR works and how rea-vtt mirrors it

## OBR v1 (legacy, open source, personal use only)
- React + react-konva canvas. Lots of small React contexts to limit re-renders (the author later
  recommended Zustand instead).
- Socket.io backend relays state. Images were shared peer-to-peer over WebRTC (simple-peer +
  STUN/TURN) and cached in IndexedDB (Dexie). That was fragile: browsers evict IndexedDB, and P2P
  breaks behind strict NATs.
- Pointer tool used network interpolation to smooth remote cursors.
- TensorFlow model guessed grid size from a battle map image.

## OBR v2 (closed source, public SDK)
- Server-authoritative rooms; assets uploaded to cloud storage (no P2P).
- Everything is an Item (see data-model.md). Extensions run in iframes and talk to the host
  through a postMessage `MessageBus`; the SDK is a thin RPC layer over that bus.
- Fog: draw shapes on the FOG layer. "Fill fog" = infinite sheet. Selecting a fog shape and choosing
  "Cut" makes it subtract from other fog (reveal). Single-layer mode auto-cuts when drawing.
- Dynamic fog (walls + lights) is an extension (Smoke & Spectre) built on WALL/LIGHT items.

## rea-vtt implementation

```
shared/          types, protocol, grid math, permissions (used by client + server + tests)
server/          Node http + ws. Rooms in memory, persisted as JSON to data/rooms, assets to data/assets
client/src/      Vite + React + react-konva + zustand
  store.ts       zustand store (scene, players, tool state, viewport, transient drag/pointer/ruler state)
  actions.ts     optimistic item ops + undo/redo + client-side permission checks
  items.ts       item factories, bounds, token size
  net/           WebSocket connection, broadcast channels, throttling
  canvas/        Board (stage, viewport, tools, fog layer, rulers), ItemNode, GridShape, RemotePointers
  ui/            Home, Room, Toolbar, Sidebar (party, add, inspector, scene, permissions)
```

### Wire protocol (JSON over one WebSocket per client)
Client → server:
- `join {roomId, name, gmKey?}`: the server answers `welcome {self, scene (filtered), players, permissions}`
- `items.add {items}`, `items.update {updates: Partial<Item>&{id}[]}`, `items.delete {ids}`
- `scene.update {grid?, fog?}` (GM only), `permissions.set` (GM only)
- `player.update {name?, color?, selection?}`
- `broadcast {channel, data}`: relayed to everyone else, never stored

Server → client:
- `items.added`, `items.updated`, `items.deleted`, `scene.updated`, `players`, `permissions`
- `broadcast {channel, data, connectionId}`
- `error {message}` when an op is rejected

### Server rules
- Every op runs through `canApply(role, permissions, op, item)` (`shared/permissions.ts`).
- Invisible items are filtered per role. When an item flips `visible`, players get an add or delete
  instead of an update, so hidden data never reaches player clients.
- The server stamps `lastModified` and `lastModifiedUserId`, and clamps `zIndex` defaults.
- Deleting an item cascades to items whose `attachedTo` points at it.

### Rendering order
One Konva `Layer` per group, so `destination-out` compositing for fog cuts stays isolated:
1. `world` layer: MAP images → grid → DRAWING → PROP/MOUNT/CHARACTER/ATTACHMENT → NOTE/TEXT
2. `fog` layer: fill rect (if `fog.filled`) + fog shapes (source-over), then cut shapes (destination-out).
   The GM gets CSS opacity 0.5 on this canvas. Players get 1. The layer only listens to events while the fog tool is active.
3. `overlay` layer: rulers, remote pointers, selection transformer, in-progress drawing preview.

### Drag / interaction flow
1. pointerdown on an item selects it and starts the interaction.
2. pointermove updates the local transient position and broadcasts `interaction` (throttled ~30Hz).
3. pointerup snaps to the grid (CHARACTER/PROP/MOUNT), sends `items.update`, and clears the transient.
4. Remote clients render `transient[id] ?? item` and lerp toward it for smoothness.
