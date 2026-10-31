// Machines › Untracked devices: the list of devices, the progress of a search, and for a machine just followed, its access to set (SSH alias, command to allow, test).
// Read-only on the network; nothing is added unless the admin asks.
import { Check, Circle, EyeOff, KeyRound, Loader2, Plug, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { read, send } from "../api";
import { authorizeFor } from "../lib/ssh";
import { act, button, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { mergeDevices, type Device } from "../lib/devices";
import { ADDED_KEY, DISMISSED_KEY, REOPEN_EVENT } from "../lib/firstSteps";
import { appIcon } from "../lib/appIcons";
import { changes, needsLink, netState, roleOf, viaMynetwork } from "../lib/netScan";
import { pokeScan, rereadMachines } from "../lib/scan";
import { ConnectorForm } from "../tabs/Connectors";
import type { ConnectorsState, ConnectorType, NetHost, NetScan, SystemState, Unlinked } from "../types";
import { Copyable, NoteLine } from "./form";
import { netPercent } from "./ScanBar";
import { SkipButton } from "./SkipButton";
import { useDiscoveries } from "./DiscoveryCard";
import { Badge } from "./ui";
import { UnlinkedDevices } from "./UnlinkedDevices";
import { InfoNote } from "./InfoNote";

/** Icône de l'appli reconnue (rien si elle n'en a pas) */
function AppIcon({ apps }: { apps?: readonly string[] }) {
  const src = appIcon(apps);
  return src ? <img src={src} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" /> : null;
}

/** Cadre dépliable (« machines déjà ajoutées », « autres appareils ») : bordure et fond à la couleur d'accent pour qu'on voie qu'on peut l'ouvrir */
export const FOLD = "group rounded-xl border border-link/50 bg-link/5 open:bg-link/[0.03] hover:border-link";
/** Même cadre dépliable quand il y a une action à faire : couleur d'alerte */
export const FOLD_WARN = "group rounded-xl border border-warn/60 bg-warn/10 hover:border-warn";
export const FOLD_HEAD = "flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-t-[11px] bg-bg px-3 py-2.5 text-sm font-semibold text-txt group-open:border-b group-open:border-line/60 [details:not([open])_&]:rounded-b-[11px] [&::-webkit-details-marker]:hidden";

const quietBtn = `${button} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`;

const ADDED = ADDED_KEY;
const loadAdded = (): Record<string, NetHost> => {
  try { return JSON.parse(sessionStorage.getItem(ADDED) || "{}") as Record<string, NetHost>; } catch { return {}; }
};

const DISMISSED = DISMISSED_KEY;
const loadDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED) || "[]") as string[]; } catch { return []; }
};

