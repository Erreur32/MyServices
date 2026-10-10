// Réglages → Sources : chaque source de services s'active ou se coupe. Coupée : plus lue par la collecte, donc
// ni onglet, ni compteurs, ni phrase sur l'accueil ; la veille garde son dernier état (pas d'alerte en rafale).
import { Ban, Globe, Network, Server } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { NoteLine, Switch } from "../components/form";
import { Badge, Card, Dim } from "../components/ui";
import { act, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";

const LIST: { id: string; icon: ReactNode; label: string; what: string; soon?: string }[] = [
  { id: "npm", icon: <Globe size={18} />, label: "Nginx Proxy Manager", what: tx("Proxy hosts, redirections, ACL et certificats ; onglet Services et compteurs NPM.") },
  { id: "apache", icon: <Server size={18} />, label: "Apache", what: tx("Vhosts Apache des machines lues par SSH, comme services directs.") },
  { id: "adguard", icon: <Network size={18} />, label: "AdGuard Home", what: tx("Réécritures et réponses DNS de chaque instance ; onglet DNS et compteurs AdGuard.") },
  { id: "fail2ban", icon: <Ban size={18} />, label: "Fail2ban", what: tx("Bannissements et prisons, par LogviewR ; onglet Fail2ban."), soon: tx("arrive avec le connecteur LogviewR") },
];

export function Sources() {
  const [src, setSrc] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState(""), [note, setNote] = useState<Note>(null), [changed, setChanged] = useState(false);
  const reload = useCallback(() => {
    read<{ sources: Record<string, boolean> }>("sources")
      .then((r) => { setSrc(r.sources); setError(""); })
      .catch((e) => (e instanceof LoginRequired ? location.replace(LOGIN) : setError(String(e.message || e))));
  }, []);
  useEffect(reload, [reload]);
  if (!src) return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
  const toggle = (id: string, on: boolean) =>
    void act(() => send("PUT", `sources/${id}`, { enabled: on }), on ? tx("activée") : tx("coupée"), setNote)
      .then((ok) => { if (ok) { setChanged(true); reload(); } });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="font-bold">{tx("Sources de services")}</h2>
        <p className="mt-1 text-sm text-muted">
          {tx("Une source coupée n'est plus lue : son onglet, ses compteurs et sa phrase sur l'accueil disparaissent. La veille garde son dernier état : ni « disparus » à la coupure, ni « nouveaux » au retour.")}
        </p>
      </Card>
      <Card>
        <ul className="flex flex-col divide-y divide-line/60">
          {LIST.map((s) => (
            <li key={s.id} className={`flex items-start gap-3 py-3 ${s.soon ? "opacity-60" : ""}`}>
              <Switch on={!!src[s.id]} disabled={!!s.soon} onChange={(on) => toggle(s.id, on)}
                label={`${src[s.id] ? tx("Couper") : tx("Activer")} ${s.label}`} />
              <span className="mt-0.5 text-muted">{s.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{s.label}</b>
                  {s.soon ? <Badge tone="off">{tx("à venir")}</Badge> : <Badge tone={src[s.id] ? "ok" : "off"}>{src[s.id] ? tx("activée") : tx("coupée")}</Badge>}
                </div>
                <div className="text-sm text-dim">{s.what}{s.soon && <Dim> · {s.soon}</Dim>}</div>
              </div>
            </li>
          ))}
        </ul>
        <NoteLine note={note} />
        {changed && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            {tx("Pris en compte à la prochaine collecte.")}
            <button type="button" className={primary}
              onClick={() => void act(() => send("POST", "system/tasks/collect/run"), tx("collecte lancée : la page se met à jour à la fin"), setNote)}>
              {tx("Lancer la collecte maintenant")}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
