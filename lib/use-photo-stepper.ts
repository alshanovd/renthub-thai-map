"use client";

import { useCallback, useState } from "react";

import { thumbUrl } from "@/lib/images";

export type StepDirection = 1 | -1;

/** `index` moved by `delta`, wrapping around at both ends (0 when there's nothing to show). */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** Index to preload when looking in `dir` from `index`; null when there's no other picture. */
export function preloadIndex(index: number, dir: StepDirection, count: number): number | null {
  return count < 2 ? null : stepIndex(index, dir, count);
}

/**
 * Warms the browser's HTTP cache for `url` with a detached image. No reference is kept, so no
 * decoded bitmap stays in memory or in the DOM; the next `<img>` with this URL loads at once.
 */
export function preloadImage(url: string): void {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

export type PhotoStepper = {
  /** The current picture's index. */
  index: number;
  next: () => void;
  prev: () => void;
  /** Silently preloads the neighbour in `dir` (arrow hover/focus/press): no loader. */
  preload: (dir: StepDirection) => void;
};

/**
 * Index of a single-image photo carousel over `pictures` (CDN paths), wrapping at both ends.
 * Each step also preloads the next picture in the same direction, so repeated clicks stay
 * instant. `urlFor` maps a path to the URL that the carousel shows (thumbnails by default).
 */
export function usePhotoStepper(
  pictures: readonly string[],
  urlFor: (path: string) => string = thumbUrl,
): PhotoStepper {
  const count = pictures.length;
  const [rawIndex, setIndex] = useState(0);
  // The pictures may shrink under a kept index (new data for the same card).
  const index = count > 0 ? rawIndex % count : 0;

  const preloadFrom = useCallback(
    (from: number, dir: StepDirection) => {
      const target = preloadIndex(from, dir, count);
      if (target !== null) preloadImage(urlFor(pictures[target]));
    },
    [count, pictures, urlFor],
  );

  const step = useCallback(
    (dir: StepDirection) => {
      if (count < 2) return;
      const target = stepIndex(index, dir, count);
      setIndex(target);
      preloadFrom(target, dir);
    },
    [count, index, preloadFrom],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  const preload = useCallback(
    (dir: StepDirection) => preloadFrom(index, dir),
    [index, preloadFrom],
  );

  return { index, next, prev, preload };
}