export function NetworkStep({ net, reload, machines, connected, unlinked, hidden }: Readonly<{
  net: NetScan | null; reload: () => void; unlinked: Unlinked[]; hidden: { ip: string; name: string }[];
  machines: { ip: string; name?: string; ssh?: unknown }[]; connected: { connector: string; url?: string | null }[];
}>) {
  const known = machines.map((m) => m.ip);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [disc, reloadDisc] = useDiscoveries();
  // Accesses forgotten with « Forget »: kept on the server (« access:<ip> »), plus the older « Skip » choices of this browser
  const [justForgot, setJustForgot] = useState<string[]>([]);   // hidden at the click, before the server answer comes back
  const forgot = new Set([...dismissed, ...justForgot, ...(disc?.muted ?? []).filter((id) => id.startsWith("access:")).map((id) => id.slice(7))]);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState<string | null>(null);
  // Machines ajoutées dont les options (SSH, jeton) restent à régler : gardées si la page est rechargée, retirées par « Terminé »
  const [added, setAdded] = useState<Record<string, NetHost>>(loadAdded);
  useEffect(() => { sessionStorage.setItem(ADDED, JSON.stringify(added)); }, [added]);
  useEffect(() => {  // « Revoir les premiers pas » efface la mémoire : la carte déjà affichée la relit
    const refresh = () => { setDismissed(loadDismissed()); setAdded(loadAdded()); };
    addEventListener(REOPEN_EVENT, refresh);
    return () => removeEventListener(REOPEN_EVENT, refresh);
  }, []);
  const stop = async () => { await send("POST", "network/scan/stop"); reload(); };

  // Accès à régler : machines ajoutées à l'instant, plus celles déjà déclarées dont le jeton Home Assistant manque
  const pending = (net?.found ?? []).filter((h) => known.includes(h.ip) && !added[h.ip] && !forgot.has(h.ip) && needsLink(h, machines, connected) === "ha");
  const toLink = [...Object.values(added), ...pending].filter((h) => !forgot.has(h.ip) && needsLink(h, machines, connected));

  const follow = async (d: Device) => {
    const ip = d.ip as string, host = { ...d.host, name: d.name };
    setBusy(ip);
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine: { name: d.name.slice(0, 60) || ip, role: roleOf(host) }, extra: [] }), tx("machines ajoutées : relevé et santé lancés"), setNote);
    if (ok) {
      setAdded((a) => ({ ...a, [ip]: host }));
      await rereadMachines([ip]).catch(() => undefined);  // relevé et santé de la seule machine ajoutée
    }
    setBusy(null);
  };
  const setHidden = async (d: Device, hide: boolean) => {
    const label = d.name || d.ip || "";
    setBusy(d.ip as string);
    await (hide ? act(() => send("POST", "network/ignored", { ip: d.ip, name: d.name }), tx("{0} caché : « Reprendre » le ramène", label), setNote)
      : act(() => send("DELETE", `network/ignored/${d.ip}`), tx("{0} rappelé : de nouveau proposé", label), setNote));
    setBusy(null);
    reload();
  };

  const pinging = net?.phase === "ping";
  return (
    <div className="flex flex-col gap-3">
      {net && netState(net) === "run" && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <InfoNote>
            {tx("Lecture seule : un ping par adresse, la demande du nom et quelques connexions TCP. Rien n'est modifié sur vos machines.")}
          </InfoNote>
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex items-center gap-2">
              {pinging ? <Loader2 size={15} className="animate-spin text-link" aria-hidden /> : <Check size={15} className="step-pop text-ok" aria-hidden />}
              <b className="text-txt">{tx("Recherche des machines allumées")}</b>
              <span className="tabular-nums text-dim">{net.done}/{net.total} {tx("adresses")}</span>
              <span className="font-mono text-xs text-dim">{net.net}</span>
            </li>
            <li className={`flex items-center gap-2 transition-opacity duration-500 ${pinging ? "opacity-50" : ""}`}>
              {pinging ? <Circle size={15} className="text-dim" aria-hidden /> : <Loader2 size={15} className="animate-spin text-link" aria-hidden />}
              <b className="text-txt">{tx("Identification de chaque machine")}</b>
              <span className="text-dim">{pinging ? tx("nom, ports ouverts : juste après") : tx("{0}/{1} machines (nom, ports ouverts)", net.described, net.up)}</span>
            </li>
          </ul>
          <div className="h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden>
            <div className="scan-fill h-full rounded-full" style={{ width: `${Math.max(3, netPercent(net))}%` }} />
          </div>
          <div><button type="button" className={quietBtn} onClick={() => void stop()}><Square size={13} aria-hidden />{tx("Arrêter")}</button></div>
        </div>
      )}
      {net?.error && <p className="text-bad">⚠ {net.error}</p>}
      {toLink.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-txt">{tx("Machines ajoutées : accès à régler")}</p>
          {toLink.map((h) => (
            <AddedMachine key={h.ip} host={h} linked={!viaMynetwork(h) && !needsLink(h, machines, connected)}
              onDone={() => setAdded((a) => { const n = { ...a }; delete n[h.ip]; return n; })}
              onForget={() => { setJustForgot((f) => [...f, h.ip]); void act(() => send("PUT", "discoveries/muted", { id: `access:${h.ip}`, muted: true }),
                tx("{0} oublié : il reste dans « Arrêtés et oubliés », pour le rappeler", h.name || h.ip), setNote)
                .then((ok) => { if (ok) { setAdded((a) => { const n = { ...a }; delete n[h.ip]; return n; }); reloadDisc(); } else setJustForgot((f) => f.filter((x) => x !== h.ip)); }); }} />
          ))}
        </div>
      )}
      <UnlinkedDevices devices={mergeDevices(net?.found ?? [], unlinked, [...known, ...Object.keys(added)], hidden)} fresh={net ? changes(net)?.fresh : undefined}
        busy={busy} onFollow={(d) => void follow(d)} onHide={(d) => void setHidden(d, true)} onBring={(d) => void setHidden(d, false)} />
      <NoteLine note={note} />
    </div>
  );
}

