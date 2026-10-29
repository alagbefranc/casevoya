/**
 * DOC-07: rectangles on the page as a person sees it (top-left, 0 to 1) mapped into PDF user
 * space (bottom-left). Rotation is the page's /Rotate, clockwise, the same way a viewer turns it.
 */

export type NormRect = { x: number; y: number; width: number; height: number };
export type UserRect = { x: number; y: number; width: number; height: number };
export type PageBox = { x: number; y: number; width: number; height: number };

export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function apply(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

/** `apply(multiply(a, b), p)` is `apply(a, apply(b, p))`. */
export function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function invert(matrix: Matrix): Matrix | null {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-12) return null;
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ];
}

function quarter(rotation: number): 0 | 90 | 180 | 270 {
  const turns = ((Math.round(rotation) % 360) + 360) % 360;
  if (turns === 90 || turns === 180 || turns === 270) return turns;
  return 0;
}

/** One displayed point (top-left origin, pixels of the upright page) into user space. */
function displayedPoint(dx: number, dy: number, box: PageBox, rotation: 0 | 90 | 180 | 270): [number, number] {
  switch (rotation) {
    case 0:
      return [box.x + dx, box.y + box.height - dy];
    case 90:
      return [box.x + dy, box.y + dx];
    case 180:
      return [box.x + box.width - dx, box.y + dy];
    case 270:
      return [box.x + box.width - dy, box.y + box.height - dx];
    default: {
      const never: never = rotation;
      throw new Error(`Unexpected rotation ${String(never)}`);
    }
  }
}

export function displayedSize(box: PageBox, rotation: number): { width: number; height: number } {
  const turn = quarter(rotation);
  if (turn === 90 || turn === 270) return { width: box.height, height: box.width };
  return { width: box.width, height: box.height };
}

/** A drag-box on the upright page, as PDF user-space bounds. */
export function displayedRectToUser(rect: NormRect, box: PageBox, rotation: number): UserRect {
  const turn = quarter(rotation);
  const size = displayedSize(box, turn);
  const left = rect.x * size.width;
  const top = rect.y * size.height;
  const right = (rect.x + rect.width) * size.width;
  const bottom = (rect.y + rect.height) * size.height;
  const corners = [displayedPoint(left, top, box, turn), displayedPoint(right, top, box, turn), displayedPoint(left, bottom, box, turn), displayedPoint(right, bottom, box, turn)];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function intersects(left: UserRect, right: UserRect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function contains(rect: UserRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function boundsOf(points: readonly (readonly [number, number])[]): UserRect {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
