import type { Annotation, Point } from "./editor";

const marker = "<!-- bb-image-annotations:v1 ";

export function annotationFilename(imageName: string, imagePath: string): string {
  const stem = imageName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(imagePath)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `${stem || "image"}-annotations-${hash.toString(16).padStart(16, "0")}.md`;
}

function markdownText(text: string): string {
  return text.replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    return character === "<" ? "&lt;" : "&gt;";
  });
}

function coordinates({ x, y }: Point): string {
  return `(${(x * 100).toFixed(2)}%, ${(y * 100).toFixed(2)}%)`;
}

export function writeAnnotations(
  imageName: string,
  imagePath: string,
  annotations: readonly Annotation[],
): string {
  const metadata = JSON.stringify({ imagePath, annotations })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  const sections = annotations.map((annotation, index) => {
    const location = annotation.kind === "point"
      ? `Pin at ${coordinates(annotation.point)}`
      : `Rectangle from ${coordinates(annotation.from)} to ${coordinates(annotation.to)}`;
    const comment = annotation.comment.split(/\r?\n/).map((line) => `> ${markdownText(line)}`).join("\n");
    return `## ${index + 1}. ${location}\n\n${comment}`;
  });
  return [
    `${marker}${metadata} -->`,
    "# Image annotations",
    `Image: ${markdownText(imageName.replace(/[\r\n]/g, " "))}\n\nAttachment path: ${markdownText(imagePath)}`,
    "Coordinates are percentages of the original image, measured from the top-left corner as (x, y).",
    ...sections,
    "",
  ].join("\n\n");
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value)) return false;
  const { x, y } = value;
  return typeof x === "number" && x >= 0 && x <= 1 && typeof y === "number" && y >= 0 && y <= 1;
}

function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null || !("comment" in value) || !("kind" in value)) return false;
  if (typeof value.comment !== "string" || !value.comment.trim() || value.comment.length > 4_000) return false;
  if (value.kind === "point") return "point" in value && isPoint(value.point);
  return value.kind === "rectangle" && "from" in value && isPoint(value.from) && "to" in value &&
    isPoint(value.to) && value.from.x <= value.to.x && value.from.y <= value.to.y;
}

export function readAnnotations(markdown: string, imagePath: string): Annotation[] {
  const end = markdown.indexOf(" -->\n");
  if (!markdown.startsWith(marker) || end < 0) throw new Error("Invalid annotation file");
  const metadata: unknown = JSON.parse(markdown.slice(marker.length, end));
  if (typeof metadata !== "object" || metadata === null || !("imagePath" in metadata) ||
    metadata.imagePath !== imagePath || !("annotations" in metadata) || !Array.isArray(metadata.annotations) ||
    metadata.annotations.length > 100 || !metadata.annotations.every(isAnnotation)) {
    throw new Error("Annotation file does not match this image");
  }
  return metadata.annotations;
}