/** Machine ajoutée : si elle répond en SSH, préparer l'accès (alias avec la clé de l'app), puis la commande et le test */
/** linked : l'accès marche déjà d'après les données du serveur (cadre rouvert après un rechargement de la page) */
function AddedMachine({ host, linked, onDone, onForget }: { host: NetHost; linked: boolean; onDone: () => void; onForget: () => void }) {
  const ha = host.apps.includes("Home Assistant");
  const mwk = viaMynetwork(host);  // UniFi : API MynetworK à venir ; SSH facultatif
  const ssh = !!host.ssh_port && !ha;  // Home Assistant se relie par son API : pas de SSH proposé, même s'il répond
  const [user, setUser] = useState("root"), [cmd, setCmd] = useState<string | null>(null), [esxiKey, setEsxiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null), [tested, setTested] = useState(false), [haOk, setHaOk] = useState(false);
  const ok = tested || linked;
  const valid = ok || haOk || (!ssh && !ha);  // vert seulement une fois l'accès validé (ou s'il n'y en a aucun à régler)
  const label = host.name || host.ip;

  const prepare = async () => {
    setBusy(true);
    await act(async () => {
      const { alias } = await send<{ alias: string }>("POST", "machines/ssh-alias", { ip: host.ip, user, port: host.ssh_port ?? 22 });
      await send("PUT", `machines/settings/${host.ip}`, { machine: { name: label, role: roleOf(host), ssh: alias }, extra: [] });
      const sys = await read<SystemState>("system");
      setCmd(sys.ssh.authorize ?? null);
      setEsxiKey(sys.ssh.public_esxi ?? null);
    }, tx("accès SSH préparé : lancer la commande sur la machine, puis tester"), setNote);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    const good = await act(async () => {
      const r = await send<{ failed: number }>("POST", `machines/settings/${host.ip}/check`);
      if (r.failed) throw new Error(tx("toujours illisible : {0}", label));
      await rereadMachines([host.ip]);
    }, tx("accès SSH accepté : cette machine est relue (collecte et santé)"), setNote);
    setTested(good);
    setBusy(false);
  };

  return (
    <div className={`rounded-lg border p-3 ${valid ? "border-ok/50 bg-ok/10" : "border-warn/50 bg-warn/10"}`}>
      <p className="flex flex-wrap items-center gap-2">
        <Check size={14} className={valid ? "text-ok" : "text-warn"} aria-hidden /><AppIcon apps={host.apps} /><b className="text-txt">{label}</b>
        <span className="font-mono text-xs text-dim">{host.ip}</span><Badge tone={valid ? "ok" : "warn"}>{valid ? tx("ajoutée") : tx("accès à régler")}</Badge>
        {ssh && ok && <Badge tone="ok">{tx("SSH accepté")}</Badge>}
        {valid ? <SkipButton onClick={onDone} onDark className="ml-auto" label={tx("Terminé")} title={tx("Fermer ce cadre : la machine est ajoutée")} />
          : <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-bg2 px-2.5 py-1 text-xs text-muted hover:border-link hover:text-txt" onClick={onForget}
              title={tx("Ne plus demander cet accès : la machine reste ajoutée. « Rappeler » dans « machines déjà ajoutées » le fait revenir.")}><EyeOff size={13} aria-hidden />{tx("Oublier")}</button>}
      </p>
      {mwk && (
        <InfoNote className="mt-2">
          {tx("UniFi sera lu par l'API de MynetworK (à venir) : en ligne / hors ligne, appareils et clients, sans SSH. Le SSH apporte seulement l'état système (disque, charge) : à vous de voir.")}
        </InfoNote>
      )}
      {ssh && !ok && !cmd && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-dim">{tx("Compte SSH sur cette machine")}
            <input className={`${input} w-40`} value={user} maxLength={32} onChange={(e) => setUser(e.target.value)} />
          </label>
          <button type="button" className={mwk ? quietBtn : primary} disabled={busy || !user} onClick={() => void prepare()}>
            <KeyRound size={14} aria-hidden />{mwk ? tx("Lire quand même par SSH") : tx("Lire cette machine par SSH")}
          </button>
        </div>
      )}
      {cmd && !ok && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">{tx("Sur {0}, en root (ou connecté avec le compte {1}) :", label, user)}</p>
          <Copyable text={authorizeFor(cmd, user, esxiKey)} oneLine />
          <div><button type="button" className={primary} disabled={busy} onClick={() => void test()}>{busy ? tx("Test…") : tx("Tester")}</button></div>
        </div>
      )}
      {ha && <HomeAssistantLink host={host} onLinked={() => setHaOk(true)} />}
      {!ssh && !ha && <InfoNote className="mt-1">{tx("Pas de SSH sur cette machine : ses services web seront suivis par leur adresse.")}</InfoNote>}
      <NoteLine note={note} />
    </div>
  );
}

