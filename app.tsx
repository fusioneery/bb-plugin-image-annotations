import { definePluginApp, useComposer, useSdk, type ComposerAttachment, type ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { annotationFilename, writeAnnotations } from "./annotations";
import { sidecarCandidates } from "./composer";
import { draftProject, readDraftAnnotations, replaceSidecar, requireCurrentSidecar, useDraftAnnotations } from "./draft-annotations";
import { AnnotationEditor } from "./editor";
import type { Annotation } from "./geometry";
import { hideHistoryUtilities } from "./history";
import { projectAttachmentUrl, watchPreview, type Preview } from "./preview";
import "./preview.css";
import "./composer.css";

interface EditingSession {
  draftKey: string;
  preview: Preview;
  projectId: string;
  filename: string;
  previous: ComposerAttachment | undefined;
  annotations: readonly Annotation[];
}

function ComposerAnnotationBridge() {
  const composer = useComposer();
  const sdk = useSdk();
  const marker = useRef<HTMLSpanElement>(null);
  const currentPreview = useRef<Preview | null>(null);
  const loading = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editor, setEditor] = useState<EditingSession | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const rememberSidecar = useDraftAnnotations(composer, sdk, marker);

  useEffect(() => {
    const element = marker.current;
    if (!element) return;
    const dispose = watchPreview(element, () => composer.draft.attachments, (next) => {
      loading.current?.abort();
      currentPreview.current = next;
      setPreview(next);
      setOpening(false);
      setOpenError("");
    });
    return () => {
      loading.current?.abort();
      dispose();
    };
  }, [composer]);

  async function openEditor(preview: Preview) {
    loading.current?.abort();
    const draftKey = composer.key;
    const [previous, duplicate] = sidecarCandidates(composer.draft.attachments, preview.source.path);
    if (duplicate) {
      setOpenError("Remove the extra annotation attachments to continue.");
      return;
    }
    const request = new AbortController();
    loading.current = request;
    setOpening(true);
    setOpenError("");
    try {
      const sourceProject = preview.source.sourceProjectId ?? projectAttachmentUrl(preview.image.src)?.projectId;
      const projectId = await draftProject(sdk, composer.scope, request.signal, sourceProject);
      if (!projectId) throw new Error("The draft project is unavailable.");

      const filename = previous?.name ?? annotationFilename(preview.source.name, preview.source.path);
      const pair = previous ? { image: preview.source, sidecar: previous } : null;
      const annotations = pair ? await readDraftAnnotations(sdk, pair, projectId, request.signal) : [];
      if (request.signal.aborted || draftKey !== composer.key || currentPreview.current !== preview ||
        !preview.dialog.isConnected) return;
      requireCurrentSidecar(composer.draft, preview.source, previous);
      if (pair) rememberSidecar(pair);
      preview.close.click();
      setEditor({ draftKey, preview, projectId, filename, previous, annotations });
    } catch {
      if (!request.signal.aborted) {
        setOpenError(previous
          ? "Couldn’t read the annotation file. Try again, or remove the file to start over."
          : "Couldn’t open image comments. Try again.");
      }
    } finally {
      if (loading.current === request) {
        loading.current = null;
        setOpening(false);
      }
    }
  }

  async function saveAnnotations(session: EditingSession, annotations: readonly Annotation[]) {
    if (JSON.stringify(annotations) === JSON.stringify(session.annotations)) return;
    const { source } = session.preview;
    const checkDraft = (draft: ComposerDraftSnapshot) => {
      if (composer.key !== session.draftKey) throw new Error("This draft has changed. Close and reopen the editor.");
      return requireCurrentSidecar(draft, source, session.previous);
    };
    checkDraft(composer.draft);
    const upload = annotations.length > 0
      ? await sdk.projects.attachments.upload({
        projectId: session.projectId,
        clientFile: new File(
          [writeAnnotations(source.name, source.path, annotations)],
          session.filename,
          { type: "text/markdown" },
        ),
      })
      : null;

    if (upload) rememberSidecar({ image: source, sidecar: upload });
    composer.replace((current) => replaceSidecar(current, checkDraft(current), upload));
  }

  return <>
    <span ref={marker} hidden data-bb-image-annotations-composer="" />
    {preview && createPortal(
      <div className="bb-image-annotations-preview">
        <button type="button" disabled={opening} onClick={() => void openEditor(preview)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m10 13 7.5-8.5a2.1 2.1 0 1 1 3 3L12 15M10 13l2 2" />
            <path d="M10 13c-2.2-.7-4.2.7-4.4 3.1-.1 1.6-.7 2.6-2.1 3.4 3.8 1.8 8.4-.4 8.5-4.5" />
          </svg>
          {opening ? "Opening…" : "Annotate"}
        </button>
        {openError && <p role="alert">{openError}</p>}
      </div>,
      preview.dialog,
    )}
    {editor && createPortal(
      <AnnotationEditor
        imageSrc={editor.preview.image.src}
        imageName={editor.preview.source.name}
        initialAnnotations={editor.annotations}
        save={(annotations) => saveAnnotations(editor, annotations)}
        onClose={() => {
          setEditor(null);
          requestAnimationFrame(() => editor.preview.thumbnail.focus({ preventScroll: true }));
        }}
      />,
      document.body,
    )}
  </>;
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "hide-history-utilities", mount: hideHistoryUtilities });
  app.composer.customize({
    id: "attached-images",
    banners: [{ id: "preview-bridge", chrome: "bare", component: ComposerAnnotationBridge }],
  });
});
