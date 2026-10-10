// Étape « Recherche des autres machines du réseau » de Premiers pas : lancer la recherche, choisir les machines à
// ajouter, puis, pour celles qui répondent en SSH, préparer l'accès (alias + commande à autoriser + test).
// Lecture seule sur le réseau ; rien n'est ajouté sans que l'admin le demande.
import { Check, Circle, KeyRound, Loader2, Plug, RefreshCw, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { read, send } from "../api";
import { act, button, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { dateTime } from "../lib/format";
import { changes, interesting, needsLink, netState, quiet, tagsOf } from "../lib/netScan";
import { pokeScan } from "../lib/scan";
import { ConnectorForm } from "../tabs/Connectors";
import type { ConnectorsState, ConnectorType, NetHost, NetScan, SystemState } from "../types";
import { Copyable, NoteLine } from "./form";
import { netPercent } from "./ScanBar";
import { Badge } from "./ui";

/** Une machine trouvée : nom (ou « sans nom »), adresse une seule fois, une étiquette par information ;
 *  hint : explication de l'étape qui suivra l'ajout (jeton Home Assistant, clé SSH), seulement si la machine est cochée */
function HostInfo({ h, fresh = false, hint = false }: { h: NetHost; fresh?: boolean; hint?: boolean }) {
  const tags = tagsOf(h);
  return (
    <>
      {h.name ? <b className="text-txt">{h.name}</b> : <i className="text-dim">{tx("sans nom")}</i>}
      <span className="font-mono text-xs text-dim">{h.ip}</span>
      {h.title && <span className="max-w-[28ch] truncate text-xs text-muted" title={h.title}>« {h.title} »</span>}
      {tags.map((t) => <Badge key={t.label} tone={t.kind === "ssh" ? "ok" : t.kind === "app" ? "info" : "off"}>{t.label}</Badge>)}
      {fresh && <Badge tone="warn">{tx("nouvelle")}</Badge>}
      {hint && h.apps.includes("Home Assistant") && (
        <span className="row-in basis-full pl-6 text-xs text-warn">
          <KeyRound size={12} className="mr-1 inline" aria-hidden />{tx("Après l'ajout, un jeton d'accès vous sera demandé (par son API, pas par SSH) : l'aide vous guide pas à pas.")}
        </span>
      )}
      {hint && !!h.ssh_port && !h.apps.includes("Home Assistant") && (
        <span className="row-in basis-full pl-6 text-xs text-link">
          <KeyRound size={12} className="mr-1 inline" aria-hidden />{tx("Après l'ajout, une étape guidée prépare l'accès SSH : une commande à lancer sur la machine avec la clé de MyServices, puis un test.")}
        </span>
      )}
    </>
  );
}

const quietBtn = `${button} border-line text-muted hover:border-link hover:text-txt`;

const ADDED = "myservices-network-added";
const loadAdded = (): Record<string, NetHost> => {
  try { return JSON.parse(sessionStorage.getItem(ADDED) || "{}") as Record<string, NetHost>; } catch { return {}; }
};

const DISMISSED = "myservices-network-dismissed";
const loadDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED) || "[]") as string[]; } catch { return []; }
};

