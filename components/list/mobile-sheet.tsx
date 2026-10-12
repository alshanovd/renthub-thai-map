"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { Drawer, DrawerPortal, DrawerTitle } from "@/components/ui/drawer";
import { useMapUi } from "@/lib/store";

const PEEK_PX = 120;
const PEEK = `${String(PEEK_PX)}px`;
const HALF = 0.5;
const FULL = 1;
const SNAP_POINTS: (string | number)[] = [PEEK, HALF, FULL];

type Snap = string | number | null;

/** Visible sheet height (CSS) per snap point; the list area shrinks to exactly what's on screen. */
function visibleHeight(snap: Snap): string {
  if (snap === FULL) return "100%";
  if (snap === HALF) return "50%";
  return PEEK;
}

/** Map pixels covered by the sheet, for camera moves (`mapInsetBottom`). */
function coveredPx(snap: Snap, containerHeight: number): number {
  if (snap === FULL) return containerHeight;
  if (snap === HALF) return Math.round(containerHeight * HALF);
  return PEEK_PX;
}

type MobileSheetProps = {
  /** The area below the top bar (over the map); the sheet is portaled into it and sized by it. */
  container: HTMLElement;
  /** Shown under the handle, above the list (counts). */
  header: ReactNode;
  children: ReactNode;
};

/**
 * Mobile list: a non-modal, always-open bottom sheet (vaul) over the full-screen map with three
 * snap points: peek (120px: counts and tabs), half and full. The list area is sized to the visible
 * part, so `scrollIntoView` lands on screen. A pin click opens it from peek to half.
 */
export function MobileSheet({ container, header, children }: MobileSheetProps) {
  const [snap, setSnap] = useState<Snap>(PEEK);
  const [containerHeight, setContainerHeight] = useState(() => container.clientHeight);
  const setMapInsetBottom = useMapUi((s) => s.setMapInsetBottom);

  useEffect(() => {
    const observer = new ResizeObserver(() => setContainerHeight(container.clientHeight));
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  // Subscribed synchronously, so the snap change renders together with the selection and the
  // list scrolls to the card inside the already-resized (half) list area.
  useEffect(
    () =>
      useMapUi.subscribe((state, previous) => {
        if (state.selectSource !== "pin" || state.selectedId === null) return;
        if (state.selectedId === previous.selectedId && previous.selectSource === "pin") return;
        setSnap((current) => (current === FULL || current === HALF ? current : HALF));
      }),
    [],
  );

  useEffect(() => {
    setMapInsetBottom(coveredPx(snap, containerHeight));
  }, [snap, containerHeight, setMapInsetBottom]);
  useEffect(() => () => setMapInsetBottom(0), [setMapInsetBottom]);

  return (
    <Drawer
      open
      modal={false}
      dismissible={false}
      noBodyStyles
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      container={container}
    >
      <DrawerPortal>
        <DrawerPrimitive.Content
          aria-describedby={undefined}
          data-mobile-sheet
          className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-full flex-col rounded-t-2xl border-t bg-background shadow-[0_-4px_20px_rgb(0_0_0/0.15)] outline-none"
        >
          <div className="flex min-h-0 flex-col" style={{ height: visibleHeight(snap) }}>
            <div
              aria-hidden
              className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-neutral-300"
            />
            <DrawerTitle className="sr-only">Listings</DrawerTitle>
            {header}
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPortal>
    </Drawer>
  );
}
