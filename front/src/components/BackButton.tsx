// The way back of a page opened from a list (a machine, one SSH access): a round button on the left, the list's name in it.
import { ArrowLeft } from "lucide-react";

export function BackButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} className="group inline-flex items-center gap-2 rounded-full border border-link/70 bg-link/10 py-1.5 pl-2.5 pr-4 text-sm font-semibold text-txt shadow-sm transition-colors hover:border-link hover:bg-link/20">
      <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{label}
    </button>
  );
}
