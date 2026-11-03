// A short text with **bold**, and the markup of lib/richText: a machine badge, a duration in grey, a line break between causes
import { Server } from "lucide-react";

const PART = /(\*\*.+?\*\*|\[\[(?:m|since):[^\]]+\]\]|\n)/;
const TAG = "mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line bg-bg2 px-1.5 align-[1px] text-[13px] font-bold text-txt";

function MachineBadge({ name, href }: Readonly<{ name: string; href?: string }>) {
  const inner = <><Server size={12} className="text-dim" aria-hidden />{name}</>;
  return href ? <a href={`#${href}`} className={`${TAG} no-underline hover:border-link hover:text-link`}>{inner}</a> : <span className={TAG}>{inner}</span>;
}

export function Rich({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {text.split(PART).map((part, i) => {   // the parts of one fixed text: their place is their identity
        if (part === "\n") return <br key={i} />;
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <b key={i} className="font-semibold text-txt">{part.slice(2, -2)}</b>;
        const tag = /^\[\[(m|since):([^\]]+)\]\]$/.exec(part);
        if (tag?.[1] === "since") return <span key={i} className="whitespace-nowrap text-[13px] font-normal text-dim"> · {tag[2]}</span>;
        if (tag) { const [name, href] = tag[2].split("|"); return <MachineBadge key={i} name={name} href={href} />; }
        return part;
      })}
    </>
  );
}
