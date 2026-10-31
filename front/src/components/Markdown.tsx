// Markdown minimal et sûr (aucun HTML injecté) pour le journal des changements : titres ###, listes, > citations, **gras**, `code`, [texte](https://…).
import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith("**")) return <b key={i} className="font-semibold text-txt">{part.slice(2, -2)}</b>;
    if (part.startsWith("`")) return <code key={i} className="rounded bg-bg2 px-1 py-0.5 font-mono text-[11px] text-ok">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    return link ? <a key={i} className="text-link hover:underline" href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : part;
  });
}

export function Markdown({ text }: Readonly<{ text: string }>) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`u${blocks.length}`} className="my-1.5 list-disc space-y-1 pl-5">{list}</ul>); list = []; } };
  for (const [n, line] of text.split("\n").entries()) {
    const t = line.trimEnd();
    if (/^\s*[-*]\s+/.test(t)) { list.push(<li key={n} className="text-sm leading-relaxed text-muted">{inline(t.replace(/^\s*[-*]\s+/, ""))}</li>); continue; }
    if (/^\s{2,}\S/.test(t) && list.length) { list.push(<span key={n} className="block text-sm text-muted">{inline(t.trim())}</span>); continue; }  // suite d'un point de liste
    flush();
    if (/^###\s+/.test(t)) blocks.push(<h4 key={n} className="mt-3 border-b border-link/25 pb-0.5 text-sm font-semibold text-link">{inline(t.replace(/^###\s+/, ""))}</h4>);
    else if (/^>\s?/.test(t)) blocks.push(<p key={n} className="my-1.5 rounded-lg border-l-2 border-warn bg-warn/10 px-3 py-1.5 text-xs text-muted">{inline(t.replace(/^>\s?/, ""))}</p>);
    else if (t.trim()) blocks.push(<p key={n} className="my-1 text-sm text-muted">{inline(t)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
