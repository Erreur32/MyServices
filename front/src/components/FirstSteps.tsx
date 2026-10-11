// Accueil d'une installation neuve : les étapes du premier démarrage, de ce que MyServices a trouvé sans rien
// demander (ports de l'hôte, Docker) jusqu'à la clé SSH qui donne le relevé exact. Les étapes se mettent à jour en
// direct pendant le scan ; la carte reste jusqu'à ce qu'on la ferme (retenu par navigateur et par clé de l'app :
// une installation remise à zéro la rouvre).
import { ArrowRight, Bell, Check, ChevronRight, Circle, Compass, HardDrive, LifeBuoy, Loader2, Plug, Plus, RotateCcw, Rocket, X, type LucideIcon } from "lucide-react";
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
import { FOLD, FOLD_HEAD, NetworkStep } from "./NetworkStep";
import { Badge, Count, type Tone } from "./ui";
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

/** "What next" cards: where to go, and in one line what it brings and what to expect there */
const NEXT: { href: string; Icon: LucideIcon; title: string; text: string }[] = [
  { href: "#settings/connectors", Icon: Plug, title: tx("Relier mes outils"), text: tx("Nginx Proxy Manager, AdGuard, Home Assistant, Proxmox… : leurs données (certificats, DNS, sauvegardes) s'ajoutent à la page. Une clé ou un compte en lecture seule suffit.") },
  { href: "#settings/alerts", Icon: Bell, title: tx("Être prévenu"), text: tx("Un message Discord, Telegram ou un webhook quand une machine tombe, qu'une sauvegarde est en retard ou qu'un service disparaît.") },
  { href: "#settings/backups", Icon: HardDrive, title: tx("Mes sauvegardes"), text: tx("Dossiers de sauvegarde, jobs Veeam, groupes Proxmox Backup : vous fixez l'âge au-delà duquel une alerte part.") },
  { href: "#settings/help", Icon: LifeBuoy, title: tx("Lire l'aide"), text: tx("Comment MyServices lit votre réseau, les bons réflexes, et quoi faire quand quelque chose ne marche pas.") },
];

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

/** Folded frame under the proposed connectors: every tool MyServices can read, one click opens its form. Folded by default and says so, because a tool
 *  may well run on another machine than this one, so nothing proposed above does not mean nothing to link. */
