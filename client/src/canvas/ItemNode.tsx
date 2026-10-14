import { useEffect, useState } from "react";
import type Konva from "konva";
import { Circle, Ellipse, Group, Image as KImage, Line, Rect, Text } from "react-konva";
import { imageScale } from "../../../shared/grid";
import type { Grid, ImageItem, Item, ShapeStyle, Vector2 } from "../../../shared/types";

const cache = new Map<string, HTMLImageElement>();

export function useImage(url: string): HTMLImageElement | undefined {
  const [img, setImg] = useState(() => {
    const c = cache.get(url);
    return c?.complete ? c : undefined;
  });
  useEffect(() => {
    let el = cache.get(url);
    if (!el) {
      el = new window.Image();
      el.src = url;
      cache.set(url, el);
    }
    if (el.complete && el.naturalWidth) return setImg(el);
    const onLoad = () => setImg(el);
    el.addEventListener("load", onLoad);
    return () => el!.removeEventListener("load", onLoad);
  }, [url]);
  return img;
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function styleProps(style: ShapeStyle) {
  return {
    fill: style.fillOpacity > 0 ? rgba(style.fillColor, style.fillOpacity) : undefined,
    stroke: style.strokeWidth > 0 ? rgba(style.strokeColor, style.strokeOpacity) : undefined,
    strokeWidth: style.strokeWidth,
    dash: style.strokeDash.length ? style.strokeDash : undefined,
    lineCap: "round" as const,
    lineJoin: "round" as const,
    hitStrokeWidth: Math.max(style.strokeWidth, 20),
  };
}

export interface ItemNodeProps {
  item: Item;
  grid: Grid;
  position: Vector2;
  draggable: boolean;
  listening: boolean;
  /** Faded rendering for items hidden from players (GM view). */
  ghost: boolean;
  onPointerDown?: (e: Konva.KonvaEventObject<PointerEvent>, item: Item) => void;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>, item: Item) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>, item: Item) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>, item: Item) => void;
  /** Override fill/stroke (used by the fog layer). */
  fogColor?: string;
  /** Erase fog instead of painting it. */
  fogCut?: boolean;
}

export function ItemNode(props: ItemNodeProps) {
  const { item, position, draggable, listening, ghost } = props;
  const common = {
    id: item.id,
    name: "item",
    x: position.x,
    y: position.y,
    rotation: item.rotation,
    scaleX: item.scale.x,
    scaleY: item.scale.y,
    draggable,
    listening,
    opacity: ghost ? 0.5 : 1,
    onPointerDown: props.onPointerDown && ((e: Konva.KonvaEventObject<PointerEvent>) => props.onPointerDown!(e, item)),
    onDragStart: props.onDragStart && ((e: Konva.KonvaEventObject<DragEvent>) => props.onDragStart!(e, item)),
    onDragMove: props.onDragMove && ((e: Konva.KonvaEventObject<DragEvent>) => props.onDragMove!(e, item)),
    onDragEnd: props.onDragEnd && ((e: Konva.KonvaEventObject<DragEvent>) => props.onDragEnd!(e, item)),
  };
  const fog = props.fogColor
    ? {
        fill: props.fogColor,
        strokeWidth: 0,
        globalCompositeOperation: (props.fogCut ? "destination-out" : "source-over") as GlobalCompositeOperation,
      }
    : null;

  switch (item.type) {
    case "IMAGE":
      return <ImageNode {...props} common={common} />;
    case "SHAPE": {
      const s = fog ?? styleProps(item.style);
      const label = item.label ? (
        <Text
          text={item.label}
          width={item.width}
          height={item.height}
          x={item.shapeType === "CIRCLE" ? -item.width / 2 : 0}
          y={item.shapeType === "CIRCLE" ? -item.height / 2 : 0}
          align="center"
          verticalAlign="middle"
          fontSize={Math.max(14, item.height * 0.4)}
          fontStyle="bold"
          fill="#fff"
          listening={false}
        />
      ) : null;
      return (
        <Group {...common}>
          {item.shapeType === "CIRCLE" ? (
            <Ellipse radiusX={item.width / 2} radiusY={item.height / 2} {...s} />
          ) : (
            <Rect width={item.width} height={item.height} {...s} />
          )}
          {label}
        </Group>
      );
    }
    case "CURVE":
      return (
        <Line
          {...common}
          points={item.points.flatMap((p) => [p.x, p.y])}
          closed={item.closed}
          tension={item.tension}
          {...(fog ?? styleProps(item.style))}
        />
      );
    case "LINE":
      return (
        <Line
          {...common}
          points={[item.startPosition.x, item.startPosition.y, item.endPosition.x, item.endPosition.y]}
          {...styleProps(item.style)}
        />
      );
    case "TEXT":
      return <Text {...common} text={item.text} fontSize={item.fontSize} fill={item.color} fontStyle="bold" shadowColor="#000" shadowBlur={4} shadowOpacity={0.6} />;
  }
}

function ImageNode({ item: anyItem, grid, common }: ItemNodeProps & { common: Record<string, unknown> }) {
  const item = anyItem as ImageItem;
  const img = useImage(item.image.url);
  const s = imageScale(grid, item.grid.dpi);
  const scale = common as { scaleX: number; scaleY: number };
  const props = {
    ...common,
    scaleX: scale.scaleX * s,
    scaleY: scale.scaleY * s,
    offsetX: item.grid.offset.x,
    offsetY: item.grid.offset.y,
  };
  if (!img) {
    // Placeholder until the image loads.
    return <Rect {...props} width={item.image.width} height={item.image.height} fill="rgba(128,128,128,0.3)" />;
  }
  return <KImage {...props} image={img} width={item.image.width} height={item.image.height} />;
}

export function PointerDot({ position, color }: { position: Vector2; color: string }) {
  return <Circle x={position.x} y={position.y} radius={12} fill={color} shadowColor={color} shadowBlur={20} listening={false} />;
}
