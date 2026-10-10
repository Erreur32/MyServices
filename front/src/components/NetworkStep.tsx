// Étape « Recherche des autres machines du réseau » de Premiers pas : lancer la recherche, choisir les machines à
// ajouter, puis, pour celles qui répondent en SSH, préparer l'accès (alias + commande à autoriser + test).
// Lecture seule sur le réseau ; rien n'est ajouté sans que l'admin le demande.
import { Check, KeyRound, Loader2, Search, Square } from "lucide-react";
import { useState } from "react";
import { read, send } from "../api";
import { act, button, input, primary, type Note } from "../lib/forms";
import { tx } from "../lib/i18n";
import { netState } from "../lib/netScan";
import { pokeScan } from "../lib/scan";
import type { NetHost, NetScan, SystemState } from "../types";
import { Copyable, NoteLine } from "./form";
import { Badge } from "./ui";

const quietBtn = `${button} border-line text-muted hover:border-link hover:text-txt`;

export function NetworkStep({ net, reload }: { net: NetScan | null; reload: () => void }) {
  const [note, setNote] = useState<Note>(null), [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, NetHost>>({});
  const state = netState(net);

  const start = async () => {
    setBusy(true);
    await act(async () => { await send("POST", "network/scan"); pokeScan(); reload(); }, tx("recherche lancée"), setNote);
    setBusy(false);
  };
  const stop = async () => { await send("POST", "network/scan/stop"); reload(); };

  const toggle = (ip: string) => setPicked((p) => { const n = new Set(p); if (n.has(ip)) n.delete(ip); else n.add(ip); return n; });
  const found = (net?.found ?? []).filter((h) => !added[h.ip]);

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

  if (state === "run" && net)
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />
          {tx("{0}/{1} adresses testées, {2} machine(s) trouvée(s)", net.done, net.total, net.found.length)}
          <span className="font-mono text-xs text-dim">{net.net}</span>
        </p>
        <div><button type="button" className={quietBtn} onClick={() => void stop()}><Square size={13} aria-hidden />{tx("Arrêter")}</button></div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {Object.keys(added).length === 0 && found.length === 0 && (
        <p>{tx("Cherche les machines allumées sur votre réseau local (un seul sous-réseau /24, en lecture seule : ping, nom et quelques ports). Vous choisissez ensuite lesquelles ajouter ; rien n'est ajouté tout seul.")}</p>
      )}
      {net?.error && <p className="text-bad">⚠ {net.error}</p>}
      {net && net.phase === "done" && !net.error && (
        <p className="text-dim">
          {net.stopped ? tx("Recherche arrêtée : ") : ""}{tx("{0} machine(s) nouvelle(s) sur {1}", net.found.length, net.net ?? "")}
        </p>
      )}
      {found.length > 0 && (
        <>
          <ul className="flex flex-col gap-1.5">
            {found.map((h) => (
              <li key={h.ip}>
                <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2 hover:bg-bg2">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--link))]" checked={picked.has(h.ip)} onChange={() => toggle(h.ip)} />
                  <b className="text-txt">{h.name || h.ip}</b>
                  <span className="font-mono text-xs text-dim">{h.ip}</span>
                  {h.hints.map((x) => <Badge key={x} tone={x === "SSH" ? "ok" : "off"}>{x}</Badge>)}
                  {h.apps.map((x) => <Badge key={x} tone="info">{x}</Badge>)}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={busy || picked.size === 0} onClick={() => void addPicked()}>
              <Check size={14} aria-hidden />{tx("Ajouter la sélection")} {picked.size > 0 && `(${picked.size})`}
            </button>
            <button type="button" className={quietBtn} onClick={() => setPicked(new Set(found.map((h) => h.ip)))}>{tx("Tout sélectionner")}</button>
          </div>
        </>
      )}
      {Object.values(added).map((h) => <AddedMachine key={h.ip} host={h} />)}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={state === "found" || Object.keys(added).length ? quietBtn : primary} disabled={busy} onClick={() => void start()}>
          <Search size={14} aria-hidden />{net && net.phase === "done" ? tx("Relancer la recherche") : tx("Lancer la recherche")}
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  );
}

/** Machine ajoutée : si elle répond en SSH, préparer l'accès (alias avec la clé de l'app), puis la commande et le test */
function AddedMachine({ host }: { host: NetHost }) {
  const ssh = host.ports.includes(22);
  const [user, setUser] = useState("root"), [cmd, setCmd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [note, setNote] = useState<Note>(null), [ok, setOk] = useState(false);
  const label = host.name || host.ip;

  const prepare = async () => {
    setBusy(true);
    await act(async () => {
      const { alias } = await send<{ alias: string }>("POST", "machines/ssh-alias", { ip: host.ip, user, port: 22 });
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
      {!ssh && <p className="mt-1 text-sm text-dim">{tx("Pas de SSH sur cette machine : ses services web seront suivis par leur adresse.")}</p>}
      <NoteLine note={note} />
    </div>
  );
}
