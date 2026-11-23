import { useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { MAX_ANNOTATIONS, MAX_COMMENT_LENGTH } from "./annotations";
import type { Annotation, Shape } from "./geometry";
import { ImageStage } from "./image-stage";
import "./editor.css";

type DraftComment = {
  shape: Shape;
  comment: string;
  index?: number;
};

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
      setNotice(`This image has reached its ${MAX_ANNOTATIONS}-comment limit.`);
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
