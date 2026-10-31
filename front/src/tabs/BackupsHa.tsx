// Réglages → Sauvegardes → Home Assistant : la sauvegarde automatique de Home Assistant se lit avec l'adresse et le jeton du
// connecteur Home Assistant (Réglages → Connecteurs), sans rien ressaisir. « Vérifier » lit sans rien enregistrer.
import { Home, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, send } from "../api";
import { NoteLine } from "../components/form";
import { IconChoice } from "../components/IconChoice";
import { appIcon } from "../lib/appIcons";
import { Badge, Card, Dim } from "../components/ui";
import { act, input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";

export interface HaState { connectors: string[]; followed: boolean; connector: string }

export function BackupsHa({ state, reload }: Readonly<{ state: HaState; reload: () => void }>) {
  const [name, setName] = useState(state.connector || state.connectors[0] || ""), [age, setAge] = useState("2");
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<"" | "check" | "follow">("");
  const body = { connector: name, label: "", max_age_days: Number(age) };
  const ageOk = Number(age) >= 0.1 && Number(age) <= 365;

  const check = async () => {
    setBusy("check"); setNote(null);
    try {
      const r = await send<{ ok: boolean; message: string }>("POST", "backups/ha/check", body);
      setNote({ ok: r.ok, text: r.message });
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (e as Error).message });
    }
    setBusy("");
  };
  const follow = async () => {
    setBusy("follow");
    const ok = await act(() => send("PUT", "backups/ha", body), tx("Sauvegarde de Home Assistant suivie : premier relevé en cours"), setNote);
    setBusy("");
    if (ok) reload();
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Home size={16} />{tx("Home Assistant")}
        {state.followed && <Badge tone="ok">{tx("suivi")}</Badge>}</h2>
      {state.connectors.length === 0 ? (
        <Dim>{tx("Aucun connecteur Home Assistant : ajoutez-le d'abord dans Réglages → Connecteurs (adresse et jeton), la sauvegarde s'y rattache ensuite.")}</Dim>
      ) : (
        <>
          <InfoNote className="mb-3">
            {tx("Lit la dernière sauvegarde automatique réussie de Home Assistant (capteurs du gestionnaire de sauvegardes), avec l'adresse et le jeton déjà enregistrés pour le connecteur. Lecture seule. Si le connecteur a l'adresse du module ha-mcp (module communautaire, pas le MCP natif), MyServices lit aussi la liste réelle des sauvegardes : date, taille, chiffrement et où elles sont copiées.")}
          </InfoNote>
          <div className="flex flex-wrap items-end gap-3">
            {state.connectors.length > 1 && (
              <div className="flex flex-col gap-1 text-sm text-muted">{tx("Connecteur")}
                <IconChoice label={tx("Connecteur")} value={name} onPick={setName}
                  options={state.connectors.map((n) => ({ value: n, label: n, icon: <img src={appIcon(["Home Assistant"]) ?? ""} alt="" className="h-7 w-7" /> }))} />
              </div>
            )}
            <label className="flex items-center gap-1 text-sm text-muted">{tx("alerte après")}
              <input className={`${input} w-16 py-1 text-sm`} type="number" min={0.1} max={365} step="any" value={age} aria-label={tx("Âge maximum en jours")}
                onChange={(e) => setAge(e.target.value)} />{tx("j")}
            </label>
            <button type="button" className={quiet} disabled={busy !== ""} onClick={() => void check()}>
              {busy === "check" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}{tx("Vérifier")}
            </button>
            <button type="button" className={primary} disabled={busy !== "" || !ageOk} onClick={() => void follow()}>
              {busy === "follow" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{state.followed ? tx("Mettre à jour") : tx("Suivre")}
            </button>
          </div>
        </>
      )}
      <NoteLine note={note} />
    </Card>
  );
}
