import { useEffect, useRef } from "react";
import type Konva from "konva";
import { Circle, Group, Text } from "react-konva";
import type { Vector2 } from "../../../shared/types";
import { useStore } from "../store";

/**
 * Laser pointers. Remote pointers arrive at ~30Hz, so each one eases toward its latest
 * target every animation frame. This is the interpolation trick OBR v1 used to hide network jitter.
 */
export function RemotePointers({ local, localColor, scale }: { local: Vector2 | null; localColor: string; scale: number }) {
  const pointers = useStore((s) => s.remotePointers);
  return (
    <>
      {Object.entries(pointers).map(([id, p]) => (
        <SmoothPointer key={id} target={p.position} color={p.color} label={p.name} scale={scale} />
      ))}
      {local && <Dot position={local} color={localColor} scale={scale} />}
    </>
  );
}

function Dot({ position, color, scale }: { position: Vector2; color: string; scale: number }) {
  return <Circle x={position.x} y={position.y} radius={10 / scale} fill={color} shadowColor={color} shadowBlur={16} listening={false} />;
}

function SmoothPointer({ target, color, label, scale }: { target: Vector2; color: string; label: string; scale: number }) {
  const ref = useRef<Konva.Group>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const node = ref.current;
      if (node) {
        const t = targetRef.current;
        const x = node.x() + (t.x - node.x()) * 0.35;
        const y = node.y() + (t.y - node.y()) * 0.35;
        if (Math.abs(x - node.x()) > 0.01 || Math.abs(y - node.y()) > 0.01) {
          node.position({ x, y });
          node.getLayer()?.batchDraw();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    ref.current?.position(targetRef.current);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Group ref={ref} listening={false}>
      <Circle radius={10 / scale} fill={color} shadowColor={color} shadowBlur={16} />
      <Text text={label} x={14 / scale} y={-6 / scale} fontSize={13 / scale} fill="#fff" shadowColor="#000" shadowBlur={3} />
    </Group>
  );
}