/** Home Assistant : pas de SSH, son API avec un jeton (connecteur « home-assistant », formulaire et aide partagés avec Réglages) */
function HomeAssistantLink({ host, onLinked }: { host: NetHost; onLinked: () => void }) {
  const [type, setType] = useState<ConnectorType | null>(null), [open, setOpen] = useState(true), [done, setDone] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {  // le formulaire (et son aide) s'ouvre d'office : c'est la suite logique de l'ajout
    void act(async () => {
      const st = await read<ConnectorsState>("connectors/settings");
      const t = st.types.find((x) => x.type === "home-assistant");
      if (!t) throw new Error(tx("connecteur Home Assistant introuvable"));
      setType(t);
      // déjà relié (enregistré, mais pas encore vu par la collecte) : pas de second formulaire, qui échouerait en doublon
      if (st.instances.some((i) => i.type === "home-assistant" && String(i.config.url ?? "").includes(host.ip))) { setDone(true); onLinked(); }
    }, "", setNote);
  }, []);
  if (done) return <p className="mt-2 text-sm text-muted">{tx("Home Assistant relié par son API : première lecture en cours")}</p>;
  return (
    <div className="mt-2">
      <InfoNote>{tx("Home Assistant se relie par son API (adresse + jeton), pas par SSH. Un compte dédié non administrateur est recommandé.")}</InfoNote>
      {!open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => setOpen(true)}><Plug size={14} aria-hidden />{tx("Relier Home Assistant")}</button>
          <span className="self-center text-sm text-dim">{tx("ou plus tard : Réglages → Connecteurs")}</span>
        </div>
      )}
      {open && type && (
        <ConnectorForm type={type} quietSave prefill={{ type: "home-assistant", name: "home-assistant", url: `http://${host.ip}:8123` }}
          onDone={() => { setDone(true); onLinked(); void send("POST", "system/tasks/collect/run").catch(() => undefined); pokeScan(); }}
          onCancel={() => setOpen(false)} />
      )}
      <NoteLine note={note} />
    </div>
  );
}
