// Mode automatique (Réglages → Découverte, fin des premiers pas) : un seul interrupteur. Activé, les machines trouvées par la
// recherche réseau sont ajoutées et leur SSH activé tout seuls ; coupé, tout se fait à la main. Ce qui reste manuel est dit.
import { Hand, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { read, send } from "../api";
import { NoteLine, Switch } from "./form";
import { Badge } from "./ui";
import { act, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

export function AutoMode({ onChange }: { onChange?: () => void }) {
  const [auto, setAuto] = useState<boolean | null>(null), [note, setNote] = useState<Note>(null);
  useEffect(() => { read<{ auto: boolean }>("network/settings").then((c) => setAuto(c.auto)).catch(() => undefined); }, []);
  if (auto === null) return null;
  const save = (on: boolean) => act(() => send("PUT", "network/settings", { auto: on }), on ? tx("mode automatique activé") : tx("mode manuel : rien n'est plus ajouté tout seul"), setNote)
    .then((ok) => { if (ok) { setAuto(on); onChange?.(); } });
  return (
    <div className={`rounded-xl border-2 px-4 py-3 text-sm ${auto ? "border-ok/50 bg-ok/5" : "border-dim/50 bg-bg2/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        {auto ? <Zap size={18} className="text-ok" aria-hidden /> : <Hand size={18} className="text-muted" aria-hidden />}
        <b className="text-base">{tx("Mode automatique")}</b>
        <Badge tone={auto ? "ok" : "off"}>{auto ? tx("activé") : tx("manuel")}</Badge>
        <span className="ml-auto"><Switch on={auto} onChange={(on) => void save(on)} label={tx("Mode automatique")} /></span>
      </div>
      <p className="mt-2 text-muted">
        {auto
          ? tx("Après chaque recherche réseau (toutes les 6 h par défaut), les machines avec SSH, une appli reconnue ou un service utile sont ajoutées toutes seules, et leur SSH s'active dès que la clé marche. Une machine retirée à la main ne revient pas.")
          : tx("Rien n'est ajouté ni activé tout seul : vous choisissez les machines trouvées et activez le SSH vous-même. La recherche réseau garde sa fréquence.")}
      </p>
      <p className="mt-1 text-xs text-dim">{tx("Toujours à faire vous-même : autoriser la clé SSH sur chaque machine, donner un jeton aux connecteurs, installer l'agent Windows.")}</p>
      <NoteLine note={note} />
    </div>
  );
}
