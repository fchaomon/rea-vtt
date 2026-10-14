# rea-vtt

A lightweight browser virtual tabletop modelled on [Owlbear Rodeo](https://www.owlbear.rodeo/):
everything on the board is an **item on a layer**, synced through a server-authoritative WebSocket room.

## Features
- Rooms: the creator is the GM, and anyone with the invite link joins as a player.
- Maps: upload an image and set "cells across" so it lines up with the grid.
- Tokens, props and mounts: image uploads or quick coloured tokens. They snap to the grid on drop (hold Alt to place freely).
- Grid: square or hex (pointy- or flat-top), with Chebyshev, alternating (5-10-5), Manhattan or Euclidean measurement, and a configurable scale like `5ft`.
- Fog of war: polygon, rectangle and brush fog, **Fill fog** (an infinite sheet), and **Cut** shapes that reveal. The GM sees it translucent, players see it opaque.
- Hidden items: never sent to players at all, because the server filters them.
- Drawing (rectangle, circle, line, brush), text, a shared measuring ruler, and a laser pointer with smoothed remote motion.
- Live dragging that others see in real time, committed once on drop.
- Move, resize and rotate, lock, z-order, attachments, and undo/redo.
- GM-controlled player permissions per layer (create/update/delete, plus "own characters only").

## Run
```bash
npm install
npm run dev        # server :3001 + Vite :5173 → open http://localhost:5173
npm test           # grid math + room permission/sync rules
npm run build && npm start   # production on :3001 (serves dist/)
```
Data lives in `./data` (`DATA_DIR` to override): room JSON in `data/rooms`, and uploads in `data/uploads`.

## Controls
`W` move · `D` draw · `F` fog · `M` measure · `P` pointer · `T` text · wheel = zoom · space/middle/right-drag = pan ·
`Delete` remove · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo

## Layout
`shared/` (types, protocol, grid math, permissions) · `server/` (http + ws rooms) · `client/src/` (React + react-konva + zustand).
See `.claude/skills/owlbear-vtt/` for how Owlbear Rodeo works and how this project maps onto it.
