export const CDN_BASE = "https://bcdn.renthub.in.th";
export const RENTHUB_BASE = "https://www.renthub.in.th";

/** ~8 KB thumbnail for a CDN path such as `/listing_picture/…jpg`. */
export function thumbUrl(path: string): string {
  return `${CDN_BASE}${path}?class=thumbnail`;
}

/** Full-size image for a CDN path. */
export function fullUrl(path: string): string {
  return `${CDN_BASE}${path}`;
}

/** Public renthub page of a listing. */
export function listingUrl(slug: string): string {
  return `${RENTHUB_BASE}/en/${encodeURIComponent(slug)}`;
}
