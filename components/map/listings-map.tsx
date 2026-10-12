"use client";

import {
  APIProvider,
  ControlPosition,
  Map as GoogleMap,
  type MapEvent,
  RenderingType,
} from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Pin, PriceMode } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";

import { FavoritesFit } from "./favorites-fit";
import { PinLayer } from "./pin-layer";
import { PinPreview } from "./pin-preview";
import { SelectionPan } from "./selection-pan";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
/**
 * Map tiles: raster unless `NEXT_PUBLIC_MAP_RENDERING=vector`. Measured in plan 16: vector costs
 * ~85 MB more browser RSS and ~11 MB more JS heap for the same scenario.
 */
const RENDERING =
  process.env.NEXT_PUBLIC_MAP_RENDERING === "vector" ? RenderingType.VECTOR : RenderingType.RASTER;

/** Chiang Mai Old City. */
const DEFAULT_CENTER = { lat: 18.7883, lng: 98.9853 };
const DEFAULT_ZOOM = 13;
const BOUNDS_DEBOUNCE_MS = 150;

type ListingsMapProps = {
  /** Pins to draw. On the Favorites tab: the favorite pins (built from their cards). */
  pins: readonly Pin[];
  /** False while the Favorites tab's card data is still loading (delays the favorites fit). */
  fitReady: boolean;
  mode: PriceMode;
  favoriteIds: ReadonlySet<string>;
  /** Mobile layout: the list sheet covers the bottom, so the zoom control moves to the top. */
  compact?: boolean;
};

const ZOOM_TOP = { position: ControlPosition.RIGHT_TOP };

/**
 * Uncontrolled Google Map (only `defaultCenter`/`defaultZoom`, never `center`/`zoom`), so the
 * app never fights the user's camera. Reports the visible bounds and zoom to the store on `idle`
 * (they drive the pins request).
 */
export function ListingsMap({
  pins,
  fitReady,
  mode,
  favoriteIds,
  compact = false,
}: ListingsMapProps) {
  const setBounds = useMapUi((s) => s.setBounds);
  const select = useMapUi((s) => s.select);
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(boundsTimer.current), []);

  const onIdle = useCallback(
    (event: MapEvent) => {
      clearTimeout(boundsTimer.current);
      boundsTimer.current = setTimeout(() => {
        const bounds = event.map.getBounds();
        if (bounds) setBounds(bounds.toJSON(), event.map.getZoom() ?? null);
      }, BOUNDS_DEBOUNCE_MS);
    },
    [setBounds],
  );

  /** A click on the empty map (not on a pin, cluster or popover) clears the selection. */
  const onMapClick = useCallback(() => select(null, null), [select]);

  const pinsById = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins]);

  if (!API_KEY) {
    return (
      <div className="flex size-full items-center justify-center bg-muted p-6 text-sm text-muted-foreground">
        Map unavailable: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set.
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} language="en" region="TH">
      <GoogleMap
        className="size-full"
        mapId={MAP_ID}
        renderingType={RENDERING}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        zoomControlOptions={compact ? ZOOM_TOP : undefined}
        clickableIcons={false}
        onIdle={onIdle}
        onClick={onMapClick}
      >
        <PinLayer pins={pins} mode={mode} favoriteIds={favoriteIds} />
        <PinPreview pinsById={pinsById} mode={mode} />
        <SelectionPan pinsById={pinsById} />
        <FavoritesFit pins={pins} ready={fitReady} />
      </GoogleMap>
    </APIProvider>
  );
}
