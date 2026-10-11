// Accueil d'une installation neuve : les étapes du premier démarrage, de ce que MyServices a trouvé sans rien
// demander (ports de l'hôte, Docker) jusqu'à la clé SSH qui donne le relevé exact. Les étapes se mettent à jour en
// direct pendant le scan ; la carte reste jusqu'à ce qu'on la ferme (retenu par navigateur et par clé de l'app :
// une installation remise à zéro la rouvre).
import { ArrowRight, Check, Circle, LifeBuoy, Loader2, Plug, RotateCcw, Rocket, X } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import type { Snapshot } from "../api";
import { appIcon } from "../lib/appIcons";
import { openConnector } from "../lib/connectorPrefill";
import { REOPEN_EVENT, savedState, saveState, setSkipped, skippedSteps, takeReopen, type StepId } from "../lib/firstSteps";
import { tx } from "../lib/i18n";
import { useScan } from "../lib/scan";
import { plural } from "../lib/summary";
import type { ConnectorsState, Proposal, SystemState } from "../types";
import { netState, useNetScan } from "../lib/netScan";
import { AuthorizeKey } from "./AuthorizeKey";
import { SkipButton } from "./SkipButton";
import { NetworkStep } from "./NetworkStep";
import { Badge, type Tone } from "./ui";
import { button, primary } from "../lib/forms";

type State = "done" | "now" | "run" | "next" | "soon";

/** done : acquis ; now : la seule étape qui demande une action (mise en avant) ; run : en cours ;
 *  next : suite directe ; soon : pas encore codé */