function AllConnectors({ tools }: { tools: { type: string; label: string }[] }) {
  if (!tools.length) return null;
  return (
    <details className={`${FOLD} mt-3 [&>:not(summary)]:mx-3 [&>:last-child]:mb-3`}>
      <summary className={FOLD_HEAD}>
        <ChevronRight size={16} className="shrink-0 text-link transition-transform group-open:rotate-90" aria-hidden />
        <Plug size={15} className="shrink-0 text-link" aria-hidden />
        {tx("Tous les connecteurs disponibles")} <Count n={tools.length} tone="off" />
        <span className="font-normal text-dim">· {tx("replié : cliquez pour ouvrir ou refermer la liste")}</span>
      </summary>
      <p className="text-xs text-dim">
        {tx("Un outil peut tourner sur une autre machine que celle-ci : MyServices ne l'a alors pas reconnu ici. Choisissez-le dans cette liste pour le relier quand même (son adresse et un jeton ou un compte en lecture seule suffisent).")}{" "}
        <b className="text-muted">{tx("Rien n'est obligatoire maintenant : vous pourrez le faire plus tard, à tout moment, dans Réglages → Connecteurs.")}</b>
      </p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => {
          const logo = appIcon([t.label]);
          return (
            <li key={t.type}>
              <button type="button" onClick={() => openConnector({ type: t.type, name: t.type, url: "" })} title={tx("Relier {0}", t.label)}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-bg2/60 px-2.5 py-1.5 text-left text-sm text-txt transition-colors hover:border-link hover:bg-link/10">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-card">{logo ? <img src={logo} alt="" className="h-4 w-4" /> : <Plug size={13} className="text-muted" aria-hidden />}</span>
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                <Plus size={13} className="shrink-0 text-dim" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Session flag: a fresh install lands on the setup page once; after that the home page only shows a banner */
const LANDED = "myservices-setup-landed";

/** page = the standalone setup page (#setup); otherwise the home page, where only a banner points to it */
export function FirstSteps({ snap, page = false }: { snap: Snapshot; page?: boolean }) {
  const [sys, setSys] = useState<SystemState | null>(null);
  const [tools, setTools] = useState<{ type: string; label: string }[]>([]);   // every tool MyServices can read, for the folded list under the connectors step
  const [, bump] = useState(0);
  const [acceptedGen, setAcceptedGen] = useState<string | null>(null); // relevé de data.json au moment où la clé a été acceptée
  const scan = useScan();
  const { net, reload: reloadNet } = useNetScan();
  const admin = snap.me.role === "admin";
  useEffect(() => { if (admin) read<SystemState>("system").then(setSys).catch(() => undefined); }, [admin]);
  useEffect(() => { if (admin) read<ConnectorsState>("connectors/settings").then((c) => setTools(c.types.filter((t) => !t.kinds.includes("alerts")).map((t) => ({ type: t.type, label: t.label })))).catch(() => undefined); }, [admin]);

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
  const active = admin && !!sys && (saved === "open" || (failing.length > 0 && saved !== "closed"));
  useEffect(() => {
    if (page || !active || sessionStorage.getItem(LANDED)) return;
    sessionStorage.setItem(LANDED, "1");
    location.hash = "setup";
  }, [page, active]);
  if (!active) {
    if (!page || !sys) return page ? <p className="p-8 text-muted">{tx("Chargement…")}</p> : null;
    return (
      <section className="rounded-2xl border border-line bg-card p-8 text-center">
        <p className="text-lg font-semibold">{tx("Les premiers pas sont terminés.")}</p>
        <p className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <a className={primary} href="#">{tx("Aller au tableau de bord")}</a>
          <button type="button" className={`${button} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`} onClick={() => { saveState(fp, "open"); bump((n) => n + 1); }}>{tx("Les rouvrir")}</button>
        </p>
      </section>
    );
  }

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
  const close = () => { saveState(fp, "closed"); bump((n) => n + 1); if (page) location.hash = ""; };
  if (!page)
    return (
      <a href="#setup" className={`flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-5 py-3.5 no-underline shadow-sm transition-colors hover:border-link ${finished ? "border-ok/50" : "border-warn/50"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2"><Rocket size={20} className={finished ? "text-ok" : "text-warn"} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-lg leading-tight text-txt">{tx("Premiers pas")}</b>
          <span className="text-sm text-muted">{finished ? tx("Presque fini : il reste à relier vos outils.") : tx("L'installation n'est pas terminée.")}</span>
        </span>
        <span className="font-mono text-sm font-bold text-txt">{doneCount}/{total}</span>
        <span className={`${primary} pointer-events-none`}>{tx("Continuer")}<ArrowRight size={14} aria-hidden /></span>
      </a>
    );
  return (
    <section className={`relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors duration-700 ${finished ? "border-ok/50" : "border-warn/50"}`}>
      <header className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${finished ? "bg-ok/10" : "bg-warn/10"}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg2"><Rocket size={20} className={finished ? "text-ok" : "text-warn"} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight">{tx("Premiers pas")}</h2>
          <p className="text-sm text-muted">
            {finished
              ? tx("Vos machines et vos conteneurs sont lus. Reste à relier vos outils.")
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
                <p className="mt-1 font-semibold text-ok">{tx("Rien à faire pour l'instant : tout est en ordre.")}</p>
              </>}
          <AllConnectors tools={tools} />
        </Step>
      </ol>
      <div className="mt-5 border-t border-line/70 pt-4">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold"><Compass size={15} className="text-link" aria-hidden />{tx("Et ensuite ?")}
          <span className="text-xs font-normal text-dim">{tx("Rien d'obligatoire : chaque point se fait quand vous voulez, ici ou plus tard dans les Réglages.")}</span></h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {NEXT.map(({ href, Icon, title, text }) => (
            <li key={href}>
              <a href={href} className="group/n flex h-full flex-col gap-1 rounded-xl border border-line bg-bg2/50 p-3 no-underline transition-colors hover:border-link hover:bg-link/10">
                <span className="flex items-center gap-2 text-sm font-semibold text-txt">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-link/10 text-link"><Icon size={15} aria-hidden /></span>{title}
                  <ArrowRight size={13} className="ml-auto shrink-0 text-dim transition-transform group-hover/n:translate-x-0.5 group-hover/n:text-link" aria-hidden />
                </span>
                <span className="text-xs leading-snug text-muted">{text}</span>
              </a>
            </li>
          ))}
        </ul>
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
