import assert from "node:assert/strict";
import { test } from "node:test";
import { markFromGesture } from "./geometry.ts";

const start = { x: 0.2, y: 0.2 };

test("a click with slight movement pins the starting point", () => {
  assert.deepEqual(markFromGesture(start, { x: 0.21, y: 0.21 }, Math.hypot(2, 2)), {
    kind: "point",
    point: start,
  });
});

test("a long thin drag marks its rectangle in either direction", () => {
  const end = { x: 0.7, y: 0.21 };
  const distance = Math.hypot(100, 4);
  const expected = { kind: "rectangle", from: start, to: end };

  assert.deepEqual(markFromGesture(start, end, distance), expected);
  assert.deepEqual(markFromGesture(end, start, distance), expected);
});

test("a drag that encloses no area does not create a pin", () => {
  assert.equal(markFromGesture(start, { x: 0.7, y: 0.2 }, 100), null);
  assert.equal(markFromGesture(start, { x: 0.2, y: 0.7 }, 100), null);
  assert.equal(markFromGesture(start, start, 100), null);
});
