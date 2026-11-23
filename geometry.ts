export type Point = { x: number; y: number };

type Rectangle = { kind: "rectangle"; from: Point; to: Point };
export type Shape = { kind: "point"; point: Point } | Rectangle;
export type Annotation = Shape & { comment: string };

const DRAG_THRESHOLD = 5;

export function rectangle(from: Point, to: Point): Rectangle {
  return {
    kind: "rectangle",
    from: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
    to: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) },
  };
}

export function markFromGesture(from: Point, to: Point, maxDisplacement: number): Shape | null {
  if (maxDisplacement < DRAG_THRESHOLD) return { kind: "point", point: from };
  if (from.x === to.x || from.y === to.y) return null;
  return rectangle(from, to);
}
