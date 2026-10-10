// Accueil d'une installation neuve : les étapes du premier démarrage, de ce que MyServices a trouvé sans rien
// demander (ports de l'hôte, Docker) jusqu'à la clé SSH qui donne le relevé exact. Les étapes se mettent à jour en
// direct pendant le scan ; la carte reste jusqu'à ce qu'on la ferme (retenu par navigateur et par clé de l'app :
// une installation remise à zéro la rouvre).
import { ArrowRight, Check, Circle, KeyRound, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import type { Snapshot } from "../api";
import { openConnector } from "../lib/connectorPrefill";
import { REOPEN_EVENT, savedState, saveState, setSkipped, skippedSteps, takeReopen, type StepId } from "../lib/firstSteps";
import { tx } from "../lib/i18n";
import { useScan } from "../lib/scan";
import { plural } from "../lib/summary";
import type { Proposal, SystemState } from "../types";
import { netState, useNetScan } from "../lib/netScan";
import { AuthorizeKey } from "./AuthorizeKey";
import { NetworkStep } from "./NetworkStep";
import { Badge, type Tone } from "./ui";
import { button, primary } from "../lib/forms";

type State = "done" | "now" | "run" | "next" | "soon";

/** done : acquis ; now : la seule étape qui demande une action (mise en avant) ; run : en cours ;
 *  next : suite directe ; soon : pas encore codé */
function Step({ state, title, children, onSkip, skipped, onResume }: {
  state: State; title: string; children?: React.ReactNode;
  onSkip?: () => void;      // bouton « Passer » : l'étape reste faisable plus tard
  skipped?: boolean;        // étape passée : repliée, avec « Reprendre »
  onResume?: () => void;
}) {
  const Icon = state === "done" ? Check : state === "now" ? ArrowRight : state === "run" ? Loader2 : Circle;
  const tone = state === "done" ? "text-ok" : state === "now" ? "text-warn" : state === "run" ? "text-link" : "text-dim";
  const box = state === "now" ? "border-warn/40 bg-bg2/60 p-3 sm:p-4" : state === "run" ? "border-link/40 bg-bg2/60 p-3 sm:p-4" : "border-transparent";
  return (
    <li className={`flex gap-3 rounded-xl border transition-colors duration-500 ${box} ${state === "soon" ? "opacity-70" : ""}`}
      aria-current={state === "now" || state === "run" ? "step" : undefined}>
      <span key={state} className={`step-pop mt-0.5 shrink-0 ${tone}`}>
        <Icon size={18} aria-hidden className={state === "run" ? "animate-spin" : undefined} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className={`flex flex-wrap items-center gap-2 text-sm font-bold ${state === "next" || state === "soon" || skipped ? "text-muted" : ""}`}>
          {title}{state === "soon" && <Badge tone="off">{tx("À venir")}</Badge>}
          {skipped && <Badge tone="off">{tx("passée")}</Badge>}
          {skipped && onResume && <button type="button" className="text-xs font-normal text-link hover:underline" onClick={onResume}>{tx("Reprendre")}</button>}
          {!skipped && onSkip && (
            <button type="button" className="ml-auto rounded-md px-2 py-0.5 text-xs font-normal text-dim hover:bg-bg2 hover:text-txt" onClick={onSkip}
              title={tx("Passer cette étape : vous pourrez la refaire plus tard, ici ou dans les Réglages")}>{tx("Passer")}</button>
          )}
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
            <button type="button" className={`${p.confidence === "possible" ? button + " border-line text-muted hover:border-link hover:text-txt" : primary} ml-auto`}
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
  const [, bump] = useState(0);
  const [acceptedGen, setAcceptedGen] = useState<string | null>(null); // relevé de data.json au moment où la clé a été acceptée
  const scan = useScan();
  const { net, reload: reloadNet } = useNetScan();
  const admin = snap.me.role === "admin";
  useEffect(() => { if (admin) read<SystemState>("system").then(setSys).catch(() => undefined); }, [admin]);

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
  const readable = (snap.data.connectors || []).filter((c) => c.type === "docker" && c.ok);
  const p = scan?.progress;

  const close = () => { saveState(fp, "closed"); bump((n) => n + 1); };
  return (
    <section className={`relative rounded-2xl border bg-card p-5 transition-colors duration-700 ${finished ? "border-ok/50" : "border-warn/50"}`}>
      <button type="button" aria-label={tx("Fermer")} title={tx("Fermer")}
        onClick={close}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-dim hover:bg-bg2 hover:text-txt focus-visible:outline focus-visible:outline-2 focus-visible:outline-link">
        <X size={18} aria-hidden />
      </button>
      <h2 className="mb-1 flex items-center gap-2 pr-8 text-lg font-bold"><KeyRound size={18} />{tx("Premiers pas")}</h2>
      <p className="mb-4 pr-8 text-sm text-muted">
        {finished
          ? tx("C'est bon : MyServices lit maintenant vos conteneurs. Les étapes suivantes arrivent avec la détection des applications.")
          : tx("MyServices a déjà trouvé des services. Pour être complet, il faudrait une clé SSH. Pas de panique, c'est simple !")}
      </p>
      <ol className="flex flex-col gap-3">
        <Step state="done" title={tx("Compte administrateur créé")} />
        <Step state="done" title={tx("Machine hôte détectée")}>
          {host && (
            <p className="flex flex-wrap items-center gap-1.5">
              <Badge tone="info">{host.name}</Badge>
              <b className="text-txt">{plural(host.services, "service trouvé", "services trouvés")}</b>
              {tx("par leurs ports en écoute, nommés d'après leur page web.")}
            </p>
          )}
          {docker?.present && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="info">Docker</Badge>
              <b className="text-txt">{tx("présent sur l'hôte")}</b>
              {!keyDone && <Badge tone="off">≈ {plural(docker.containers, "conteneur")}</Badge>}
              {!keyDone && <Badge tone="off">{plural(docker.networks, "réseau", "réseaux")}</Badge>}
              {!keyDone && tx("Conteneur ou installation native : à confirmer avec la clé SSH.")}
            </p>
          )}
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
        <Step state={!keyDone ? "next" : finished ? "done" : "run"} title={tx("Relevé exact de Docker, des process et de la santé")}>
          {!keyDone && tx("Une fois la clé acceptée, la collecte repart seule et remplace les estimations ci-dessus.")}
          {keyDone && !finished && (
            <p aria-live="polite">
              {p ? <><span className="tabular-nums text-dim">{p.step}/{p.steps}</span> {p.label}{p.total ? ` (${p.done ?? 0}/${p.total})` : ""}</> : tx("démarrage…")}
            </p>
          )}
          {finished && (
            <p className="flex flex-wrap items-center gap-1.5">
              {readable.map((c) => <Badge key={c.name} tone="ok">{c.message}</Badge>)}
              {tx("remplacent les estimations.")}
            </p>
          )}
        </Step>
        <Step state={skipped.includes("network") ? "next" : netState(net) === "run" ? "run" : netState(net) === "found" ? "now" : "next"}
          title={tx("Recherche des autres machines du réseau")}
          skipped={skipped.includes("network")} onResume={() => resume("network")}>
          <NetworkStep net={net} reload={reloadNet} machines={snap.data.machine_list} connected={snap.data.services_status ?? []} onSkip={() => skip("network")} />
        </Step>
        <Step state={keyDone && proposals.length && !skipped.includes("connectors") ? "now" : "next"} title={tx("Connecteurs proposés d'après ce qui est trouvé")}
          onSkip={proposals.length ? () => skip("connectors") : undefined} skipped={skipped.includes("connectors") && proposals.length > 0}
          onResume={() => resume("connectors")}>
          {proposals.length > 0
            ? <><p className="mb-2">{tx("MyServices a reconnu des applis qu'il sait lire par leur API. Un connecteur ajoute leurs données (certificats, DNS, santé) sans rien recoder.")}</p><Proposals list={proposals} /></>
            : tx("Rien à proposer pour l'instant. Cette étape s'allume toute seule quand NPM, AdGuard, Beszel, Uptime Kuma… sont reconnus sur vos machines.")}
        </Step>
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line/70 pt-4">
        <button type="button" className={finished ? primary : `${button} border-line text-muted hover:border-link hover:text-txt`} onClick={close}>
          <Check size={14} aria-hidden />{tx("Terminer les premiers pas")}
        </button>
        <span className="text-sm text-dim">{tx("Cette carte reste ouverte tant que vous ne la fermez pas. Menu du compte -> « Revoir les premiers pas » pour la rouvrir.")}</span>
      </div>
    </section>
  );
}
