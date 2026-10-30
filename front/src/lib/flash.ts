/** Brings what a link talks about into view and makes it flash, so the eye lands on it */
export function flash(el?: HTMLElement | null): void {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("ring-2", "ring-warn", "animate-pulse");
  setTimeout(() => el.classList.remove("ring-2", "ring-warn", "animate-pulse"), 2600);
}