export function NetworkStep({ net, reload, machines, connected, onSkip }: {
  net: NetScan | null; reload: () => void; onSkip: () => void;
  machines: { ip: string; ssh?: unknown }[]; connected: { connector: string; url?: string | null }[];
}) {
  const known = machines.map((m) => m.ip);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Machines ajoutées dont les options (SSH, jeton) restent à régler : gardées si la page est rechargée, retirées par « Terminé »
  const [added, setAdded] = useState<Record<string, NetHost>>(loadAdded);
  useEffect(() => { sessionStorage.setItem(ADDED, JSON.stringify(added)); }, [added]);
  const state = netState(net);
  const preselected = useRef<number | null>(null);
  useEffect(() => {  // fin d'une recherche : les machines intéressantes sont cochées d'office (décochables)
    if (net?.phase !== "done" || !net.ended || preselected.current === net.ended) return;
    preselected.current = net.ended;
    setPicked(new Set(net.found.filter(interesting).map((h) => h.ip)));
  }, [net]);
  const diff = net ? changes(net) : null;

  const start = async () => {
    setBusy(true);
    await act(async () => { await send("POST", "network/scan"); pokeScan(); reload(); }, tx("recherche lancée"), setNote);
    setBusy(false);
  };
  const stop = async () => { await send("POST", "network/scan/stop"); reload(); };

  const toggle = (ip: string) => setPicked((p) => { const n = new Set(p); if (n.has(ip)) n.delete(ip); else n.add(ip); return n; });
  const found = (net?.found ?? []).filter((h) => !added[h.ip] && !known.includes(h.ip));
  const useful = found.filter((h) => !quiet(h)), silent = found.filter(quiet);
  // Accès à régler : machines ajoutées à l'instant, plus celles déjà déclarées dont le SSH ou le jeton Home Assistant manque
  const pending = (net?.found ?? []).filter((h) => known.includes(h.ip) && !added[h.ip] && !dismissed.includes(h.ip) && needsLink(h, machines, connected));
  const toLink = [...Object.values(added), ...pending];
  const later = (net?.found ?? []).filter((h) => known.includes(h.ip) && dismissed.includes(h.ip) && needsLink(h, machines, connected));
  const resumeLater = () => setDismissed((d) => { const n = d.filter((ip) => !later.some((h) => h.ip === ip)); localStorage.setItem(DISMISSED, JSON.stringify(n)); return n; });

  const scanned = !!net && net.phase === "done" && !!net.ended;
  /** Les deux actions de l'étape, ensemble : (re)lancer la recherche, ou la passer (à reprendre plus tard) */
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={scanned ? `${button} border-link/60 bg-link/10 text-txt hover:bg-link/20` : primary} disabled={busy} onClick={() => void start()}>
        {scanned ? <RefreshCw size={14} aria-hidden /> : <Search size={14} aria-hidden />}{scanned ? tx("Refaire un scan") : tx("Lancer le scan")}
      </button>
      <button type="button" className={quietBtn} onClick={onSkip}
        title={tx("Passer cette étape : vous pourrez la refaire plus tard, ici ou dans les Réglages")}>{tx("Passer")}</button>
    </div>
  );

  const renderRows = (list: NetHost[]) => list.map((h) => (
    <li key={h.ip}>
      <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2 hover:bg-bg2">
        <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--link))]" checked={picked.has(h.ip)} onChange={() => toggle(h.ip)} />
        <HostInfo h={h} fresh={!!diff?.fresh.has(h.ip)} hint={picked.has(h.ip)} />
      </label>
    </li>
  ));

  const addPicked = async () => {
    setBusy(true);
    const done: Record<string, NetHost> = {};
    await act(async () => {
      for (const h of found.filter((x) => picked.has(x.ip))) {
        await send("PUT", `machines/settings/${h.ip}`, { machine: { name: h.name || h.ip, role: h.hints.join(", ") }, extra: [] });
        done[h.ip] = h;
      }
    }, tx("machines ajoutées : prises en compte au prochain passage de la collecte"), setNote);
    setAdded((a) => ({ ...a, ...done }));
    setPicked(new Set());
    if (Object.keys(done).length) {  // les machines ajoutées apparaissent après un passage de la collecte
      await send("POST", "system/tasks/collect/run").catch(() => undefined);
      pokeScan();
    }
    setBusy(false);
  };

  if (state === "run" && net) {
    const pinging = net.phase === "ping";
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-sm text-dim">
          {tx("Lecture seule : un ping par adresse, la demande du nom et quelques connexions TCP. Rien n'est modifié sur vos machines.")}
        </p>
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
        {net.found.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {net.found.map((h) => (
              <li key={h.ip} className="row-in flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2"><HostInfo h={h} /></li>
            ))}
          </ul>
        )}
        <div><button type="button" className={quietBtn} onClick={() => void stop()}><Square size={13} aria-hidden />{tx("Arrêter")}</button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actions}
      {toLink.length === 0 && found.length === 0 && (
        <p>{tx("Cherche les machines allumées sur votre réseau local (un seul sous-réseau /24, en lecture seule : ping, nom et quelques ports). Vous choisissez ensuite lesquelles ajouter ; rien n'est ajouté tout seul.")}</p>
      )}
      {net?.error && <p className="text-bad">⚠ {net.error}</p>}
      {net && net.phase === "done" && !net.error && (
        <p className="text-dim">
          {net.stopped ? tx("Recherche arrêtée : ") : ""}{tx("{0} machine(s) nouvelle(s) sur {1}", net.found.length, net.net ?? "")}
        </p>
      )}
      {diff && net?.phase === "done" && !net.stopped && (
        <p className="text-sm" aria-live="polite">
          {diff.fresh.size === 0 && diff.gone.length === 0
            ? <span className="text-dim">{tx("Aucun changement depuis la recherche du {0}.", dateTime((net.previous_ended ?? 0) * 1000))}</span>
            : <>
                <b className="text-txt">{tx("Depuis la recherche du {0} :", dateTime((net.previous_ended ?? 0) * 1000))}</b>{" "}
                {diff.fresh.size > 0 && <span className="text-warn">{tx("{0} nouvelle(s)", diff.fresh.size)}</span>}
                {diff.fresh.size > 0 && diff.gone.length > 0 && " · "}
                {diff.gone.length > 0 && <span className="text-bad" title={diff.gone.join(", ")}>{tx("{0} disparue(s) : {1}", diff.gone.length, diff.gone.slice(0, 4).join(", "))}{diff.gone.length > 4 ? "…" : ""}</span>}
              </>}
        </p>
      )}
      {found.length > 0 && (
        <>
          {picked.size > 0 && <p className="text-sm text-dim">{tx("{0} machine(s) pré-sélectionnée(s) : SSH, appli reconnue ou service utile. Décochez ce que vous ne voulez pas.", picked.size)}</p>}
          {useful.length > 0 && <ul className="flex flex-col gap-1.5">{renderRows(useful)}</ul>}
          {silent.length > 0 && (
            <details open={silent.some((h) => diff?.fresh.has(h.ip))} className="rounded-lg border border-line/60 px-3 py-2">
              <summary className="cursor-pointer text-sm text-muted">
                {tx("{0} appareil(s) sans service reconnu (ils répondent au ping seulement)", silent.length)}
                {silent.some((h) => diff?.fresh.has(h.ip)) && <> <Badge tone="warn">{tx("nouvelle")}</Badge></>}
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5">{renderRows(silent)}</ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={busy || picked.size === 0} onClick={() => void addPicked()}>
              <Check size={14} aria-hidden />{tx("Ajouter la sélection")} {picked.size > 0 && `(${picked.size})`}
            </button>
            <button type="button" className={quietBtn} onClick={() => setPicked(new Set(useful.map((h) => h.ip)))}>{tx("Tout sélectionner")}</button>
          </div>
        </>
      )}
      {toLink.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-txt">{tx("Machines ajoutées : accès à régler")}</p>
          {toLink.map((h) => (
            <AddedMachine key={h.ip} host={h} onDone={() => {
              setAdded((a) => { const n = { ...a }; delete n[h.ip]; return n; });
              setDismissed((d) => { const n = [...new Set([...d, h.ip])]; localStorage.setItem(DISMISSED, JSON.stringify(n)); return n; });
            }} />
          ))}
          {found.length === 0 && <p className="text-sm text-dim">{tx("Toutes les machines trouvées sont ajoutées. « Terminé » ferme un cadre ; « Refaire un scan » relance la recherche.")}</p>}
        </div>
      )}
      {later.length > 0 && (
        <p className="text-sm text-dim">
          {tx("{0} accès passé(s) : {1}.", later.length, later.map((h) => h.name || h.ip).join(", "))}{" "}
          <button type="button" className="text-link hover:underline" onClick={resumeLater}>{tx("Reprendre")}</button>
        </p>
      )}
      <div className="flex flex-col gap-2 border-t border-line/60 pt-3">
        {actions}
        {scanned && net?.ended && (
          <span className="text-sm text-dim">
            {tx("Dernier scan : {0}. À refaire de temps en temps pour voir ce qui est apparu ou disparu sur le réseau.", dateTime(net.ended * 1000))}
          </span>
        )}
      </div>
      <NoteLine note={note} />
    </div>
  );
}

