// A page apart from the tabs (Profile, Help, About): no tab bar, just a "Back" link above its content.
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { tx } from "../lib/i18n";

export function SidePage({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <a href="#home" className="group mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted transition-colors hover:border-link hover:text-txt">
        <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{tx("Retour")}
      </a>
      {children}
    </>
  );
}
