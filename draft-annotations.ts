import type { ComposerAttachment, ComposerDraftSnapshot, PluginBrowserBbSdk, PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { readAnnotations } from "./annotations";
import { annotationPairs, sidecarCandidates, watchAnnotationChips, type AnnotationPair } from "./composer";

function sameAttachment(first: ComposerAttachment, second: ComposerAttachment) {
  return first.path === second.path && first.sourceProjectId === second.sourceProjectId;
}

function containsAttachment(attachments: readonly ComposerAttachment[], attachment: ComposerAttachment) {
  return attachments.some((item) => sameAttachment(item, attachment));
}

export async function draftProject(
  sdk: PluginBrowserBbSdk, scope: PluginComposerApi["scope"], signal: AbortSignal,
  fallback?: string,
) {
  if (scope.kind === "new-thread") return scope.projectId ?? fallback;
  return (await sdk.threads.get({ threadId: scope.threadId, signal })).projectId;
}

export async function readDraftAnnotations(
  sdk: PluginBrowserBbSdk, pair: AnnotationPair, projectId: string, signal: AbortSignal,
) {
  const { bytes } = await sdk.projects.attachments.read({
    path: pair.sidecar.path,
    projectId: pair.sidecar.sourceProjectId ?? projectId,
    signal,
  });
  return readAnnotations(new TextDecoder().decode(bytes), pair.image.path);
}

export function requireCurrentSidecar(
  draft: ComposerDraftSnapshot, source: ComposerAttachment, expected: ComposerAttachment | undefined,
) {
  if (!containsAttachment(draft.attachments, source)) {
    throw new Error("This image is no longer attached to the draft.");
  }
  const [current, duplicate] = sidecarCandidates(draft.attachments, source.path);
  if (duplicate || current?.path !== expected?.path || current?.sourceProjectId !== expected?.sourceProjectId) {
    throw new Error("The annotation file changed. Close the editor and reopen the image.");
  }
  return current;
}

export function replaceSidecar(
  draft: ComposerDraftSnapshot, previous: ComposerAttachment | undefined, upload: ComposerAttachment | null,
): ComposerDraftSnapshot {
  const replacement = upload ? [upload] : [];
  if (!previous) return { ...draft, attachments: [...draft.attachments, ...replacement] };
  return {
    ...draft,
    attachments: draft.attachments.flatMap((item) => item === previous ? replacement : [item]),
    mentions: draft.mentions.flatMap((mention) => {
      if (mention.kind !== "attachment" || mention.path !== previous.path) return [mention];
      return upload ? [{ ...mention, path: upload.path }] : [];
    }),
  };
}

function pairKey({ image, sidecar }: AnnotationPair) {
  return JSON.stringify([image.path, image.sourceProjectId, sidecar.path, sidecar.sourceProjectId]);
}

export function useDraftAnnotations(
  composer: PluginComposerApi, sdk: PluginBrowserBbSdk, marker: RefObject<HTMLSpanElement | null>,
) {
  const attachments = composer.draft.attachments;
  const pairs = useMemo(() => annotationPairs(attachments), [attachments]);
  const previous = useRef<{ key: string; pairs: AnnotationPair[] } | null>(null);
  const verified = useRef(new Set<string>());
  const key = composer.key;

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { key, pairs };
    const known = verified.current;
    if (before && before.key !== key) known.clear();

    const orphans = before?.key === key ? before.pairs.filter((pair) =>
      known.has(pairKey(pair)) && !containsAttachment(attachments, pair.image) &&
      containsAttachment(attachments, pair.sidecar),
    ) : [];
    if (orphans.length) {
      composer.replace((current) => orphans.reduce((draft, { image, sidecar }) => {
        if (containsAttachment(draft.attachments, image)) return draft;
        const file = draft.attachments.find((item) => sameAttachment(item, sidecar));
        return file ? replaceSidecar(draft, file, null) : draft;
      }, current));
    }

    const liveKeys = new Set(pairs.map(pairKey));
    for (const checked of known) if (!liveKeys.has(checked)) known.delete(checked);

    const element = marker.current;
    if (!element || !pairs.length) return;
    const abort = new AbortController();
    let dispose = () => {};
    const render = () => {
      dispose();
      const visible = pairs.filter((pair) => known.has(pairKey(pair)));
      if (visible.length) dispose = watchAnnotationChips(element, attachments, visible);
    };
    render();

    // A generated name locates candidates. Only a verified annotation file may
    // be hidden or removed with the image.
    const unchecked = pairs.filter((pair) => !known.has(pairKey(pair)));
    if (unchecked.length) void Promise.all(unchecked.map(async (pair) => {
      try {
        const owner = pair.sidecar.sourceProjectId ??
          await draftProject(sdk, composer.scope, abort.signal, pair.image.sourceProjectId);
        if (!owner) return;
        await readDraftAnnotations(sdk, pair, owner, abort.signal);
        if (!abort.signal.aborted) known.add(pairKey(pair));
      } catch {
        // A damaged or unrelated file stays visible as a normal attachment.
      }
    })).then(() => {
      if (!abort.signal.aborted) render();
    });

    return () => {
      abort.abort();
      dispose();
    };
  }, [attachments, composer, key, marker, pairs, sdk]);

  return (pair: AnnotationPair) => verified.current.add(pairKey(pair));
}