/** Machine ajoutée : si elle répond en SSH, préparer l'accès (alias avec la clé de l'app), puis la commande et le test */
function AddedMachine({ host, onDone }: { host: NetHost; onDone: () => void }) {
  const ha = host.apps.includes("Home Assistant");
  const ssh = !!host.ssh_port && !ha;  // Home Assistant se relie par son API : pas de SSH proposé, même s'il répond
  const [user, setUser] = useState("root"), [cmd, setCmd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null), [ok, setOk] = useState(false);
  const label = host.name || host.ip;

  const prepare = async () => {
    setBusy(true);
    await act(async () => {
      const { alias } = await send<{ alias: string }>("POST", "machines/ssh-alias", { ip: host.ip, user, port: host.ssh_port ?? 22 });
      await send("PUT", `machines/settings/${host.ip}`, { machine: { name: label, role: host.hints.join(", "), ssh: alias }, extra: [] });
      const sys = await read<SystemState>("system");
      setCmd(sys.ssh.authorize ?? null);
    }, tx("accès SSH préparé : lancer la commande sur la machine, puis tester"), setNote);
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    const good = await act(async () => {
      const r = await send<{ failed: number }>("POST", `machines/settings/${host.ip}/check`);
      if (r.failed) throw new Error(tx("toujours illisible : {0}", label));
      await send("POST", "system/tasks/collect/run");
      pokeScan();
    }, tx("accès SSH accepté : nouveau passage de la collecte lancé"), setNote);
    setOk(good);
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-line bg-bg2/40 p-3">
      <p className="flex flex-wrap items-center gap-2">
        <Check size={14} className="text-ok" aria-hidden /><b className="text-txt">{label}</b>
        <span className="font-mono text-xs text-dim">{host.ip}</span><Badge tone="ok">{tx("ajoutée")}</Badge>
        {ssh && ok && <Badge tone="ok">{tx("SSH accepté")}</Badge>}
        <button type="button" className={`${quietBtn} ml-auto`} onClick={onDone} title={tx("Passer ou fermer ce cadre : la machine reste ajoutée, ses accès se règlent aussi plus tard (« Reprendre » ici, ou Réglages → Machines et Connecteurs)")}>
          {ssh && !ok ? tx("Passer") : tx("Terminé")}
        </button>
      </p>
      {ssh && !ok && !cmd && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-dim">{tx("Compte SSH sur cette machine")}
            <input className={`${input} w-40`} value={user} maxLength={32} onChange={(e) => setUser(e.target.value)} />
          </label>
          <button type="button" className={primary} disabled={busy || !user} onClick={() => void prepare()}>
            <KeyRound size={14} aria-hidden />{tx("Lire cette machine par SSH")}
          </button>
        </div>
      )}
      {cmd && !ok && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">{tx("Sur {0}, avec le compte {1} :", label, user)}</p>
          <Copyable text={cmd} oneLine />
          <div><button type="button" className={primary} disabled={busy} onClick={() => void test()}>{busy ? tx("Test…") : tx("Tester")}</button></div>
        </div>
      )}
      {ha && <HomeAssistantLink host={host} />}
      {!ssh && !ha && <p className="mt-1 text-sm text-dim">{tx("Pas de SSH sur cette machine : ses services web seront suivis par leur adresse.")}</p>}
      <NoteLine note={note} />
    </div>
  );
}

