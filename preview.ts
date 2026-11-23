import type { ComposerAttachment } from "@get-bb/plugin-sdk/app";

const formSelector = "form[data-promptbox]";
const markerSelector = "[data-bb-image-annotations-composer]";
const thumbnailSelector = "[data-promptbox-expanded-only] button.cursor-zoom-in[aria-label]";
const dialogSelector = '[role="dialog"][aria-modal="true"][aria-labelledby]';

export interface Preview {
  dialog: HTMLElement;
  close: HTMLButtonElement;
  thumbnail: HTMLButtonElement;
  image: HTMLImageElement;
  source: ComposerAttachment;
}

export function projectAttachmentUrl(src: string): { projectId: string; path: string } | null {
  try {
    const url = new URL(src, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const match = /^\/api\/v1\/projects\/([^/]+)\/attachments\/content$/.exec(url.pathname);
    const path = url.searchParams.get("path");
    return match && path ? { projectId: decodeURIComponent(match[1]), path } : null;
  } catch {
    return null;
  }
}

export function composerForm(marker: HTMLElement): HTMLFormElement | null {
  const owner = marker.closest("[data-app-composer]");
  for (let ancestor = marker.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    if (ancestor.querySelectorAll(markerSelector).length > 1) return null;
    const forms = ancestor.querySelectorAll<HTMLFormElement>(formSelector);
    if (forms.length === 1) {
      return !owner || forms[0].closest("[data-app-composer]") === owner ? forms[0] : null;
    }
    if (forms.length > 1 || ancestor === owner) return null;
  }
  return null;
}

export function imageThumbnails(form: HTMLFormElement): HTMLButtonElement[] {
  return Array.from(form.querySelectorAll<HTMLButtonElement>(thumbnailSelector))
    .filter((button) => button.querySelector(":scope > img") &&
      button.nextElementSibling?.getAttribute("aria-label") === `Remove ${button.getAttribute("aria-label")}`);
}

export function thumbnailSource(
  thumbnail: HTMLButtonElement,
  thumbnails: readonly HTMLButtonElement[],
  attachments: readonly ComposerAttachment[],
): ComposerAttachment | undefined {
  const image = thumbnail.querySelector("img");
  if (!image) return;
  const candidates = attachments.filter((attachment) =>
    attachment.name === image.alt &&
    (attachment.type === "localImage" || attachment.mimeType?.toLowerCase().startsWith("image/")),
  );
  const reference = projectAttachmentUrl(image.src);
  if (reference) {
    return candidates.find((attachment) =>
      attachment.path === reference.path && !attachment.hostId &&
      (!attachment.sourceProjectId || attachment.sourceProjectId === reference.projectId),
    );
  }
  const sameName = thumbnails.filter((button) => button.querySelector("img")?.alt === image.alt);
  if (candidates.length !== sameName.length) return;
  const source = candidates[sameName.indexOf(thumbnail)];
  return source?.hostId ? undefined : source;
}

function isAttachmentPreview(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.matches(dialogSelector)) return false;
  const title = document.getElementById(element.getAttribute("aria-labelledby") ?? "");
  return Boolean(title && element.contains(title) && title.textContent === "Attached media preview");
}

function imagePreview(
  dialog: HTMLElement,
  form: HTMLFormElement,
  attachments: readonly ComposerAttachment[],
): Preview | null {
  const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close image preview"]');
  const image = dialog.querySelector("img");
  if (!close || !image) return null;
  const thumbnails = imageThumbnails(form);
  const thumbnail = thumbnails.find((button) => {
    const candidate = button.querySelector("img");
    return candidate?.alt === image.alt && candidate.src === image.src;
  });
  if (!thumbnail) return null;
  const source = thumbnailSource(thumbnail, thumbnails, attachments);
  return source ? { dialog, close, image, thumbnail, source } : null;
}

// The SDK exposes draft ownership and writes, but has no attachment preview slot.
// This bridge only follows a native preview opened by a thumbnail in this composer.
export function watchPreview(
  marker: HTMLElement,
  attachments: () => readonly ComposerAttachment[],
  onPreview: (preview: Preview | null) => void,
): () => void {
  const listeners = new AbortController();
  let stop = () => {};

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>(thumbnailSelector);
    const form = button?.closest<HTMLFormElement>(formSelector);
    if (!button || !form || composerForm(marker) !== form) return;
    const name = button.getAttribute("aria-label");
    if (button.nextElementSibling?.getAttribute("aria-label") !== `Remove ${name}`) return;

    stop();
    const existing = new Set(Array.from(document.body.children).filter(isAttachmentPreview));
    let dialog: HTMLElement | undefined;
    let lastImage: HTMLImageElement | undefined;
    let lastSrc: string | undefined;
    const sync = () => {
      if (!dialog) return;
      const preview = imagePreview(dialog, form, attachments());
      if (preview?.image === lastImage && preview?.image.src === lastSrc) return;
      lastImage = preview?.image;
      lastSrc = preview?.image.src;
      onPreview(preview);
    };
    const media = new MutationObserver(sync);
    const portals = new MutationObserver(() => {
      if (dialog) {
        if (!dialog.isConnected) stop();
        return;
      }
      dialog = Array.from(document.body.children).filter(isAttachmentPreview).find((item) => !existing.has(item));
      if (!dialog) return;
      window.clearTimeout(timeout);
      media.observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      sync();
    });
    portals.observe(document.body, { childList: true });
    const timeout = window.setTimeout(() => stop(), 2_000);
    stop = () => {
      window.clearTimeout(timeout);
      portals.disconnect();
      media.disconnect();
      if (lastImage) onPreview(null);
    };
  }, { capture: true, signal: listeners.signal });

  return () => {
    listeners.abort();
    stop();
  };
}
