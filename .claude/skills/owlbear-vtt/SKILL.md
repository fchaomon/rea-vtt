---
name: owlbear-vtt
description: How Owlbear Rodeo (owlbear.rodeo) works as a virtual tabletop — its scene/item data model, layers, grid math, fog, roles and permissions, realtime sync and interaction model — and how rea-vtt mirrors it. Use when designing, building, or debugging VTT features in this repo (maps, tokens, grid/snap/measure, fog of war, drawing, pointers, multiplayer sync, GM/player permissions), or when the user asks "how does Owlbear do X".
---

# Owlbear Rodeo VTT — model and how rea-vtt implements it

Owlbear Rodeo (OBR) is a browser VTT built around one idea: **a scene is a flat list of
items, and everything (maps, tokens, drawings, fog, rulers, pointers) is an item on a layer**.
Tools are just state machines that create or modify items, and multiplayer is just syncing
that item list plus ephemeral broadcast messages.

Sources: the MIT-licensed `@owlbear-rodeo/sdk` type definitions (authoritative for the v2 data
model), docs.owlbear.rodeo, the OBR blog, and the README of the v1 legacy repo. The legacy repo
is licensed for **personal non-commercial use only**, so read it to understand ideas and never
copy its code into this repo.

## Core concepts (read these first)

| Concept | OBR behaviour | rea-vtt location |
|---|---|---|
| Room | URL-addressed session; creator is GM, everyone with the link is a PLAYER | `server/room.ts` |
| Scene | `{ items, grid, fog, metadata }` — one active scene per room | `shared/types.ts` `Scene` |
| Item | Base fields + type-specific fields; `layer` decides draw order & permissions | `shared/types.ts` `Item` |
| Layer | Fixed ordered enum (MAP bottom … POPOVER top) | `shared/types.ts` `LAYERS` |
| Grid | Scene-level `dpi`, type (square/hex), measurement rule, scale (`"5ft"`) | `shared/grid.ts` |
| Fog | Items on the FOG layer; scene `fog.filled` makes an infinite sheet; items with `metadata["fog.cut"]` subtract (destination-out) | `client/src/canvas/Board.tsx` (fog `Layer`) |
| Player | `{ id, connectionId, role: GM|PLAYER, name, color, selection }` | `shared/types.ts` `Player` |
| Permissions | `<LAYER>_CREATE/UPDATE/DELETE` granted to players by the GM | `shared/permissions.ts` |
| Broadcast | Ephemeral, unpersisted messages on named channels (pointer, ruler, drag) | `shared/protocol.ts` |
| Interaction | Fast local + broadcast updates while dragging; one persisted commit at the end | `onItemDrag*` in `client/src/canvas/Board.tsx` + `CHANNEL.interaction` |

Details and exact field lists: [references/data-model.md](references/data-model.md).
Sync, permissions and rendering pipeline: [references/architecture.md](references/architecture.md).
Grid snapping and measurement math: [references/grid-math.md](references/grid-math.md).

## Layer order (bottom → top)

`MAP, GRID, DRAWING, PROP, MOUNT, CHARACTER, ATTACHMENT, NOTE, TEXT, RULER, FOG, POINTER, POST_PROCESS, CONTROL, POPOVER`

- Fog sits **above** tokens and drawings but **below** pointers, so pointers and rulers stay visible through fog.
- Within a layer, items sort by `zIndex` (OBR uses a timestamp so new items land on top).
- The GM sees fog at partial opacity. Players see it fully opaque.
- The GM sees hidden items (`visible: false`) faded out. Players never get them; rea-vtt filters them on the server.

## Rules of thumb when adding a feature

1. **Model it as an item first.** Persistent things on the board are items with a `layer`. Only invent
   new scene-level state (like `grid` or `fog`) when it really is global.
2. **Persistent vs. ephemeral.** Pointers, in-progress rulers and drag previews go over **broadcast**
   and are never saved. Finished drawings, tokens and fog are **items**.
3. **Drag = interaction.** Never send a persisted update per mouse move. Broadcast transient
   positions and commit once on pointer-up (OBR's `startItemInteraction`).
4. **Permissions live in the server, keyed by layer.** The client hides UI, but the server must
   check `role` + layer permission + `locked` + `visible` before applying any op.
5. **Coordinates are world units = scene pixels.** One grid cell = `grid.dpi` world units. Images
   carry their own `image.grid.dpi`, and they render at `scale = scene.grid.dpi / image.grid.dpi` so maps
   of any resolution line up with the grid.
6. **Snapping and distance go through `shared/grid.ts`** so the client, server and tests agree.
7. **Attachments**: `attachedTo` parent id. Moving or deleting the parent carries its children along (the
   SDK's `AttachmentBehavior` lets you opt out per behaviour).

## Common tasks → where to change

- New item type: add the interface to `shared/types.ts`, add a renderer to `client/src/canvas/ItemNode.tsx`, then create it from a tool in `client/src/canvas/Board.tsx` and allow it in `validateNewItem` (`server/room.ts`).
- New tool: add it to `ToolId` in `client/src/store.ts` and `TOOLS` in `client/src/ui/Toolbar.tsx`, handle the pointer events in `client/src/canvas/Board.tsx`.
- New realtime message: add it to the `ClientMessage`/`ServerMessage` unions in `shared/protocol.ts`, and handle it in `server/room.ts` and `client/src/net/connection.ts`.
- New permission: extend `Permission` in `shared/permissions.ts`, enforce it in `canApply`, and add a test in `server/room.test.ts`.
- Verify: `npm test` (grid math + room/permission rules), `npm run typecheck`, `npm run build`.