/** Home Assistant : pas de SSH, son API avec un jeton (connecteur « home-assistant », formulaire et aide partagés avec Réglages) */
function HomeAssistantLink({ host }: { host: NetHost }) {
  const [type, setType] = useState<ConnectorType | null>(null), [open, setOpen] = useState(true), [done, setDone] = useState(false);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {  // le formulaire (et son aide) s'ouvre d'office : c'est la suite logique de l'ajout
    void act(async () => {
      const st = await read<ConnectorsState>("connectors/settings");
      const t = st.types.find((x) => x.type === "home-assistant");
      if (!t) throw new Error(tx("connecteur Home Assistant introuvable"));
      setType(t);
    }, "", setNote);
  }, []);
  if (done) return <p className="mt-2 flex items-center gap-2 text-sm text-ok"><Check size={14} aria-hidden />{tx("Home Assistant relié par son API : première lecture en cours")}</p>;
  return (
    <div className="mt-2">
      <p className="text-sm text-muted">{tx("Home Assistant se relie par son API (adresse + jeton), pas par SSH. Un compte dédié non administrateur est recommandé.")}</p>
      {!open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={() => setOpen(true)}><Plug size={14} aria-hidden />{tx("Relier Home Assistant")}</button>
          <span className="self-center text-sm text-dim">{tx("ou plus tard : Réglages → Connecteurs")}</span>
        </div>
      )}
      {open && type && (
        <ConnectorForm type={type} prefill={{ type: "home-assistant", name: "home-assistant", url: `http://${host.ip}:8123` }}
          onDone={() => { setDone(true); void send("POST", "system/tasks/collect/run").catch(() => undefined); pokeScan(); }}
          onCancel={() => setOpen(false)} />
      )}
      <NoteLine note={note} />
    </div>
  );
}
