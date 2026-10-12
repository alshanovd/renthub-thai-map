"use client";

import { APIProvider, Map as GoogleMap, type MapEvent } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { PriceMode } from "@/lib/listings/types";
import { useMapUi } from "@/lib/store";

import { ClusteredPins } from "./clusterer";
import { PinPreview } from "./pin-preview";
import type { PinListing } from "./price-pin";
import { SelectionPan } from "./selection-pan";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

/** Chiang Mai Old City. */
const DEFAULT_CENTER = { lat: 18.7883, lng: 98.9853 };
const DEFAULT_ZOOM = 13;
const BOUNDS_DEBOUNCE_MS = 150;

type ListingsMapProps = {
  /** Listings to draw (all have coordinates). */
  pins: readonly PinListing[];
  mode: PriceMode;
  favoriteIds: ReadonlySet<string>;
};

/**
 * Uncontrolled Google Map (only `defaultCenter`/`defaultZoom`, never `center`/`zoom`), so the
 * app never fights the user's camera. Reports the visible bounds to the store on `idle`.
 */
export function ListingsMap({ pins, mode, favoriteIds }: ListingsMapProps) {
  const setBounds = useMapUi((s) => s.setBounds);
  const selectedId = useMapUi((s) => s.selectedId);
  const select = useMapUi((s) => s.select);
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(boundsTimer.current), []);

  const onIdle = useCallback(
    (event: MapEvent) => {
      clearTimeout(boundsTimer.current);
      boundsTimer.current = setTimeout(() => {
        const bounds = event.map.getBounds();
        if (bounds) setBounds(bounds.toJSON());
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
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        onIdle={onIdle}
        onClick={onMapClick}
      >
        <ClusteredPins pins={pins} mode={mode} favoriteIds={favoriteIds} selectedId={selectedId} />
        <PinPreview pinsById={pinsById} mode={mode} />
        <SelectionPan pinsById={pinsById} />
      </GoogleMap>
    </APIProvider>
  );
}
