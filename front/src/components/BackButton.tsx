// The way back of a page opened from a list (a machine, one SSH access): a round button on the left, the list's name in it.
import { ArrowLeft, X } from "lucide-react";
import { danger, quiet } from "../lib/forms";
import { tx } from "../lib/i18n";

export function BackButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} className="group inline-flex items-center gap-2 rounded-full border border-link/70 bg-link/10 py-1.5 pl-2.5 pr-4 text-sm font-semibold text-txt shadow-sm transition-colors hover:border-link hover:bg-link/20">
      <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{label}
    </button>
  );
}

/** Above the frame of a page opened from a list (a connector, a machine, a service): back on the left, close on the right, both leave */
export function PageExit({ label, onLeave }: Readonly<{ label: string; onLeave: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <BackButton label={label} onClick={onLeave} />
      <button type="button" className={`${quiet} ml-auto`} onClick={onLeave}><X size={15} aria-hidden />{tx("Fermer")}</button>
    </div>
  );
}

/** Asked before unsaved settings are lost */
export function LeaveAsk({ onQuit, onStay }: Readonly<{ onQuit: () => void; onStay: () => void }>) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/50 bg-warn/10 px-4 py-2.5 text-sm">
      {tx("Quitter sans enregistrer ? Les réglages modifiés seront perdus.")}
      <button type="button" className={danger} onClick={onQuit}>{tx("Quitter")}</button>
      <button type="button" className={quiet} onClick={onStay}>{tx("Rester")}</button>
    </div>
  );
}
