import { definePluginApp, useComposer, useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComposerAttachment } from "@get-bb/plugin-sdk/app";
import { annotationFilename, readAnnotations, writeAnnotations } from "./annotations";
import { annotationPairs, findSidecar, watchAnnotationChips } from "./composer";
import { AnnotationEditor, type Annotation } from "./editor";
import { projectAttachmentUrl, watchPreview, type Preview } from "./preview";
import "./preview.css";
import "./composer.css";

interface EditingSession {
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
  const attachments = composer.draft.attachments;
  const pairs = useMemo(() => annotationPairs(attachments), [attachments]);
  const previousPairs = useRef<{ key: string; pairs: typeof pairs } | null>(null);

  useLayoutEffect(() => {
    const element = marker.current;
    if (element && pairs.length > 0) return watchAnnotationChips(element, attachments, pairs);
  }, [attachments, pairs]);

  useEffect(() => {
    const previous = previousPairs.current;
    previousPairs.current = { key: composer.key, pairs };
    if (previous?.key !== composer.key || !previous.pairs.length) return;
    const paths = new Set(attachments.map(({ path }) => path));
    const orphans = previous.pairs.filter(({ image, sidecar }) => !paths.has(image.path) && paths.has(sidecar.path));
    if (!orphans.length) return;
    composer.replace((current) => {
      const currentPaths = new Set(current.attachments.map(({ path }) => path));
      const remove = new Set(orphans
        .filter(({ image }) => !currentPaths.has(image.path))
        .map(({ sidecar }) => sidecar.path));
      if (!remove.size) return current;
      return {
        ...current,
        attachments: current.attachments.filter(({ path }) => !remove.has(path)),
        mentions: current.mentions.filter((mention) => mention.kind !== "attachment" || !remove.has(mention.path)),
      };
    });
  }, [attachments, composer, pairs]);

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
    if (loading.current) loading.current.abort();
    const request = new AbortController();
    loading.current = request;
    setOpening(true);
    setOpenError("");
    try {
      const scope = composer.scope;
      const sourceProject = projectAttachmentUrl(preview.image.src)?.projectId;
      const projectId = scope.kind === "new-thread"
        ? scope.projectId ?? preview.source.sourceProjectId ?? sourceProject
        : (await sdk.threads.get({ threadId: scope.threadId, signal: request.signal })).projectId;
      if (!projectId) throw new Error("The draft project is unavailable.");

      const filename = annotationFilename(preview.source.name, preview.source.path);
      const previous = findSidecar(composer.draft.attachments, filename);
      let annotations: Annotation[] = [];
      if (previous) {
        const { bytes } = await sdk.projects.attachments.read({
          path: previous.path,
          projectId: previous.sourceProjectId ?? projectId,
          signal: request.signal,
        });
        annotations = readAnnotations(new TextDecoder().decode(bytes), preview.source.path);
      }
      if (request.signal.aborted || currentPreview.current !== preview || !preview.dialog.isConnected) return;
      preview.close.click();
      setEditor({ preview, projectId, filename, previous, annotations });
    } catch {
      if (!request.signal.aborted) setOpenError("Couldn’t open image comments. Try again.");
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

    composer.replace((current) => {
      if (!current.attachments.some((item) => item.path === source.path && item.sourceProjectId === source.sourceProjectId)) {
        throw new Error("This image is no longer attached to the draft.");
      }
      const previous = findSidecar(current.attachments, session.filename);
      if (previous?.path !== session.previous?.path) {
        throw new Error("The annotation attachment changed while you were editing.");
      }
      const attachments = previous
        ? current.attachments.flatMap((item) => item === previous ? upload ? [upload] : [] : [item])
        : upload ? [...current.attachments, upload] : current.attachments;
      const mentions = previous
        ? current.mentions.flatMap((mention) => {
          if (mention.kind !== "attachment" || mention.path !== previous.path) return [mention];
          return upload ? [{ ...mention, path: upload.path }] : [];
        })
        : current.mentions;
      return { ...current, attachments, mentions };
    });
  }

  return <>
    <span ref={marker} hidden data-bb-image-annotations-composer="" />
    {preview && createPortal(
      <div className="bb-image-annotations-preview">
        <button type="button" disabled={opening} onClick={() => void openEditor(preview)}>
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
  app.composer.customize({
    id: "attached-images",
    banners: [{ id: "preview-bridge", chrome: "bare", component: ComposerAnnotationBridge }],
  });
});
