// A short confirmation in the middle of the header, for what a page does in the background: nothing moves in the page.
import type { Note } from "./forms";

const EVENT = "ms-header-note";
export const sayInHeader = (text: string): void => { dispatchEvent(new CustomEvent<string>(EVENT, { detail: text })); };
export const onHeaderNote = (fn: (text: string) => void): (() => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  addEventListener(EVENT, h);
  return () => removeEventListener(EVENT, h);
};

/** A success goes to the header, an error stays in the page next to what failed */
export const toHeader = (setNote: (n: Note) => void) => (n: Note): void => { if (n?.ok) sayInHeader(n.text); else setNote(n); };
