import type { Bounds } from "@/lib/store";

/** Web Mercator world width in pixels at zoom 0. */
const TILE_SIZE = 256;

/**
 * The usable part of a bottom inset (the mobile list sheet): never more than leaves `minVisible`
 * pixels of map above it. When the sheet covers almost the whole map, camera moves ignore it.
 */
export function usableInset(inset: number, mapHeight: number, minVisible: number): number {
  if (inset <= 0 || mapHeight <= 0) return 0;
  const usable = Math.min(inset, mapHeight - minVisible);
  return usable > 0 ? usable : 0;
}

/** Degrees of latitude spanned by `px` screen pixels around `lat` at `zoom` (Mercator). */
export function latDegreesForPixels(px: number, zoom: number, lat: number): number {
  const degreesPerPx = 360 / (TILE_SIZE * 2 ** zoom);
  return px * degreesPerPx * Math.cos((lat * Math.PI) / 180);
}

/**
 * Whether a point is in the part of the map above a bottom inset. Linear in latitude, which is
 * accurate enough at city zoom levels.
 */
export function inVisibleArea(
  bounds: Bounds,
  point: { lat: number; lng: number },
  inset: number,
  mapHeight: number,
): boolean {
  const { north, south, east, west } = bounds;
  const lngInside =
    west <= east ? point.lng >= west && point.lng <= east : point.lng >= west || point.lng <= east;
  if (!lngInside || point.lat > north || point.lat < south) return false;
  if (inset <= 0 || mapHeight <= 0) return true;
  const visibleSouth = south + (north - south) * (inset / mapHeight);
  return point.lat >= visibleSouth;
}

/**
 * The map center that shows `target` in the middle of the area above a bottom inset: the center
 * moves south by half the inset.
 */
export function centerAboveInset(
  target: { lat: number; lng: number },
  inset: number,
  zoom: number,
): { lat: number; lng: number } {
  if (inset <= 0) return target;
  return { lat: target.lat - latDegreesForPixels(inset / 2, zoom, target.lat), lng: target.lng };
}