function Step({ state, title, children, onSkip, skipped, onResume }: {
  state: State; title: string; children?: React.ReactNode;
  onSkip?: () => void;      // « Passer » button: the step stays doable later
  skipped?: boolean;        // skipped step: folded, with « Reprendre »
  onResume?: () => void;
}) {
  const Icon = state === "done" ? Check : state === "now" ? ArrowRight : state === "run" ? Loader2 : Circle;
  const dot = state === "done" ? "border-ok/50 bg-ok/15 text-ok" : state === "now" ? "border-warn/60 bg-warn/15 text-warn" : state === "run" ? "border-link/60 bg-link/15 text-link" : "border-line bg-bg2 text-dim";
  const card = state === "now" ? "border-warn/40 bg-warn/5 p-3 sm:p-4" : state === "run" ? "border-link/40 bg-link/5 p-3 sm:p-4" : "border-transparent py-1.5";
  return (
    <li className="group relative flex gap-3" aria-current={state === "now" || state === "run" ? "step" : undefined}>
      <span aria-hidden className="absolute bottom-[-0.75rem] left-[17px] top-9 w-px bg-line group-last:hidden" />
      <span key={state} className={`step-pop z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border ${dot}`}>
        <Icon size={17} aria-hidden className={state === "run" ? "animate-spin" : undefined} />
      </span>
      <div className={`min-w-0 flex-1 rounded-xl border transition-colors duration-500 ${card} ${state === "soon" ? "opacity-70" : ""}`}>
        <h3 className={`flex min-h-[1.5rem] flex-wrap items-center gap-2 text-sm font-bold ${state === "next" || state === "soon" || skipped ? "text-muted" : ""}`}>
          {title}{state === "soon" && <Badge tone="off">{tx("À venir")}</Badge>}
          {skipped && <Badge tone="off">{tx("passée")}</Badge>}
          {skipped && onResume && (
            <button type="button" className="inline-flex items-center gap-1 rounded-full border border-link/60 bg-link/10 px-2.5 py-0.5 text-xs font-semibold text-link hover:bg-link/20" onClick={onResume}>
              <RotateCcw size={12} aria-hidden />{tx("Reprendre")}
            </button>
          )}
          {!skipped && onSkip && <SkipButton onClick={onSkip} onDark={state === "now" || state === "run"} className="ml-auto" />}
        </h3>
        {children && !skipped && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
    </li>
  );
}

const HOW: Record<Proposal["confidence"], Tone> = { sure: "ok", probable: "info", possible: "off" };

function Proposals({ list }: { list: Proposal[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {list.map((p) => {
        const how = p.confidence === "sure" ? tx("conteneur reconnu") : p.confidence === "probable" ? tx("page reconnue") : tx("à vérifier");
        return (
          <li key={`${p.connector}/${p.ip}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2">
            <b className="text-txt">{p.label}</b>
            <Badge tone="info">{p.machine || p.ip}</Badge>
            <span className="font-mono text-xs text-dim">{p.ip}{p.port ? `:${p.port}` : ""}</span>
            <Badge tone={HOW[p.confidence]}>{how}</Badge>
            <button type="button" className={`${p.confidence === "possible" ? button + " border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10" : primary} ml-auto`}
              onClick={() => openConnector({ type: p.connector, name: p.connector, url: p.url })}>
              {tx("Configurer")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FirstSteps({ snap }: { snap: Snapshot }) {
  const [sys, setSys] = useState<SystemState | null>(null);
  const [tools, setTools] = useState<string[]>([]);   // every tool MyServices can read (connector labels), for the last step
  const [, bump] = useState(0);
  const [acceptedGen, setAcceptedGen] = useState<string | null>(null); // relevé de data.json au moment où la clé a été acceptée
  const scan = useScan();
  const { net, reload: reloadNet } = useNetScan();
  const admin = snap.me.role === "admin";
  useEffect(() => { if (admin) read<SystemState>("system").then(setSys).catch(() => undefined); }, [admin]);
  useEffect(() => { if (admin) read<ConnectorsState>("connectors/settings").then((c) => setTools(c.types.map((t) => t.label))).catch(() => undefined); }, [admin]);

  const failing = (snap.data.connectors || []).filter((c) => c.type === "docker" && !c.ok);
  const fp = sys?.ssh.fingerprint || sys?.ssh.public || "app";
  const saved = savedState(fp);
  useEffect(() => { if (sys && failing.length && !saved) saveState(fp, "open"); }, [sys, failing.length, saved, fp]);
  useEffect(() => {
    const reopen = () => { if (sys && takeReopen()) { saveState(fp, "open"); bump((n) => n + 1); } };
    reopen();
    addEventListener(REOPEN_EVENT, reopen);
    return () => removeEventListener(REOPEN_EVENT, reopen);
  }, [sys, fp]);
  const skipped = skippedSteps(fp);
  const skip = (id: StepId) => { setSkipped(fp, id, true); bump((n) => n + 1); };
  const resume = (id: StepId) => { setSkipped(fp, id, false); bump((n) => n + 1); };
  if (!admin || !sys || !(saved === "open" || (failing.length > 0 && saved !== "closed"))) return null;

  // Clé acceptée : la carte le montre tout de suite, sans attendre la fin du scan. Si le scan se termine et que
  // Docker reste illisible, l'étape se rouvre.
  const accepted = acceptedGen !== null && (snap.data.generated === acceptedGen || !failing.length);
  const keyDone = !failing.length || accepted;
  const running = !!scan?.running;
  const finished = keyDone && !running && !failing.length;
  const reopened = acceptedGen !== null && !accepted;
  const proposals = snap.data.proposals ?? [];
  const host = snap.data.machine_list.find((m) => m.local) || snap.data.machine_list[0];
  const docker = sys.host_docker;
  // Services reconnus sur l'hôte (applis nommées par le scan des ports, serveurs web vus par SSH), Docker mis à part
  const onHost = [...new Set([
    ...(host ? snap.data.hosts.filter((h) => h.machine === host.name && h.app).map((h) => h.app!.label) : []),
    ...(host?.info?.apache ? ["Apache"] : []), ...(host?.info?.nginx ? ["Nginx"] : []),
  ])].filter((a) => a !== "Docker");
  const readable = (snap.data.connectors || []).filter((c) => c.type === "docker" && c.ok);
  const p = scan?.progress;
  const containers = readable.reduce((n, c) => n + (Number(/\d+/.exec(c.message)?.[0]) || 0), 0);  // « 47 conteneurs » -> 47
  const linked = [...new Set((snap.data.services_status ?? []).map((s) => s.label))];

  const sRelev: State = !keyDone ? "next" : finished ? "done" : "run";
  const sConn: State = !proposals.length && linked.length ? "done" : keyDone && proposals.length && !skipped.includes("connectors") ? "now" : "next";
  const doneCount = 2 + (keyDone ? 1 : 0) + (sRelev === "done" ? 1 : 0) + (sConn === "done" ? 1 : 0);   // account and host are always done; the network search is optional
  const total = 6;
  const close = () => { saveState(fp, "closed"); bump((n) => n + 1); };
  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors duration-700 ${finished ? "border-ok/50" : "border-warn/50"}`}>
      <header className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${finished ? "bg-ok/10" : "bg-warn/10"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2"><Rocket size={20} className={finished ? "text-ok" : "text-warn"} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight">{tx("Premiers pas")}</h2>
          <p className="text-sm text-muted">
            {finished
              ? tx("C'est bon : MyServices lit vos conteneurs et vos machines. Il reste à relier vos outils, puis à régler alertes et sauvegardes.")
              : tx("MyServices a déjà trouvé des services. Pour être complet, il faudrait une clé SSH. Pas de panique, c'est simple !")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2" title={tx("{0} étapes sur {1} faites", doneCount, total)}>
          <span className="font-mono text-sm font-bold text-txt">{doneCount}/{total}</span>
          <span className="h-2 w-24 overflow-hidden rounded-full bg-bg2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label={tx("Avancement des premiers pas")}>
            <span className={`block h-full rounded-full transition-all duration-700 ${finished ? "bg-ok" : "bg-warn"}`} style={{ width: `${(100 * doneCount) / total}%` }} />
          </span>
          <button type="button" aria-label={tx("Fermer")} title={tx("Fermer")} onClick={close}
            className="rounded-lg p-1.5 text-dim hover:bg-bg2 hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-link">
            <X size={18} aria-hidden />
          </button>
        </div>
      </header>
      <div className="p-5">
      <ol className="flex flex-col gap-3">
        <Step state="done" title={tx("Compte administrateur créé")} />
        <Step state="done" title={tx("Machine hôte détectée")}>
          {host && (
            // The machine, what was found on it and Docker (logo + name) all sit on one line, wrapping only when the screen is narrow
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <Badge tone="info">{host.name}</Badge>
              <b className="text-txt">{plural(host.services, "service trouvé", "services trouvés")}</b>
              {onHost.map((a) => {
                const src = appIcon([a]);
                return <span key={a} title={a} className="inline-flex items-center gap-1 text-xs text-muted">{src && <img src={src} alt="" aria-hidden className="h-5 w-5 object-contain" />}{a}</span>;
              })}
              {docker?.present && (
                <Badge tone="info" title={tx("Docker est présent sur l'hôte")}>
                  {appIcon(["Docker"]) && <img src={appIcon(["Docker"])!} alt="" aria-hidden className="mr-1 h-4 w-4 object-contain" />}Docker
                </Badge>
              )}
              {docker?.present && !keyDone && <Badge tone="off">≈ {plural(docker.containers, "conteneur")}</Badge>}
              {docker?.present && !keyDone && <Badge tone="off">{plural(docker.networks, "réseau", "réseaux")}</Badge>}
            </p>
          )}
          {docker?.present && !keyDone && <p className="mt-1 text-xs text-dim">{tx("Conteneur ou installation native : à confirmer avec la clé SSH.")}</p>}
        </Step>
        {keyDone ? (
          <Step state="done" title={tx("Clé SSH de MyServices autorisée")} />
        ) : (
          <Step state={skipped.includes("key") ? "next" : "now"} title={tx("Autoriser la clé SSH de MyServices")}
            onSkip={() => skip("key")} skipped={skipped.includes("key")} onResume={() => resume("key")}>
            {reopened && <p className="mb-2 text-warn">{tx("La clé répond, mais Docker reste illisible après le scan : vérifier que le compte est dans le groupe docker.")}</p>}
            <AuthorizeKey failing={failing} bare onAccepted={() => setAcceptedGen(snap.data.generated)} />
          </Step>
        )}
        <Step state={sRelev} title={tx("Relevé exact de Docker, des process et de la santé")}>
          {!keyDone && tx("Une fois la clé acceptée, la collecte repart seule et remplace les estimations ci-dessus.")}
          {keyDone && !finished && (
            <p aria-live="polite">
              {p ? <><span className="tabular-nums text-dim">{p.step}/{p.steps}</span> {p.label}{p.total ? ` (${p.done ?? 0}/${p.total})` : ""}</> : tx("démarrage…")}
            </p>
          )}
          {finished && (
            <p className="flex flex-wrap items-center gap-1.5">
              {tx("Docker lu exactement, par machine :")}
              {readable.map((c) => (
                <Badge key={c.name} tone="ok" title={tx("{0} : {1}, lus par SSH à la place de l'estimation", c.name, c.message)}>
                  <img src={appIcon(["Docker"]) ?? ""} alt="" aria-hidden className="h-4 w-4 object-contain" />{c.name} · {c.message}
                </Badge>
              ))}
            </p>
          )}
        </Step>
        <Step state={skipped.includes("network") ? "next" : netState(net) === "run" ? "run" : netState(net) === "found" ? "now" : "next"}
          title={tx("Recherche des autres machines du réseau")}
          skipped={skipped.includes("network")} onResume={() => resume("network")}>
          <NetworkStep net={net} reload={reloadNet} machines={snap.data.machine_list} connected={snap.data.services_status ?? []} onSkip={() => skip("network")} />
        </Step>
        <Step state={sConn} title={tx("Connecteurs proposés d'après ce qui est trouvé")}
          onSkip={proposals.length ? () => skip("connectors") : undefined} skipped={skipped.includes("connectors") && proposals.length > 0}
          onResume={() => resume("connectors")}>
          {proposals.length > 0
            ? <><p className="mb-2">{tx("MyServices a reconnu des applis qu'il sait lire par leur API. Un connecteur ajoute leurs données (certificats, DNS, santé) sans rien recoder.")}</p><Proposals list={proposals} /><p className="mt-2"><a className="font-semibold text-link hover:underline" href="#settings/connectors">{tx("Tout voir dans Réglages → Connecteurs")}</a></p></>
            : <>
                <p>
                  {tx("Aucune autre appli à relier")}{containers > 0 && ` ${tx("({0} conteneurs examinés)", containers)}`}.
                </p>
                {linked.length > 0 && <p className="mt-1 text-ok">{tx("Déjà reliés : {0}.", linked.join(", "))}</p>}
                {tools.length > 0 && (
                  <p className="mt-1 text-dim">
                    {tx("MyServices sait lire {0} outils, par exemple :", tools.length)} {tools.slice(0, 8).join(", ")}…{" "}
                    <a className="font-semibold text-link hover:underline" href="#settings/connectors">{tx("Voir tous les connecteurs")}</a>
                  </p>
                )}
                <p className="mt-1 font-semibold text-ok">{tx("Rien à faire pour l'instant : tout est en ordre.")}</p>
              </>}
        </Step>
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line/70 pt-4">
        <span className="mr-1 text-xs font-bold uppercase tracking-wider text-dim">{tx("Ensuite")}</span>
        <a className={`${button} border-txt/30 bg-bg2 text-txt no-underline hover:border-link hover:bg-link/10`} href="#settings/connectors"><Plug size={14} aria-hidden />{tx("Relier mes outils")}</a>
        <a className={`${button} border-txt/30 bg-bg2 text-txt no-underline hover:border-link hover:bg-link/10`} href="#settings/alerts"><ArrowRight size={14} aria-hidden />{tx("Être prévenu")}</a>
        <a className={`${button} border-txt/30 bg-bg2 text-txt no-underline hover:border-link hover:bg-link/10`} href="#settings/backups"><ArrowRight size={14} aria-hidden />{tx("Suivre mes sauvegardes")}</a>
        <a className={`${button} border-txt/30 bg-bg2 text-txt no-underline hover:border-link hover:bg-link/10`} href="#settings/help"><LifeBuoy size={14} aria-hidden />{tx("Lire l'aide")}</a>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={finished ? primary : `${button} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`} onClick={close}>
          <Check size={14} aria-hidden />{tx("Terminer les premiers pas")}
        </button>
        <span className="text-sm text-dim">{tx("Cette carte reste ouverte tant que vous ne la fermez pas. Menu du compte -> « Revoir les premiers pas » pour la rouvrir.")}</span>
      </div>
      </div>
    </section>
  );
}
