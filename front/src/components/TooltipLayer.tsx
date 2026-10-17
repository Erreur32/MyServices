// Info-bulles aux couleurs du thème, pour toute la page : les attributs `title` natifs (gris, lents, sans mise en forme) sont repris au survol
// et au clavier. Le texte passe en `data-tip` pour que le navigateur n'affiche pas aussi la sienne ; un bouton sans texte garde son nom accessible.
import { useEffect, useRef, useState } from "react";

interface Tip { text: string; x: number; y: number; below: boolean }

const DELAY_MS = 250, GAP = 8, MARGIN = 8;

/** Convention: on a multi-line tip the first line is a short heading (bold), the rest is the explanation (muted); a one-line tip stays plain */
function splitTip(text: string): [string, string] {
  const i = text.indexOf("\n");
  return i < 0 ? ["", text] : [text.slice(0, i), text.slice(i + 1)];
}

/** Light markup inside a tip: **text** in bold, `text` as code (settings, commands, file names), ![](url) as a small icon (service logos) */
const rich = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`|!\[\]\([^)]+\))/).map((part, i) => {
  if (part.startsWith("![](")) return <img key={i} src={part.slice(4, -1)} alt="" aria-hidden className="mr-1 inline h-4 w-4 object-contain align-text-bottom" />;  if (part.startsWith("**")) return <b key={i} className="text-txt">{part.slice(2, -2)}</b>;
  if (part.startsWith("`")) return <code key={i} className="rounded bg-bg2 px-1 font-mono text-[11px] font-semibold text-txt">{part.slice(1, -1)}</code>;
  return part;
});

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
  const [head, rest] = splitTip(tip.text);
  return (
    <div ref={box} role="tooltip" className="pointer-events-none fixed z-[100] w-max max-w-[min(36rem,calc(100vw-1rem))] animate-[tip-in_.12s_ease-out] whitespace-pre-line rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs leading-snug text-txt shadow-lg shadow-black/30"
      style={{ left: tip.x + shift, top: tip.below ? tip.y + GAP : tip.y - GAP, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}>
      {head && <b className="block text-txt">{head}</b>}
      {rest && <span className={head ? "mt-0.5 block text-muted" : ""}>{rich(rest)}</span>}
      <span aria-hidden className={`absolute h-2 w-2 rotate-45 border border-line bg-card ${tip.below ? "-top-1 border-b-0 border-r-0" : "-bottom-1 border-l-0 border-t-0"}`} style={{ left: `calc(50% - ${shift}px - 4px)` }} />
    </div>
  );
}
