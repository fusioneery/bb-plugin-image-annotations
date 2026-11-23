import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./editor.css";

export type Point = { x: number; y: number };
type Shape =
  | { kind: "point"; point: Point }
  | { kind: "rectangle"; from: Point; to: Point };
export type Annotation = Shape & { comment: string };

type DraftComment = {
  shape: Shape;
  comment: string;
  index?: number;
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  start: Point;
};

const MAX_ANNOTATIONS = 100;
const MAX_COMMENT_LENGTH = 4000;
const CENTER: Point = { x: 0.5, y: 0.5 };
const DRAG_THRESHOLD = 5;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pointAt(event: PointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

function rectangle(from: Point, to: Point): Shape {
  return {
    kind: "rectangle",
    from: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
    to: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) },
  };
}

function rectangleAt(gesture: Gesture, event: PointerEvent<HTMLDivElement>): Shape | null {
  if (
    Math.abs(event.clientX - gesture.startX) < DRAG_THRESHOLD ||
    Math.abs(event.clientY - gesture.startY) < DRAG_THRESHOLD
  ) return null;

  const end = pointAt(event);
  return end.x === gesture.start.x || end.y === gesture.start.y
    ? null
    : rectangle(gesture.start, end);
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

function ImageStage({
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
  draft: DraftComment | null;
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

    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: pointAt(event),
    };
    setAnchor(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    setPreview(rectangleAt(active, event));
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
    onMark(rectangleAt(active, event) ?? { kind: "point", point: active.start });
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

function withDraft(annotations: readonly Annotation[], draft: DraftComment | null) {
  const comment = draft?.comment.trim();
  if (!draft || !comment) return annotations;
  const annotation: Annotation = { ...draft.shape, comment };
  if (draft.index === undefined) return [...annotations, annotation];
  return annotations.map((item, index) => (index === draft.index ? annotation : item));
}

export function AnnotationEditor({
  imageSrc,
  imageName,
  initialAnnotations,
  save,
  onClose,
}: {
  imageSrc: string;
  imageName: string;
  initialAnnotations: readonly Annotation[];
  save: (annotations: readonly Annotation[]) => Promise<void>;
  onClose: () => void;
}) {
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const errorNotice = useRef<HTMLDivElement>(null);
  const savingNow = useRef(false);
  const pressedOutside = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const commentsId = useId();
  const commentId = useId();

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    return () => node.close();
  }, []);

  const draftShape = draft?.shape;
  const draftIndex = draft?.index;
  useLayoutEffect(() => {
    if (draftShape) input.current?.focus();
  }, [draftShape, draftIndex]);

  useLayoutEffect(() => {
    if (saveError) errorNotice.current?.focus();
  }, [saveError]);

  function addMark(shape: Shape) {
    const updated = withDraft(annotations, draft);
    if (updated.length >= MAX_ANNOTATIONS) {
      setNotice("This image has reached its 100-comment limit.");
      return;
    }
    setNotice("");
    setAnnotations(updated);
    setDraft({ shape, comment: "" });
  }

  function edit(index: number) {
    if (savingNow.current) return;
    if (draft?.index === index) {
      input.current?.focus();
      return;
    }
    const updated = withDraft(annotations, draft);
    const annotation = updated[index];
    setAnnotations(updated);
    setDraft({ shape: annotation, comment: annotation.comment, index });
  }

  function remove(index: number) {
    setAnnotations(withDraft(annotations, draft).filter((_, itemIndex) => itemIndex !== index));
    setDraft(null);
    setNotice("");
  }

  function close() {
    if (!dialog.current?.open) return;
    dialog.current.close();
    onClose();
  }

  async function saveAndClose() {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await save(withDraft(annotations, draft));
      close();
    } catch (error) {
      setSaveError(error instanceof Error && error.message
        ? error.message
        : "Couldn’t attach the comments. Try again.");
    } finally {
      savingNow.current = false;
      if (dialog.current?.open) setSaving(false);
    }
  }

  function isOutside(event: PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  }

  return (
    // BB's shortcut manager checks aria-modal when deciding whether to handle keys.
    <dialog
      ref={dialog}
      className="bb-ia-dialog"
      data-bb-image-preview-ignore=""
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={saving}
      onCancel={(event) => {
        event.preventDefault();
        void saveAndClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.isPrimary && event.button === 0 && isOutside(event);
      }}
      onPointerUp={(event) => {
        const shouldClose = event.isPrimary && pressedOutside.current && isOutside(event);
        pressedOutside.current = false;
        if (shouldClose) void saveAndClose();
      }}
      onPointerCancel={() => { pressedOutside.current = false; }}
    >
      <header className="bb-ia-header">
        <div className="bb-ia-title">
          <h1 id={titleId}>Annotate image</h1>
          <p title={imageName}>{imageName}</p>
        </div>
        <button
          type="button"
          className="bb-ia-button bb-ia-primary"
          onClick={() => void saveAndClose()}
          disabled={saving}
          autoFocus
        >
          {saving ? "Attaching…" : "Done"}
        </button>
      </header>
      <div className="bb-ia-body">
        <div className="bb-ia-workspace">
          <ImageStage
            src={imageSrc}
            name={imageName}
            annotations={annotations}
            draft={draft}
            disabled={saving}
            hintId={hintId}
            onMark={addMark}
            onSelect={edit}
          />
          <p className="bb-ia-hint" id={hintId}>
            Click to pin or drag to outline an area.
            <span className="bb-ia-keyboard-hint">
              {" "}Use arrows to move, Enter to pin, or Shift+Enter to start a rectangle.
              Move diagonally and press Enter to finish.
            </span>
          </p>
        </div>
        <section className="bb-ia-comments" aria-labelledby={commentsId}>
          <h2 id={commentsId}>Comments <span>{annotations.length}</span></h2>
          {draft && (
            <form
              className="bb-ia-form"
              onSubmit={(event) => {
                event.preventDefault();
                setAnnotations(withDraft(annotations, draft));
                setDraft(null);
              }}
            >
              <label htmlFor={commentId}>Comment</label>
              <textarea
                id={commentId}
                ref={input}
                value={draft.comment}
                maxLength={MAX_COMMENT_LENGTH}
                rows={3}
                placeholder="What should change here?"
                onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
                disabled={saving}
              />
              <div className="bb-ia-actions">
                <button
                  type="button"
                  className="bb-ia-button"
                  onClick={() => setDraft(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bb-ia-button bb-ia-primary"
                  disabled={!draft.comment.trim() || saving}
                >
                  {draft.index === undefined ? "Add comment" : "Save comment"}
                </button>
              </div>
            </form>
          )}
          {notice && <p className="bb-ia-notice" role="status">{notice}</p>}
          {saveError && (
            <div className="bb-ia-error" tabIndex={-1} ref={errorNotice}>
              <p role="alert">{saveError}</p>
              <button type="button" className="bb-ia-button" onClick={close}>Discard changes</button>
            </div>
          )}
          <ol className="bb-ia-list">
            {annotations.map((annotation, index) => (
              <li key={index} data-selected={draft?.index === index}>
                <span className="bb-ia-number" aria-hidden="true">{index + 1}</span>
                <div>
                  <p>{annotation.comment}</p>
                  <div className="bb-ia-item-actions">
                    <button
                      type="button"
                      aria-label={`Edit comment ${index + 1}`}
                      onClick={() => edit(index)}
                      disabled={saving}
                    >Edit</button>
                    <button
                      type="button"
                      aria-label={`Delete comment ${index + 1}`}
                      onClick={() => remove(index)}
                      disabled={saving}
                    >Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </dialog>
  );
}
