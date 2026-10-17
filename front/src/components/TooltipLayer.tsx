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

/** Light markup inside a tip: **text** in bold, `text` as code (settings, commands, file names), ![](url) as a small icon (service logos), [[ok:text]] in a state colour (ok, warn, bad, info, off) */
const TONE_TEXT: Record<string, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-link", off: "text-dim" };
const rich = (text: string) => {
  const seen = new Map<string, number>();   // stable keys from the content (a repeated part gets a counter), not from the position
  const keyOf = (part: string) => { const n = seen.get(part) ?? 0; seen.set(part, n + 1); return `${part}#${n}`; };
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|!\[\]\([^)]+\)|\[\[\w+:[^\]]+\]\])/).map((part) => {
    const key = keyOf(part), tone = /^\[\[(\w+):([^\]]+)\]\]$/.exec(part);
    if (tone) return <b key={key} className={TONE_TEXT[tone[1]] ?? ""}>{tone[2]}</b>;
    if (part.startsWith("![](")) return <img key={key} src={part.slice(4, -1)} alt="" aria-hidden className="mr-1 inline h-4 w-4 object-contain align-text-bottom" />;
    if (part.startsWith("**")) return <b key={key} className="text-txt">{part.slice(2, -2)}</b>;
    if (part.startsWith("`")) return <code key={key} className="rounded bg-bg2 px-1 font-mono text-[11px] font-semibold text-txt">{part.slice(1, -1)}</code>;
    return part;
  });
};

/** Lines with tab characters are table rows: their cells line up in columns from one line to the next (logo, mark, name, explanation) */
function body(text: string): React.ReactNode {
  const out: React.ReactNode[] = [], rows: string[][] = [];
  const flush = () => {
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    out.push(<span key={`t${out.length}`} className="mt-1 grid items-baseline gap-x-2.5 gap-y-1" style={{ gridTemplateColumns: `repeat(${cols - 1}, auto) minmax(0, 1fr)` }}>
      {rows.flatMap((r, i) => Array.from({ length: cols }, (_, c) => <span key={`${i}-${c}`} className={i > 0 ? "border-t border-line/40 pt-1" : ""}>{rich(r[c] ?? "")}</span>))}
    </span>);
    rows.length = 0;
  };
  for (const line of text.split("\n")) {
    if (line.includes("\t")) { rows.push(line.split("\t")); continue; }
    flush();
    out.push(<span key={`l${out.length}`} className={line ? "block" : "block h-2"}>{rich(line)}</span>);
  }
  flush();
  return out;
}

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
    <div ref={box} role="tooltip" className="pointer-events-none fixed z-[100] w-max max-w-[min(36rem,calc(100vw-1rem))] animate-[tip-in_.12s_ease-out] whitespace-pre-line overflow-hidden rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs leading-snug text-txt shadow-lg shadow-black/30"
      style={{ left: tip.x + shift, top: tip.below ? tip.y + GAP : tip.y - GAP, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}>
      {head && <b className={`block text-txt ${rest ? "-mx-2.5 -mt-1.5 mb-1.5 border-b border-line/60 bg-bg px-2.5 py-1.5" : ""}`}>{head}</b>}   {/* heading = the darkest tone of the theme, like the card header strips */}
      {rest && <span className={head ? "block text-muted" : ""}>{body(rest)}</span>}
      <span aria-hidden className={`absolute h-2 w-2 rotate-45 border border-line ${tip.below && head && rest ? "bg-bg" : "bg-card"} ${tip.below ? "-top-1 border-b-0 border-r-0" : "-bottom-1 border-l-0 border-t-0"}`} style={{ left: `calc(50% - ${shift}px - 4px)` }} />
    </div>
  );
}
