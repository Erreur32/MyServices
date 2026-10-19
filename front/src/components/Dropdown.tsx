// Header dropdowns (account menu, bell): one behaviour and one look. Closes on a click elsewhere, Escape and a page change.
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

const DROP_BASE = "absolute z-30 mt-2 overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/30";
/** Panel under its button, aligned on the right: same frame, shadow and layer for every header dropdown */
export const DROP_PANEL = `${DROP_BASE} right-0`;
/** Same panel, aligned on the left of its button (a button near the left edge, like the tab bar's Inventory menu) */
export const DROP_PANEL_LEFT = `${DROP_BASE} left-0`;
/** One line of a menu (button or link) */
export const DROP_ITEM = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-bg2 hover:text-txt focus-visible:bg-bg2 focus-visible:text-txt focus-visible:outline-none";

export function useDropdown(): { open: boolean; setOpen: (v: boolean) => void; box: RefObject<HTMLDivElement | null> } {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const moved = () => setOpen(false);   // a line led to another page
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    addEventListener("hashchange", moved);
    return () => { removeEventListener("mousedown", away); removeEventListener("keydown", esc); removeEventListener("hashchange", moved); };
  }, [open]);
  return { open, setOpen, box };
}

export function DropSep() {
  return <hr className="my-1 border-0 border-t border-line/70" />;
}

export function DropItem({ icon, children, onClick, href, danger, title }: Readonly<{
  icon: ReactNode; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; title?: string;
}>) {
  const cls = `${DROP_ITEM} ${danger ? "hover:!text-bad" : ""}`;
  return href
    ? <a role="menuitem" className={cls} href={href} target="_blank" rel="noopener noreferrer" title={title}>{icon}{children}</a>
    : <button type="button" role="menuitem" className={cls} onClick={onClick} title={title}>{icon}{children}</button>;
}
