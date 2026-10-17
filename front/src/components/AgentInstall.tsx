// Installation d'un agent sur une machine : choix du type (Windows / Linux), adresse de MyServices vue de la machine, création du jeton
// (montré une seule fois), commande à coller, puis confirmation au premier relevé. Partagé par Réglages → Agents et par la fenêtre de
// l'assistant, pour que les deux disent et fassent exactement la même chose.
import { ChevronDown, ChevronRight, Download, Monitor, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOGIN, LoginRequired, read, send } from "../api";
import { Copyable, Field, NoteLine } from "./form";
import { Badge, Card, Dim } from "./ui";
import { cleanAgentUrl, installCommand } from "../lib/agentCommand";
import { dateTime } from "../lib/format";
import { input, primary, quiet, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import type { AgentInfo, AgentsState } from "../types";

export type AgentKind = "windows" | "linux";

/** Machine pour laquelle on installe : `choose` laisse changer le type, `auto` crée l'agent tout de suite (nouvelle commande) */
export interface InstallTarget { ip: string; name: string; kind: AgentKind; choose?: boolean; auto?: boolean }

// Exemple d'adresse du LAN : en local il n'y a pas de TLS, http est voulu
const EXAMPLE_URL = "http://192.168.1.10:8090"; // NOSONAR

/** Nom d'agent accepté par le serveur (lettres, chiffres, espace, . _ @ -) tiré du nom de la machine */
const agentName = (machine: string) => machine.replace(/[^\p{L}\p{N}_ .@-]/gu, "").trim().slice(0, 64) || "agent";

export function AgentInstall({ target, onChanged, onClose, onSsh }: Readonly<{
  target: InstallTarget; onChanged?: () => void; onClose: () => void;
  onSsh?: () => void;   // dans l'assistant : ouvre le réglage SSH dans une fenêtre ; sans cela, lien vers la page de la machine
}>) {
  const [kind, setKind] = useState<AgentKind>(target.kind);
  // Adresse de MyServices vue de la machine : par défaut celle de la page ; le champ ne s'affiche que pour la corriger
  const [url, setUrl] = useState(location.origin);
  const [created, setCreated] = useState<{ info: AgentInfo; token: string } | null>(null);   // jeton gardé en mémoire de la page seulement
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false), [agents, setAgents] = useState<AgentsState | null>(null);
  const command = created ? installCommand(url, created.token, created.info.kind) : null;   // suit le champ « Adresse » même après la création
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(url);

  const create = useCallback(async () => {
    setBusy(true); setNote(null);
    try {
      setCreated(await send<{ info: AgentInfo; token: string }>("POST", "agents", { ip: target.ip, name: agentName(target.name), url, kind }));
      onChanged?.();
    } catch (err) {
      if (err instanceof LoginRequired) location.replace(LOGIN);
      else setNote({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }, [target.ip, target.name, url, kind, onChanged]);
  const started = useRef(false);
  useEffect(() => { if (target.auto && !started.current) { started.current = true; void create(); } }, [target.auto, create]);

  // Confirmation au premier relevé : les agents sont relus toutes les 5 s tant qu'il est attendu
  const reload = useCallback(() => { read<AgentsState>("agents").then(setAgents).catch(() => undefined); }, []);
  const seen = created ? agents?.agents.find((x) => x.id === created.info.id) : undefined;
  usePoll(reload, created && !seen?.last_seen ? 5000 : 60_000, false);
  useEffect(() => { if (created) reload(); }, [created, reload]);
  // Cadre « Agent créé » : replié tout seul au premier relevé reçu (une fois), dépliable ensuite
  const [folded, setFolded] = useState(false), foldedFor = useRef(0);
  useEffect(() => {
    if (created && seen?.last_seen && foldedFor.current !== created.info.id) { foldedFor.current = created.info.id; setFolded(true); onChanged?.(); }
  }, [created, seen?.last_seen, onChanged]);

  const addressField = (
    <div className="mt-3">
      <div className="max-w-md">
        <Field label={tx("Adresse de MyServices, vue du PC")}>
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder={EXAMPLE_URL} inputMode="url" />
        </Field>
      </div>
      {cleanAgentUrl(url)?.endsWith(":5180") && <p className="mt-2 text-sm text-warn">{tx("5180 est le serveur de développement : l'agent cessera d'envoyer quand il s'arrête. Utilisez l'adresse stable de MyServices (le conteneur, ex. http://192.168.1.10:8091).")}</p>}
      {local && <p className="mt-2 text-sm text-warn">{tx("localhost ne marchera pas depuis un autre PC : mettez l'adresse du LAN de MyServices (ex. http://192.168.1.10:8090).")}</p>}
    </div>
  );

  if (created) {
    return (
      <Card tone="ok">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setFolded(!folded)} aria-expanded={!folded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {folded ? <ChevronRight size={16} className="shrink-0 text-txt" aria-hidden /> : <ChevronDown size={16} className="shrink-0 text-txt" aria-hidden />}
            <h2 className="truncate font-bold text-ok">{tx("Agent «")} {created.info.name} {tx("» créé")}</h2>
            {folded && seen?.last_seen && <Badge tone="ok">✓ {tx("premier relevé reçu")}</Badge>}
          </button>
          <button type="button" className={quiet} onClick={onClose}><X size={14} />{tx("Fermer")}</button>
        </div>
        {!folded && <div className="mt-2">
          <p className="mb-2 text-sm text-warn">{tx("À copier maintenant : le jeton qu'elle contient ne sera plus jamais affiché.")}</p>
          <p className="mb-2 text-sm text-muted">{created.info.kind === "linux" ? tx("Sur la machine, ouvrez un terminal (compte avec sudo) et collez :") : tx("Sur le PC, ouvrez PowerShell en administrateur (clic droit → Exécuter en tant qu'administrateur) et collez :")}</p>
          {command ? <Copyable key={command} text={command} />
            : <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{tx("Adresse de MyServices invalide : http://hôte:port, sans chemin. Corrigez-la ci-dessous, la commande se met à jour.")}</p>}
          {!command && addressField}
          <p className="mt-2 text-xs text-dim">{created.info.kind === "linux"
            ? tx("L'installation crée un minuteur systemd (au démarrage, puis toutes les 15 min) et envoie un premier relevé. Pour retirer l'agent : révoquer ici, puis sur la machine relancer la commande avec MSV_UNINSTALL=1.")
            : tx("L'installation crée une tâche planifiée (au démarrage, puis toutes les 15 min) et envoie un premier relevé. Pour retirer l'agent : révoquer ici, puis sur le PC relancer la commande avec MSV_UNINSTALL = '1'.")}</p>
          {seen?.last_seen
            ? <div role="status" className="mt-3 rounded-lg bg-ok/10 px-3 py-2">
                <p className="text-sm font-semibold text-ok">✓ {tx("Agent installé et actif : premier relevé reçu")}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
                  <Monitor size={16} className="shrink-0 text-ok" aria-hidden />{tx("Système détecté :")} <b className="text-base text-txt">{seen.os || tx("non précisé par l'agent")}</b>
                  <Dim>· {tx("agent")} v{seen.version || "?"} · {dateTime(seen.last_seen * 1000)}</Dim>
                </p>
              </div>
            : <p role="status" className="mt-3 rounded-lg bg-bg2 px-3 py-2 text-sm text-muted">⏳ {tx("En attente du premier relevé : cette ligne se met à jour toute seule dès que le PC a envoyé le premier, sans rien à recharger.")}</p>}
        </div>}
      </Card>
    );
  }
  if (target.auto) return <NoteLine note={note} />;   // création automatique en cours (ou en erreur : le message s'affiche)
  return (
    <Card className="border-link/60">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Download size={16} aria-hidden />{tx("Installer l'agent sur")} {target.name} <Dim>· {target.ip}</Dim></h2>
      <p className="text-sm text-muted">{kind === "linux"
        ? tx("L'agent Linux est un script Python, en lecture seule. « Créer l'agent » génère son jeton (montré une seule fois) et la commande à coller dans un terminal de la machine (avec sudo).")
        : tx("L'agent est un script PowerShell pour Windows, en lecture seule. « Créer l'agent » génère son jeton (montré une seule fois) et la commande à coller dans un PowerShell administrateur du PC.")}</p>
      {target.choose && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={tx("Type d'agent")}>
          {(["windows", "linux"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm font-semibold ${kind === k ? "border-link bg-link/10 text-txt" : "border-line bg-bg2 text-muted hover:border-link"}`}>{k === "windows" ? "Windows" : "Linux"}</button>
          ))}
          {kind === "linux" && (onSsh
            ? <button type="button" className="text-xs text-link underline" onClick={onSsh}>{tx("ou régler l'accès SSH de cette machine")}</button>
            : <a href={`#settings/machines/${target.ip}`} className="text-xs text-link underline">{tx("ou régler l'accès SSH de cette machine")}</a>)}
        </div>
      )}
      {addressField}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy || !url} onClick={() => void create()}><Plus size={14} />{tx("Créer l'agent")}</button>
        <button type="button" className={quiet} onClick={onClose}>{tx("Annuler")}</button>
      </div>
      <NoteLine note={note} />
    </Card>
  );
}
