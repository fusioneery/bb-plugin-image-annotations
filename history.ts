import { annotationSuffix } from "./annotations";
import { projectAttachmentUrl } from "./preview";

const rowSelector = "[data-timeline-row-id]";
const hiddenClass = "bb-ia-hidden-history-utility";
const sentFileGroup = "div.mt-2.space-y-2 > div.flex.flex-wrap.gap-1\\.5";
const sentEditorForm = "[data-sent-message-inline-editor-host] form[data-promptbox]";

function imageSuffixes(root: Element, selector: string): Set<string> {
  return new Set(Array.from(root.querySelectorAll<HTMLImageElement>(selector), (image) =>
    annotationSuffix(projectAttachmentUrl(image.src)?.path ?? image.alt),
  ));
}

function hidePills(pills: NodeListOf<Element>, suffixes: ReadonlySet<string>, labelSelector: string): boolean {
  let hidden = 0;
  pills.forEach((pill) => {
    const label = pill.querySelector(labelSelector)?.textContent?.trim() ?? "";
    const filename = label.split(" · ", 1)[0];
    const suffix = filename.match(/-annotations-[0-9a-f]{16}\.md$/)?.[0];
    const matches = suffix !== undefined && suffixes.has(suffix);
    pill.classList.toggle(hiddenClass, matches);
    if (matches) hidden++;
  });
  return hidden > 0 && hidden === pills.length;
}

function syncRow(row: Element) {
  row.querySelectorAll(sentFileGroup).forEach((files) => {
    if (!files.parentElement) return;
    const suffixes = imageSuffixes(files.parentElement, ":scope > div > button.cursor-zoom-in > img");
    const pills = files.querySelectorAll(":scope > :is(button, a, span).inline-flex.rounded-full");
    files.classList.toggle(hiddenClass, hidePills(pills, suffixes, ":scope > span.truncate"));
  });

  // BB doesn't expose a composer handle for sent edits. If the image is removed,
  // show its unmatched notes so the user can remove them in the native editor.
  row.querySelectorAll(sentEditorForm).forEach((form) => {
    const expanded = "[data-promptbox-expanded-only]";
    const suffixes = imageSuffixes(form, `${expanded} button.cursor-zoom-in > img`);
    const pills = form.querySelectorAll(`${expanded} span.inline-flex.rounded-full`);
    hidePills(pills, suffixes, ":scope > :is(button, span).truncate");
  });
}

export function hideHistoryUtilities(): () => void {
  document.querySelectorAll(rowSelector).forEach(syncRow);
  const observer = new MutationObserver((records) => {
    const rows = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const row = target?.closest(rowSelector);
      if (row) {
        rows.add(row);
        continue;
      }
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(rowSelector)) rows.add(node);
        node.querySelectorAll(rowSelector).forEach((child) => rows.add(child));
      });
    }
    rows.forEach(syncRow);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ["src"] });
  return () => {
    observer.disconnect();
    document.querySelectorAll(`.${hiddenClass}`).forEach((item) => item.classList.remove(hiddenClass));
  };
}
