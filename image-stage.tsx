import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { markFromGesture, rectangle, type Annotation, type Point, type Shape } from "./geometry";

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  start: Point;
  maxDisplacement: number;
};

const CENTER: Point = { x: 0.5, y: 0.5 };

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pointAt(event: PointerEvent<HTMLDivElement>): Point | null {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return null;
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

function markAt(gesture: Gesture, event: PointerEvent<HTMLDivElement>): Shape | null {
  const point = pointAt(event);
  if (!point) return null;
  const displacement = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
  gesture.maxDisplacement = Math.max(gesture.maxDisplacement, displacement);
  return markFromGesture(gesture.start, point, gesture.maxDisplacement);
}

function pointStyle(point: Point): CSSProperties {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
}

function areaStyle(shape: Extract<Shape, { kind: "rectangle" }>): CSSProperties {
  return {
    ...pointStyle(shape.from),
    width: `${(shape.to.x - shape.from.x) * 100}%`,
    height: `${(shape.to.y - shape.from.y) * 100}%`,
  };
}

function Marker({
  shape,
  number,
  selected,
  onSelect,
}: {
  shape: Shape;
  number?: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const point = shape.kind === "point" ? shape.point : shape.from;
  return (
    <>
      {shape.kind === "rectangle" && (
        <span
          className="bb-ia-rectangle"
          style={areaStyle(shape)}
          data-selected={selected}
        />
      )}
      {onSelect ? (
        <button
          type="button"
          className="bb-ia-pin"
          aria-label={`Select comment ${number}`}
          aria-pressed={selected}
          style={pointStyle(point)}
          data-selected={selected}
          onClick={onSelect}
        >
          {number}
        </button>
      ) : number !== undefined ? (
        <span className="bb-ia-pin" style={pointStyle(point)} data-selected="true">
          {number}
        </span>
      ) : null}
    </>
  );
}

export function ImageStage({
  src,
  name,
  annotations,
  draft,
  disabled,
  hintId,
  onMark,
  onSelect,
}: {
  src: string;
  name: string;
  annotations: readonly Annotation[];
  draft: { shape: Shape; index?: number } | null;
  disabled: boolean;
  hintId: string;
  onMark: (shape: Shape) => void;
  onSelect: (index: number) => void;
}) {
  const [ratio, setRatio] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Shape | null>(null);
  const [cursor, setCursor] = useState(CENTER);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const gesture = useRef<Gesture | null>(null);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (
      disabled || !ratio || !event.isPrimary || event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    ) return;

    const point = pointAt(event);
    if (!point) return;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: point,
      maxDisplacement: 0,
    };
    setAnchor(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    const mark = markAt(active, event);
    setPreview(mark?.kind === "rectangle" ? mark : null);
  }

  function cancel(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreview(null);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    cancel(event);
    const mark = markAt(active, event);
    if (mark) onMark(mark);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !ratio || disabled) return;
    if (event.key === "Escape" && anchor) {
      event.preventDefault();
      event.stopPropagation();
      setAnchor(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (anchor) {
        if (anchor.x !== cursor.x && anchor.y !== cursor.y) {
          onMark(rectangle(anchor, cursor));
          setAnchor(null);
        }
      } else if (event.shiftKey) {
        setAnchor(cursor);
      } else {
        onMark({ kind: "point", point: cursor });
      }
      return;
    }
    const step = event.shiftKey ? 0.1 : 0.02;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (dx || dy) {
      event.preventDefault();
      setCursor((point) => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) }));
    }
  }

  return (
    <div className="bb-ia-canvas">
      {failed ? (
        <p role="alert">This image couldn’t be loaded.</p>
      ) : (
        <div
          className="bb-ia-image"
          data-ready={!!ratio}
          role="group"
          aria-label="Image annotation area"
          aria-describedby={hintId}
          tabIndex={ratio ? 0 : undefined}
          style={{ "--bb-ia-ratio": ratio ?? 1 } as CSSProperties}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={keyDown}
        >
          <img
            src={src}
            alt={name}
            draggable={false}
            onLoad={({ currentTarget }) => {
              if (currentTarget.naturalWidth && currentTarget.naturalHeight) {
                setRatio(currentTarget.naturalWidth / currentTarget.naturalHeight);
              } else {
                setFailed(true);
              }
            }}
            onError={() => setFailed(true)}
          />
          {!ratio && <p role="status">Loading image…</p>}
          {ratio && (
            <>
              {annotations.map((annotation, index) => (
                <Marker
                  key={index}
                  shape={annotation}
                  number={index + 1}
                  selected={draft?.index === index}
                  onSelect={() => onSelect(index)}
                />
              ))}
              {draft && draft.index === undefined && (
                <Marker shape={draft.shape} number={annotations.length + 1} selected />
              )}
              {preview && <Marker shape={preview} selected />}
              <span aria-hidden="true" className="bb-ia-keyboard">
                {anchor && <Marker shape={rectangle(anchor, cursor)} selected />}
                <span className="bb-ia-crosshair" style={pointStyle(cursor)} />
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
