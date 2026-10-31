// « Ne plus suivre » a machine, or follow it again, from the Machines list and its page: the « Machine suivie » switch of its settings, one click closer.
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { act, danger, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { saveFollowed } from "../lib/machineAccess";
import type { Machine } from "../types";
import { NoteLine } from "./form";

const followLabel = (m: Machine) => m.disabled ? tx("Reprendre le suivi") : tx("Ne plus suivre");

/** The icon of a line of the list: it only asks, FollowAsk does the change */
export function FollowIcon({ m, onAsk }: Readonly<{ m: Machine; onAsk: () => void }>) {
  const Icon = m.disabled ? Eye : EyeOff;
  return <button type="button" onClick={onAsk} aria-label={`${followLabel(m)} : ${m.name}`} title={followLabel(m)}
    className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt"><Icon size={14} aria-hidden /></button>;
}

/** The button of the machine page: it only asks, FollowAsk does the change */
export function FollowButton({ m, onAsk }: Readonly<{ m: Machine; onAsk: () => void }>) {
  const Icon = m.disabled ? Eye : EyeOff;
  return <button type="button" onClick={onAsk} className={quiet}><Icon size={14} aria-hidden />{followLabel(m)}</button>;
}

/** The confirmation, shown in place: stopping cuts every reading of the machine at once, and the list has many small icons side by side */
export function FollowAsk({ m, onClose }: Readonly<{ m: Machine; onClose: () => void }>) {
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const ok = await act(() => saveFollowed(m.ip, !!m.disabled), tx("enregistré"), setNote);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{m.disabled
        ? tx("Reprendre le suivi de {0} ? Ping, SSH, santé et alertes repartent.", m.name)
        : tx("Ne plus suivre {0} ? Ping, SSH, santé et alertes s'arrêtent. Tu pourras reprendre le suivi.", m.name)}</span>
      <button type="button" disabled={busy} className={m.disabled ? quiet : danger} onClick={() => void confirm()}>{followLabel(m)}</button>
      <button type="button" className={quiet} onClick={onClose}>{tx("Annuler")}</button>
      <NoteLine note={note} />
    </div>
  );
}

/** Says on the machine page why nothing new is read */
export function NotFollowedBanner() {
  return <div className="rounded-lg border border-line bg-bg2/70 px-3 py-2 text-sm text-muted">
    {tx("Cette machine n'est plus suivie : ni ping, ni SSH, ni santé, aucune alerte. Un agent installé dessus continue d'envoyer ses relevés tant qu'il n'est pas désinstallé.")}
  </div>;
}
