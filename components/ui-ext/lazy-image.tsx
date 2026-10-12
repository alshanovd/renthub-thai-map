"use client";

import { ImageOff } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useState } from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./spinner";

type Status = "loading" | "loaded" | "error";

export type LazyImageProps = {
  src: string;
  alt: string;
  /** Classes of the wrapper (size/position it: it is `relative overflow-hidden`). */
  className?: string;
  /** Wrapper inline style (e.g. a carousel slot's `transform`). */
  style?: CSSProperties;
  /** Classes of the `<img>` itself (it fills the wrapper; default `object-cover`). */
  imgClassName?: string;
  /** Shown under the spinner while loading. Default: a neutral `bg-muted` fill. */
  placeholder?: ReactNode;
  loading?: "lazy" | "eager";
  width?: number;
  height?: number;
  /** Hides the whole image (and its loader) from assistive tech, e.g. an off-screen neighbour. */
  "aria-hidden"?: boolean;
};

/**
 * An `<img>` with a loader: a placeholder plus a small spinner until `load`, then the image fades
 * in; on `error`, a "Photo unavailable" state. The state resets whenever `src` changes, so a
 * carousel step shows the loader until the next photo arrives (an already cached image shows
 * at once). Plain `<img>` (hotlinked CDN), never `next/image`.
 */
export function LazyImage({
  src,
  alt,
  className,
  style,
  imgClassName,
  placeholder,
  loading = "lazy",
  width,
  height,
  "aria-hidden": ariaHidden,
}: LazyImageProps) {
  const [state, setState] = useState<{ src: string; status: Status }>({ src, status: "loading" });
  // Reset during render (not in an effect) so the old status never shows for the new src.
  const status = state.src === src ? state.status : "loading";
  if (state.src !== src) setState({ src, status: "loading" });

  const markIfComplete = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth > 0) setState({ src, status: "loaded" });
    },
    [src],
  );

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={style}
      aria-hidden={ariaHidden}
      aria-busy={status === "loading" || undefined}
    >
      {status === "loaded" ? null : (
        <>
          {placeholder ?? <div className="absolute inset-0 bg-muted" />}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            {status === "loading" ? (
              <Spinner className="size-5 text-neutral-500 drop-shadow-sm" />
            ) : (
              <>
                <ImageOff className="size-5" aria-hidden />
                <span>Photo unavailable</span>
              </>
            )}
          </div>
        </>
      )}
      {status === "error" ? null : (
        <img
          key={src}
          ref={markIfComplete}
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={false}
          width={width}
          height={height}
          onLoad={() => setState({ src, status: "loaded" })}
          onError={() => setState({ src, status: "error" })}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            status === "loaded" ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      )}
    </div>
  );
}
