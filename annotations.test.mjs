import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationFilename, annotationSuffix, readAnnotations, writeAnnotations } from "./annotations.ts";

const path = "capture-1824552000-id.png";

test("numbered point and rectangle comments round-trip with their image coordinates", () => {
  const comments = [
    { kind: "point", point: { x: 0.25, y: 0.5 }, comment: "The header" },
    {
      kind: "rectangle",
      from: { x: 0.2, y: 0.3 },
      to: { x: 0.81, y: 0.9 },
      comment: "Move this →\nKeep <the text> & comment -->",
    },
  ];
  const markdown = writeAnnotations("capture.png", path, comments);
  assert.match(markdown, /1\. Pin at \(25\.00%, 50\.00%\)/);
  assert.match(markdown, /2\. Rectangle from \(20\.00%, 30\.00%\) to \(81\.00%, 90\.00%\)/);
  assert.match(markdown, /> Keep &lt;the text&gt; &amp; comment --&gt;/);
  assert.deepEqual(readAnnotations(markdown, path), comments);
});

test("sidecar names are stable and distinguish different uploads with the same name", () => {
  const name = annotationFilename("capture.png", path);
  assert.match(name, /^capture-annotations-[0-9a-f]{16}\.md$/);
  assert.equal(annotationFilename("capture.png", path), name);
  assert.notEqual(annotationFilename("capture.png", "capture-1824552000-other.png"), name);
  assert.ok(annotationFilename(path, path).endsWith(annotationSuffix(path)));
  assert.ok(name.endsWith(annotationSuffix(path)));
});

test("unrelated and invalid annotation files are rejected", () => {
  const comment = { kind: "point", point: { x: 0.2, y: 0.9 }, comment: "Keep" };
  assert.throws(() => readAnnotations(writeAnnotations("capture.png", path, [comment]), "other.png"));
  assert.throws(() => readAnnotations("# Some other Markdown", path));
  const invalid = { ...comment, point: { x: -1, y: 0.9 } };
  assert.throws(() => readAnnotations(writeAnnotations("capture.png", path, [invalid]), path));
});
