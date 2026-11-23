import type { ComposerAttachment } from "@get-bb/plugin-sdk/app";
import { annotationSuffix } from "./annotations";
import { composerForm, imageThumbnails, thumbnailSource } from "./preview";

export type AnnotationPair = { image: ComposerAttachment; sidecar: ComposerAttachment };
const chipLabel = "Annotated image";
const hiddenClass = "bb-ia-hidden-sidecar";

export function sidecarCandidates(attachments: readonly ComposerAttachment[], imagePath: string) {
  const suffix = annotationSuffix(imagePath);
  return attachments.filter((attachment) =>
    attachment.type === "localFile" && !attachment.hostId && attachment.name.endsWith(suffix),
  );
}

export function annotationPairs(attachments: readonly ComposerAttachment[]): AnnotationPair[] {
  return attachments.flatMap((image) => {
    if (image.hostId || (image.type !== "localImage" && !image.mimeType?.toLowerCase().startsWith("image/"))) {
      return [];
    }
    const [sidecar, duplicate] = sidecarCandidates(attachments, image.path);
    return sidecar && !duplicate ? [{ image, sidecar }] : [];
  });
}

function annotationChip(): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "bb-ia-thumbnail-chip";
  chip.setAttribute("role", "img");
  chip.setAttribute("aria-label", chipLabel);
  return chip;
}

export function watchAnnotationChips(
  marker: HTMLElement,
  attachments: readonly ComposerAttachment[],
  pairs: readonly AnnotationPair[],
): () => void {
  const filesByImage = new Map(pairs.map(({ image, sidecar }) => [image.path, sidecar.name]));
  const chips = new Map<Element, HTMLElement>();
  let hiddenFiles = new Set<Element>();

  function sync() {
    const form = composerForm(marker);
    const thumbnails = form ? imageThumbnails(form) : [];
    const parents = new Set<Element>();
    const hiddenNames = new Set<string>();
    for (const button of thumbnails) {
      const image = thumbnailSource(button, thumbnails, attachments);
      const file = image && filesByImage.get(image.path);
      if (!file || !button.parentElement) continue;
      parents.add(button.parentElement);
      hiddenNames.add(`Remove ${file}`);
      if (!chips.has(button.parentElement)) {
        const chip = annotationChip();
        button.parentElement.append(chip);
        chips.set(button.parentElement, chip);
      }
    }
    for (const [parent, chip] of chips) {
      if (parents.has(parent)) continue;
      chip.remove();
      chips.delete(parent);
    }

    const nextHidden = new Set<Element>();
    const removeButtons = form?.querySelectorAll('button[class~="group/attachment-remove-file"][aria-label]');
    removeButtons?.forEach((button) => {
      const pill = button.closest("span.inline-flex.rounded-full");
      if (!pill || !hiddenNames.has(button.getAttribute("aria-label") ?? "")) return;
      pill.classList.add(hiddenClass);
      nextHidden.add(pill);
    });
    for (const pill of hiddenFiles) {
      if (!nextHidden.has(pill)) pill.classList.remove(hiddenClass);
    }
    hiddenFiles = nextHidden;
  }

  const root = marker.closest("[data-app-composer]") ?? composerForm(marker);
  const observer = new MutationObserver(sync);
  if (root) observer.observe(root, { childList: true, subtree: true });
  sync();
  return () => {
    observer.disconnect();
    for (const chip of chips.values()) chip.remove();
    for (const pill of hiddenFiles) pill.classList.remove(hiddenClass);
  };
}
