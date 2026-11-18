/**
 * The box type on its own, so client code can use it without pulling in the
 * server-side geometry (lib/visual/region uses sharp).
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
