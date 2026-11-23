import { annotationSuffix } from "./annotations";
import { projectAttachmentUrl } from "./preview";

const rowSelector = "[data-timeline-row-id]";
const hiddenClass = "bb-ia-hidden-history-utility";
const sentFileGroup = "div.mt-2.space-y-2 > div.flex.flex-wrap.gap-1\\.5";

function imageSuffixes(root: Element, selector: string): Set<string> {
  return new Set(Array.from(root.querySelectorAll<HTMLImageElement>(selector), (image) =>
    annotationSuffix(projectAttachmentUrl(image.src)?.path ?? image.alt),
  ));
}

function hidePills(pills: readonly Element[], suffixes: ReadonlySet<string>, labelSelector: string) {
  for (const pill of pills) {
    const label = pill.querySelector(labelSelector)?.textContent?.trim() ?? "";
    const filename = label.split(" · ", 1)[0];
    const suffix = filename.match(/-annotations-[0-9a-f]{16}\.md$/)?.[0];
    pill.classList.toggle(hiddenClass, suffix !== undefined && suffixes.has(suffix));
  }
}

function syncRow(row: Element) {
  for (const files of Array.from(row.querySelectorAll(sentFileGroup))) {
    if (!files.parentElement) continue;
    const suffixes = imageSuffixes(files.parentElement, ":scope > div > button.cursor-zoom-in > img");
    const pills = Array.from(files.querySelectorAll(":scope > :is(button, a, span).inline-flex.rounded-full"));
    hidePills(pills, suffixes, ":scope > span.truncate");
    files.classList.toggle(hiddenClass, pills.length > 0 && pills.every((pill) => pill.classList.contains(hiddenClass)));
  }

  // BB's sent-message editor disables composer plugin customizations.
  for (const form of Array.from(row.querySelectorAll("form[data-promptbox]"))) {
    const expanded = "[data-promptbox-expanded-only]";
    const suffixes = imageSuffixes(form, `${expanded} button.cursor-zoom-in > img`);
    const pills = Array.from(form.querySelectorAll(`${expanded} span.inline-flex.rounded-full`));
    hidePills(pills, suffixes, ":scope > :is(button, span).truncate");
  }
}

export function hideHistoryUtilities(): () => void {
  document.querySelectorAll(rowSelector).forEach(syncRow);
  const observer = new MutationObserver((records) => {
    const rows = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const row = target?.closest(rowSelector);
      if (row) rows.add(row);
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches(rowSelector)) rows.add(node);
        node.querySelectorAll(rowSelector).forEach((child) => rows.add(child));
      }
    }
    rows.forEach(syncRow);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ["src"] });
  return () => {
    observer.disconnect();
    document.querySelectorAll(`.${hiddenClass}`).forEach((item) => item.classList.remove(hiddenClass));
  };
}
