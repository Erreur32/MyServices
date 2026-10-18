// A click on the header of a foldable card opens or closes it, unless it lands on something clickable in that header (a link, a button, a field, a
// label…): that element does its own job and the card stays as it is. The chevron / title button of the card is one of those buttons: it toggles
// by itself and is the way in for the keyboard and screen readers.
import type { MouseEvent } from "react";

/** What keeps its own click inside a header */
export const INTERACTIVE = "a[href],button,input,select,textarea,label,summary,[role=button],[role=checkbox],[role=switch],[data-no-fold]";

/** True when the click of `e` (handled on the header `e.currentTarget`) is for the header itself and not for something clickable inside it */
export function isHeaderClick(e: Pick<MouseEvent, "target" | "currentTarget">): boolean {
  const target = e.target as Element | null;
  const hit = target?.closest?.(INTERACTIVE);
  return !hit || hit === e.currentTarget || !(e.currentTarget as Element).contains(hit);
}

/** The click handler of a card header: toggles for a click on the header itself */
export const headerToggle = (toggle: () => void) => (e: MouseEvent) => { if (isHeaderClick(e)) toggle(); };

/** Tailwind classes that tell the pointer the header is clickable (written out for Tailwind) */
export const FOLD_HEADER = "cursor-pointer select-none";
