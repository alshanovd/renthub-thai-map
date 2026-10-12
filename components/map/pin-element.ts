import type { PinView } from "@/lib/listings/pin-diff";

/**
 * Plain-DOM price pill used as an `AdvancedMarkerElement`'s content (see `PinLayer`). The looks
 * live in `app/globals.css` under `.pin`; states are data attributes:
 * - `data-favorite` (♥ badge) and `data-muted` (deleted favorite), from the `PinView`;
 * - `data-selected` and `data-hovered` (card hover), toggled by the layer from the store.
 *
 * Structure: `div.pin[data-pin-id] > (div.pin-pill > text, span.pin-heart?) + div.pin-tail`.
 */
export function createPinElement(view: PinView): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin";
  el.dataset.pinId = view.id;
  const pill = document.createElement("div");
  pill.className = "pin-pill";
  pill.append(document.createTextNode(view.label));
  const tail = document.createElement("div");
  tail.className = "pin-tail";
  el.append(pill, tail);
  updatePinElement(el, view);
  return el;
}

/** Applies a (changed) view to an element made by `createPinElement`. */
export function updatePinElement(el: HTMLElement, view: PinView): void {
  const pill = el.firstElementChild as HTMLElement;
  const text = pill.firstChild as Text;
  if (text.data !== view.label) text.data = view.label;
  setFlag(el, "favorite", view.favorite);
  setFlag(el, "muted", view.muted);
  const heart = pill.querySelector(".pin-heart");
  if (view.favorite && !heart) {
    const badge = document.createElement("span");
    badge.className = "pin-heart";
    badge.setAttribute("aria-label", "Favorite");
    badge.textContent = "♥";
    pill.append(badge);
  } else if (!view.favorite && heart) {
    heart.remove();
  }
}

/** Sets or removes a boolean `data-*` attribute. */
export function setFlag(
  el: HTMLElement,
  name: "favorite" | "muted" | "selected" | "hovered",
  on: boolean,
): void {
  if (on) el.dataset[name] = "";
  else delete el.dataset[name];
}
