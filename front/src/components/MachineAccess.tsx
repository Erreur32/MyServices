// Accès d'une machine (Réglages → Machines → SSH & Agents) : l'interrupteur « Lecture par SSH », ce que cet accès permet de lire,
// la clé de l'app à autoriser, les connecteurs qui voient la machine et la source de santé lue d'abord quand un agent est aussi installé.
// Chaque interrupteur s'enregistre seul (même appel que la carte de la machine) ; la carte, elle, garde l'identité et les options.
import { ArrowRight, Check, KeyRound, Loader2, Monitor, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { LOGIN, LoginRequired, refreshSnapshot, send, type Snapshot } from "../api";
import { act, quiet, type Note } from "../lib/forms";
import { focusConnector } from "../lib/connectorPrefill";
import { tx } from "../lib/i18n";
import { mState } from "../lib/machines";
import { pokeScan } from "../lib/scan";
import type { AgentInfo, MachineConf, MachinesSettings as State } from "../types";
import { IconChoice } from "./IconChoice";
import { NoteLine, Switch } from "./form";
import { SshAccess, SshDetails } from "./ssh";
import { SshGuide } from "./SshGuide";
import { Badge, Card, Dim } from "./ui";

type Live = Snapshot["data"]["machine_list"][number];

interface Props {
  ip: string; conf: MachineConf; st: State; live?: Live; agent?: AgentInfo; windowsGuess?: boolean; sshPort?: number;
  statuses: NonNullable<Snapshot["data"]["connectors"]>;   // état des lectures SSH de la machine (Docker, services en écoute, AdGuard)
  onDone: () => void; onClose: () => void;
}

export function MachineAccess({ ip, conf, st, live, agent, windowsGuess, sshPort, statuses, onDone, onClose }: Readonly<Props>) {
  const [v, setV] = useState<MachineConf>(conf);
  const [pending, setPending] = useState(""), [flash, setFlash] = useState(""), [failed, setFailed] = useState<{ k: string; text: string } | null>(null);
  const [winGuide, setWinGuide] = useState(false), [reuse, setReuse] = useState<Note>(null);
  const windows = v.os === "windows";
  const proc = !!st.process_hosts[ip];
  const agentMode = windows || windowsGuess === true || (!!agent && !v.ssh);   // un PC Windows se lit par l'agent ; on garde le SSH s'il est déjà réglé
  const key = (windows ? v.health : v.ssh) as string | null | undefined | false;
  const sshOn = typeof key === "string" && key !== "";
  const info = st.aliases.find((a) => a.alias === key);
  const known = st.aliases.find((a) => a.ip === ip);
  const access = sshOn || !!agent, health = access && (!!agent || (!v.off && v.health !== false));
  const foundSsh = !agentMode && !sshOn && v.ssh !== false && !!live?.ssh?.alias && !!live.info;   // coupé ici, mais la collecte lit déjà par SSH
  const linked = [...new Map([...(live?.api ?? []).map((a) => [`${a.type}/${a.name}`, { type: a.type, name: a.name, label: a.label }] as const),
    ...(live?.links?.sources ?? []).filter((x) => x.ok !== false).map((x) => [`${x.source}/${x.instance}`, { type: x.source, name: x.instance, label: x.label }] as const)]).values()];
  const noDocker = access && !windows && live?.info?.docker_installed === false;   // rien à dire sur Docker : ce n'est pas un manque
  const gives: [string, boolean, string][] = [
    ...(noDocker ? [] : [["Docker", !windows && access, tx("Conteneurs, images, ports (onglet Services)")] as [string, boolean, string]]),
    [tx("Santé"), health, v.off ? tx("Souvent éteinte : la santé ne la lit pas") : tx("Disques, mémoire, CPU, systemd, mises à jour (onglet Santé)")],
    [tx("Système"), !windows && access, tx("Système, noyau, sshd, Apache (onglet Machines)")],
    ...(v.adguard ? [["AdGuard Home", !windows && access, tx("Réécritures et réponses DNS (onglet DNS)")] as [string, boolean, string]] : []),
    [tx("Services en écoute"), !windows && access && proc, tx("Ports en écoute hors Docker (option ci-dessous)")],
  ];

  // Seule cette machine est relue (SSH, Docker, santé) : les autres restent en cache, le passage est court.
  const refreshState = () => { void send("POST", `machines/settings/${ip}/refresh`).then(pokeScan, () => undefined); };
  const autoSave = async (k: string, next: Partial<MachineConf>) => {
    setPending(k); setFailed(null);
    const machine = { ...v, ...next };
    const ok = await act(() => send("PUT", `machines/settings/${ip}`, { machine, process: windows ? null : proc, extra: [] }), tx("enregistré"),
      (n) => { if (n && !n.ok) setFailed({ k, text: n.text }); });   // succès : seulement la coche animée ; erreur : message à côté du champ
    setPending("");
    if (!ok) return;
    setV(machine);
    refreshState(); onDone(); refreshSnapshot();
    setFlash(k); setTimeout(() => setFlash((f) => (f === k ? "" : f)), 1800);
  };
  const Saved = ({ k }: { k: string }) => {
    if (pending === k) return <Loader2 size={13} className="animate-spin text-dim" aria-label={tx("enregistrement…")} />;
    if (failed?.k === k) return <span className="text-xs font-semibold text-bad" role="alert">⚠ {tx("non enregistré :")} {failed.text}</span>;
    return flash === k ? <span className="saved-pop inline-flex items-center gap-1 text-xs font-semibold text-ok"><Check size={13} aria-hidden />{tx("enregistré")}</span> : null;
  };

  // Réactivation : si un accès existe déjà pour cette IP (la config SSH garde l'alias quand on coupe l'interrupteur), on le reprend et on
  // teste la clé tout de suite ; le guide ne s'ouvre que si la connexion échoue (ou s'il n'y a encore aucun accès).
  const toggleSsh = async (on: boolean) => {
    if (!on) { setWinGuide(false); setReuse(null); return void autoSave("ssh", { ssh: false, health: undefined }); }   // coupé à la main : jamais réactivé seul
    if (!known) return setWinGuide(true);   // premier accès : le guide demande le compte et crée l'alias
    await autoSave("ssh", { ssh: known.alias, health: undefined });
    try {
      const r = await send<{ lines: string[]; failed: number }>("POST", `machines/settings/${ip}/check`);
      if (r.failed) { setReuse({ ok: false, text: tx("L'accès existe mais la connexion échoue : la clé n'est pas (ou plus) autorisée sur la machine.") }); setWinGuide(true); }
      else {
        setReuse({ ok: true, text: tx("Accès rétabli : la clé est déjà valide, rien à refaire. L'état se met à jour à la fin du prochain passage.") });
        refreshState();
      }
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setReuse({ ok: false, text: (e as Error).message });
    }
  };

  const sshPills = <SshAccess alias={String(key || "")} user={info?.user} ip={info ? info.ip || info.host : null} port={info?.port} />;
  let offHint = v.ssh === false ? tx("coupé : ping et services web seulement") : tx("ping et services web seulement");
  if (foundSsh) offHint = tx("activé tout seul au prochain passage");
  return (
    <Card className="border-link/60">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 font-bold"><KeyRound size={16} aria-hidden />{tx("Accès de")} <span className="truncate">{conf.name}</span> <Dim>· {ip}</Dim></h2>
        <button type="button" className={quiet} onClick={onClose}><X size={14} aria-hidden />{tx("Fermer")}</button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {agentMode ? tx("Un petit script PowerShell sur le PC envoie sa santé à MyServices : système, disques, services, processeur, mémoire, mises à jour, journal, ports en écoute.") : tx("Permet à MyServices de lire cette machine : Docker, santé, système, Apache.")} <b className="text-txt">{tx("Lecture seule")}</b>{tx(" : rien n'y est modifié.")}
        <span className="block text-dim">{tx("Sans accès : ping et services web seulement.")}</span>
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line/60 bg-bg2/70 p-3">
          {!agentMode && (
            <label className="flex min-w-[240px] flex-1 items-center gap-3 text-sm">
              <Switch on={sshOn} disabled={pending === "ssh"} onChange={(on) => void toggleSsh(on)} label={tx("Lecture par SSH")} />
              <span><b>{sshOn ? tx("Actif") : tx("Inactif")}</b> <Saved k="ssh" />
                {sshOn ? <> <Dim>·</Dim> {sshPills}</> : <Dim> · {offHint}</Dim>}</span>
            </label>
          )}
          {foundSsh && (
            <p className="basis-full rounded-lg border border-link/40 bg-link/5 px-3 py-2 text-sm text-muted">
              {tx("La clé marche déjà avec l'accès « {0} » trouvé dans la configuration SSH (d'où « SSH OK ») : l'interrupteur passe tout seul sur Actif au prochain passage de la collecte. Pour ne pas lire cette machine par SSH, coupez-le ensuite : il ne sera plus réactivé.", live!.ssh!.alias)}
              {" "}<button type="button" className="font-semibold text-link hover:underline" disabled={pending === "ssh"} onClick={() => void toggleSsh(true)}>{tx("Activer maintenant")}</button>
            </p>
          )}
          {!agentMode && sshOn && !winGuide && live && ["refused", "nossh"].includes(mState(live)) && (
            <button type="button" className="text-xs text-link hover:underline" onClick={() => setWinGuide(true)}>{tx("La connexion échoue ? Voir les commandes")}</button>
          )}
          <ul className="flex flex-wrap items-center justify-end gap-2" aria-label={tx("Ce que cet accès permet de lire")}>
            {gives.map(([label, on, why]) => (
              <li key={label} title={why}><Badge tone={on ? "ok" : "off"}>{on ? "✓" : "–"} {label}</Badge></li>
            ))}
          </ul>
        </div>
        <NoteLine note={reuse} />
        {live && !agentMode && sshOn && (
          <div className="rounded-lg border border-line/60 bg-bg2/70 p-3">
            <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-dim">{tx("État de la connexion")}</h5>
            <SshDetails m={live} statuses={statuses} />
          </div>
        )}
        {winGuide && <SshGuide ip={ip} port={sshPort} user={known?.user} guess={windows || windowsGuess ? "windows" : "linux"} onCancel={() => setWinGuide(false)}
          onReady={(alias) => autoSave("ssh", { os: undefined, ssh: alias, health: undefined })} />}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dim/50 bg-bg2/50 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-link/15 text-link"><KeyRound size={17} aria-hidden /></span>
          <div className="min-w-[220px] flex-1">
            <b className="block text-sm text-txt">{tx("La clé de l'app doit être autorisée sur cette machine")}</b>
            <span className="block text-xs leading-relaxed text-dim">{tx("L'interrupteur prépare l'accès (compte root, port 22) ; il reste à ajouter la clé publique de l'app dans authorized_keys de la machine.")}</span>
          </div>
          <a href="#settings/ssh" className={`${quiet} no-underline`} title={tx("Ouvre la clé publique et la commande à copier")}>
            <KeyRound size={14} aria-hidden />{tx("Voir la clé SSH")}<ArrowRight size={14} aria-hidden />
          </a>
        </div>
        {linked.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line/60 bg-bg2/70 p-3 text-sm">
            <b>{tx("Connecteurs")}</b>
            {linked.map((c) => <a key={`${c.type}/${c.name}`} href="#settings/connectors" onClick={() => focusConnector(c.type, c.name)} title={tx("Ouvrir ce connecteur")}
              className="rounded-full border border-link/60 px-2 py-0.5 text-xs font-semibold text-link hover:bg-link/10">{c.label}</a>)}
          </div>
        )}
        {agent && sshOn && (
          <div className="flex flex-col gap-2 rounded-lg border border-line/60 bg-bg2/70 p-3">
            <div className="flex flex-wrap items-center gap-2"><b>{tx("Lu d'abord par")}</b> <Saved k="health_sources" /></div>
            <IconChoice label={tx("Santé lue d'abord par")} disabled={pending === "health_sources"} value={((v.health_sources as string[] | undefined)?.[0] ?? "") as "" | "ssh" | "agent"}
              onPick={(src) => void autoSave("health_sources", { health_sources: src ? [src] : undefined })}
              options={[
                { value: "", label: tx("Automatique"), hint: windows ? tx("Automatique (l'agent, puis SSH)") : tx("Automatique (SSH, puis l'agent)"), icon: <Sparkles size={24} className="text-link" aria-hidden /> },
                { value: "ssh", label: "SSH", hint: tx("Lire d'abord par SSH"), icon: <KeyRound size={24} className="text-ok" aria-hidden /> },
                { value: "agent", label: tx("L'agent"), hint: tx("Lire d'abord par l'agent MyServices"), icon: <Monitor size={24} className="text-warn" aria-hidden /> },
              ]} />
            <Dim>{tx("la première source qui répond fait foi, l'autre prend le relais si elle se tait et complète ce qui manque")}</Dim>
          </div>
        )}
      </div>
    </Card>
  );
}
