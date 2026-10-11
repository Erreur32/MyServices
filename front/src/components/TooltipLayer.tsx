// Info-bulles aux couleurs du thème, pour toute la page : les attributs `title` natifs (gris, lents, sans mise en forme) sont repris au survol
// et au clavier. Le texte passe en `data-tip` pour que le navigateur n'affiche pas aussi la sienne ; un bouton sans texte garde son nom accessible.
import { useEffect, useRef, useState } from "react";

interface Tip { text: string; x: number; y: number; below: boolean }

const DELAY_MS = 250, GAP = 8, MARGIN = 8;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const target = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); target.current = null; setTip(null); };
    const take = (el: Element) => {  // `title` -> `data-tip`
      const t = el.getAttribute("title");
      if (t) {
        el.setAttribute("data-tip", t);
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t.split("\n")[0]);
      }
    };
    const show = (e: Event) => {
      const t = e.target instanceof Element ? e.target.closest("[title], [data-tip]") : null;
      if (!t || t === target.current) return;
      take(t);
      const text = t.getAttribute("data-tip");
      if (!text) return;
      hide();
      target.current = t;
      timer.current = setTimeout(() => {
        const r = t.getBoundingClientRect();
        const below = r.top < 80;  // pas de place au-dessus : sous l'élément
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
      }, DELAY_MS);
    };
    const out = (e: Event) => { if (target.current && (!(e instanceof MouseEvent) || !target.current.contains(e.relatedTarget as Node | null))) hide(); };
    const opts = { capture: true } as const;
    addEventListener("mouseover", show, opts);
    addEventListener("focusin", show, opts);
    addEventListener("mouseout", out, opts);
    addEventListener("focusout", hide, opts);
    addEventListener("mousedown", hide, opts);
    addEventListener("scroll", hide, opts);
    addEventListener("keydown", hide, opts);
    return () => {
      clearTimeout(timer.current);
      removeEventListener("mouseover", show, opts); removeEventListener("focusin", show, opts); removeEventListener("mouseout", out, opts);
      removeEventListener("focusout", hide, opts); removeEventListener("mousedown", hide, opts); removeEventListener("scroll", hide, opts); removeEventListener("keydown", hide, opts);
    };
  }, []);

  // Une fois affichée, la bulle est recentrée dans la fenêtre sans jamais déborder
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!tip || !box.current) { setShift(0); return; }
    const w = box.current.offsetWidth, left = tip.x - w / 2;
    setShift(Math.min(0, innerWidth - MARGIN - (left + w)) + Math.max(0, MARGIN - left));
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} role="tooltip" className="pointer-events-none fixed z-[100] max-w-xs animate-[tip-in_.12s_ease-out] whitespace-pre-line rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs leading-snug text-txt shadow-lg shadow-black/30"
      style={{ left: tip.x + shift, top: tip.below ? tip.y + GAP : tip.y - GAP, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}>
      {tip.text}
      <span aria-hidden className={`absolute h-2 w-2 rotate-45 border border-line bg-card ${tip.below ? "-top-1 border-b-0 border-r-0" : "-bottom-1 border-l-0 border-t-0"}`} style={{ left: `calc(50% - ${shift}px - 4px)` }} />
    </div>
  );
}
