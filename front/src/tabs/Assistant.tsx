// Assistant de démarrage : une étape à la fois, « Passer » et « Retour » partout, rien n'est modifié sur les machines.
// Cinq étapes : bienvenue, cette machine (sans SSH), le réseau, la façon de lire chaque machine, relier les outils, puis un résumé.
// La progression est gardée côté serveur (reprise depuis un autre navigateur), avec une copie dans ce navigateur.
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Download, Eye, KeyRound, Loader2, Plug, ShieldCheck, SkipForward, Sparkles } from "lucide-react";
import { createElement, useCallback, useEffect, useState } from "react";
import { read, send } from "../api";
import type { Snapshot } from "../api";
import { MachineIcon } from "../components/MachineIcon";
import { AssistantNetwork, proposedFrom } from "../components/AssistantNetwork";
import { SetupModal, type Setup } from "../components/SetupModal";
import { SourceBadges } from "../components/SourceBadges";
import { Badge, Card, Dim } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { STEPS, advance, isFinished, type AssistantStep, loadProgress, normalizeProgress, previousStep, resetProgress, saveProgress, thisMachine, type AssistantProgress } from "../lib/assistant";
import { savedFor } from "../lib/savedFor";
import { STATUS_RANK, describeAdvice, isActive, summary } from "../lib/access";
import { primary, quiet } from "../lib/forms";
import { useNetScan } from "../lib/netScan";
import { tx } from "../lib/i18n";
import { plural } from "../lib/summary";
import { ScheduleGlance } from "../components/ScheduleGlance";
import type { Advice, ConnectorInstance, ConnectorsState, Machine, Proposal, SystemState } from "../types";
import { InfoNote } from "../components/InfoNote";

const confide = (local: AssistantProgress) => void send("PUT", "assistant", local).catch(() => undefined);   // confie au serveur la progression de ce navigateur

const stepDot = (now: boolean, done: boolean, skipped: boolean) => {
  if (now) return "border-link bg-link text-white";
  if (done) return "border-ok/60 bg-ok/15 text-ok";
  if (skipped) return "border-dim/50 bg-bg2 text-dim";
  return "border-line bg-card text-muted hover:border-link";
};

const ADVICE_PANEL: Record<string, string> = { ok: "border-ok/50 bg-ok/10", optimize: "border-warn/50 bg-warn/5" };
const SETUP_ICON = { ssh: KeyRound, agent: Download, connector: Plug } as const;
const CONFIDENCE_TONE = { sure: "ok", probable: "info", possible: "off" } as const;

export function Assistant({ snap }: Readonly<{ snap: Snapshot }>) {
  const [p, setP] = useState<AssistantProgress>(loadProgress);
  const store = (next: AssistantProgress) => { saveProgress(next); setP(next); void send("PUT", "assistant", next).catch(() => undefined); };   // navigateur + serveur
  const update = (next: AssistantProgress) => { store(next); scrollTo({ top: 0 }); };
  useEffect(() => {   // la progression du serveur fait foi (reprise depuis un autre navigateur) ; sinon on lui confie celle de ce navigateur
    read<{ state: AssistantProgress | null }>("assistant").then((r) => {
      if (r.state) { const state = normalizeProgress(r.state); saveProgress(state); setP(state); return; }
      const local = loadProgress();
      if (local.done.length || local.skipped.length || local.current !== "welcome") confide(local);
    }).catch(() => undefined);
  }, []);
  const index = STEPS.findIndex((s) => s.id === p.current), step = STEPS[index], last = index === STEPS.length - 1;
  const finished = isFinished(p);
  // Chaque étape dit si elle est déjà en ordre (rien à régler) : « Passer » n'a alors plus de sens et disparaît
  const [setup, setSetup] = useState<Setup | null>(null), [rev, setRev] = useState(0);   // fenêtre de réglage ouverte ; rev : les étapes se relisent à sa fermeture
  const closeSetup = () => { setSetup(null); setRev((n) => n + 1); };
  const [inOrder, setInOrder] = useState<Partial<Record<AssistantStep, boolean>>>({ welcome: true });
  const report = useCallback((id: AssistantStep, ok: boolean) => setInOrder((o) => (o[id] === ok ? o : { ...o, [id]: ok })), []);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between gap-3 py-6">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight">{tx("MyServices")} <span className="text-lg font-semibold text-dim">{tx("Assistant")}</span></h1>
        <a href="#home" className="group inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted hover:border-link hover:text-txt">
          <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{tx("Tableau de bord")}
        </a>
      </header>

      <nav aria-label={tx("Étapes de l'assistant")} className="mb-5">
        <ol className="flex items-start gap-1 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const done = p.done.includes(s.id), skipped = p.skipped.includes(s.id), now = s.id === p.current;
            return (
              <li key={s.id} className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 text-center" aria-current={now ? "step" : undefined}>
                <button type="button" onClick={() => update({ ...p, current: s.id })} title={s.title}
                  className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-bold transition-colors ${stepDot(now, done, skipped)}`}>
                  {done ? <Check size={16} aria-hidden /> : i + 1}
                </button>
                <span className={`text-xs ${now ? "font-semibold text-txt" : "text-dim"}`}>{s.title}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-dim">{tx("Étape {0} sur {1}", index + 1, STEPS.length)}</p>
        {p.current === "welcome" && <Welcome snap={snap} />}
        {p.current === "machine" && <ThisMachine snap={snap} chosen={p.host} onChoose={(host) => store({ ...p, host })} report={report} />}
        {p.current === "network" && <Network snap={snap} report={report} open={setSetup} />}
        {p.current === "access" && <Access snap={snap} report={report} open={setSetup} rev={rev} accepted={p.accepted}
          onAccept={(ip, on) => store({ ...p, accepted: on ? [...new Set([...p.accepted, ip])] : p.accepted.filter((a) => a !== ip) })} />}
        {p.current === "tools" && <><Tools snap={snap} report={report} open={setSetup} rev={rev} /><ScheduleGlance /></>}
        {!step.ready && <Soon title={step.title} />}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
          {index > 0 && <button type="button" className={quiet} onClick={() => update({ ...p, current: previousStep(p.current) })}><ArrowLeft size={14} aria-hidden />{tx("Retour")}</button>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {!inOrder[p.current] && (!last || !finished) ? <button type="button" className={quiet} title={tx("Pas maintenant : l'étape est marquée « passée » et la suivante s'affiche. Vous pourrez y revenir à tout moment ; l'assistant reste ouvert.")}
              onClick={() => update(advance(p, "skipped"))}><SkipForward size={14} aria-hidden />{tx("Passer cette étape")}</button> : null}
            {step.ready
              ? <button type="button" className={primary} title={last ? tx("C'est fait : l'assistant affiche son résumé.") : tx("Cette étape est faite : la suivante s'affiche.")}
                onClick={() => update(advance(p, "done"))}>{last ? tx("Terminer") : tx("Continuer")}<ArrowRight size={14} aria-hidden /></button>
              : null}
          </span>
        </div>
      </Card>

      {setup && <SetupModal setup={setup} snap={snap} onClose={closeSetup} onSwitch={setSetup} />}
      {finished && <Recap snap={snap} onReview={() => update({ ...p, current: "access" })} />}
      <p className="mt-6 text-center text-xs text-dim">
        {tx("Votre progression est enregistrée.")}{" "}
        <button type="button" className="text-link hover:underline" onClick={() => { resetProgress(); store(loadProgress()); }}>{tx("Recommencer")}</button>
      </p>
    </div>
  );
}

function Welcome({ snap }: Readonly<{ snap: Snapshot }>) {
  const items = [
    { Icon: Eye, title: tx("Il lit, il ne modifie rien"), text: tx("MyServices regarde vos machines et vos outils en lecture seule. Rien n'est changé sur eux sans que vous le demandiez.") },
    { Icon: Plug, title: tx("Il s'appuie sur ce que vous avez déjà"), text: tx("SSH, un petit agent, ou les outils que vous utilisez déjà : à chaque machine sa méthode, vous choisissez.") },
    { Icon: ShieldCheck, title: tx("Chaque étape se passe ou se refait"), text: tx("Rien n'est obligatoire. Vous pouvez revenir en arrière, et reprendre plus tard : l'assistant se souvient d'où vous en êtes.") },
  ];
  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-bold"><Sparkles size={20} className="text-link" aria-hidden />{tx("Bienvenue sur MyServices")}</h2>
      <InfoNote className="mt-2">{tx("En quelques étapes, MyServices apprend à connaître votre réseau. Voici comment il travaille.")}</InfoNote>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map(({ Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border border-line/60 bg-bg2/60 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-link/15 text-link"><Icon size={18} aria-hidden /></span>
            <span><b className="block text-sm text-txt">{title}</b><span className="block text-sm text-muted">{text}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm"><Badge tone="ok">✓ {tx("Compte administrateur")}</Badge><b>{snap.me.username}</b></p>
    </div>
  );
}

/** Ce que MyServices voit de la machine qui l'héberge, sans SSH ni rien à configurer */
type Report = (id: AssistantStep, ok: boolean) => void;

function ThisMachine({ snap, chosen, onChoose, report }: Readonly<{ snap: Snapshot; chosen: string; onChoose: (ip: string) => void; report: Report }>) {
  const [sys, setSys] = useState<SystemState | null>(null);
  useEffect(() => { read<SystemState>("system").then(setSys).catch(() => undefined); }, []);
  const list = snap.data.machine_list;
  const host = thisMachine(list, location.hostname, chosen);
  const apps = host ? [...new Set([
    ...snap.data.hosts.filter((h) => h.machine === host.name && h.app).map((h) => h.app!.label),
    ...(host.info?.apache ? ["Apache"] : []), ...(host.info?.nginx ? ["Nginx"] : []),
  ])].filter((a) => a !== "Docker") : [];
  const docker = sys?.host_docker;
  useEffect(() => report("machine", !!host), [host, report]);   // machine hôte identifiée : rien à décider
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Cette machine")}</h2>
      <InfoNote className="mt-2">{tx("MyServices commence par se regarder lui-même, sans rien configurer : voici ce qu'il voit déjà de la machine où il tourne.")}</InfoNote>
      {host ? (
        <div className="mt-4 rounded-xl border border-line/60 bg-bg2/60 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <MachineIcon m={{ name: host.name, role: host.role, info: host.info, ttl: host.ttl, icon: host.icon ?? undefined }} reserve />
            <b className="text-base">{host.name}</b><Dim>{host.ip}</Dim>
            <Badge tone="ok">{plural(host.services, "service trouvé", "services trouvés")}</Badge>
            {docker?.present
              ? <Badge tone="info" title={tx("Docker est présent sur cette machine")}>
                  {appIcon(["Docker"]) && <img src={appIcon(["Docker"])!} alt="" aria-hidden className="mr-1 h-4 w-4 object-contain" />}Docker · ≈ {plural(docker.containers, "conteneur")}</Badge>
              : sys && <Badge tone="off" title={tx("Docker n'est visible que si son socket est donné à MyServices : facultatif, vous pourrez l'ajouter plus tard.")}>{tx("Docker non visible (facultatif)")}</Badge>}
          </div>
          {apps.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
              {apps.map((a) => { const src = appIcon([a]); return <span key={a} className="inline-flex items-center gap-1">{src && <img src={src} alt="" aria-hidden className="h-5 w-5 object-contain" />}{a}</span>; })}
            </p>
          )}
        </div>
      ) : <HostChoice list={list} onChoose={onChoose} />}
      {host?.ip === chosen && <p className="mt-2 text-xs text-dim">{tx("Désignée par vous.")} <button type="button" className="text-link hover:underline" onClick={() => onChoose("")}>{tx("Changer")}</button></p>}
      <InfoNote className="mt-3">{tx("Ce que MyServices lit d'une autre machine dépend de la méthode choisie (SSH, agent ou outil déjà en place) : c'est l'objet des étapes suivantes.")}</InfoNote>
    </div>
  );
}

function HostChoice({ list, onChoose }: Readonly<{ list: Machine[]; onChoose: (ip: string) => void }>) {
  if (list.length === 0) return <p className="mt-4 rounded-lg bg-bg2 px-3 py-2 text-sm text-muted">{tx("Aucune machine détectée pour l'instant : la première lecture est en cours, revenez dans un instant.")}</p>;
  return (
    <div className="mt-4 rounded-xl border border-warn/40 bg-warn/5 p-4">
      <p className="text-sm text-txt">{tx("MyServices n'a pas pu savoir tout seul sur laquelle de ces machines il tourne. Choisissez-la :")}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {list.filter((m) => !m.disabled).map((m) => (
          <li key={m.ip}><button type="button" className={quiet} onClick={() => onChoose(m.ip)}>{m.name} <Dim>{m.ip}</Dim></button></li>
        ))}
      </ul>
    </div>
  );
}

/** Étape 3 : chercher les autres machines du réseau et choisir celles à suivre (la recherche et l'ajout existent déjà dans NetworkStep) */
type Open = (s: Setup) => void;

/** Boutons d'action d'une machine : même largeur, même hauteur, texte centré, icône à gauche */
const ACTION = "min-w-[13rem] flex-1 justify-center sm:max-w-[17rem]";

/** La fenêtre de réglage qui correspond à l'action recommandée pour cette machine */
const setupFor = (kind: "ssh" | "agent" | "connector", m: Machine, a: Advice): Setup => {
  if (kind === "agent") return { kind, ip: m.ip, name: m.name, agent: a.agent_kind };
  return { kind, ip: m.ip, name: m.name };
};

function Network({ snap, report, open }: Readonly<{ snap: Snapshot; report: Report; open: Open }>) {
  const { net, reload } = useNetScan();
  const known = snap.data.machine_list.map((m) => m.ip);
  useEffect(() => report("network", net?.phase === "done" && proposedFrom(net, known).length === 0), [net, known.join(), report]);   // recherche faite, rien de nouveau à suivre
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Le réseau")}</h2>
      <InfoNote className="mt-2">{tx("Cherchons les machines de votre réseau, puis choisissez celles à suivre. Rien n'est ajouté sans votre accord.")}</InfoNote>
      <AssistantNetwork net={net} reload={reload} known={known} onManual={() => open({ kind: "machine" })} />
    </div>
  );
}

/** Étape 4 : une machine à la fois, la méthode de lecture recommandée et ce qu'il reste à faire */
function Access({ snap, report, open, rev, accepted, onAccept }: Readonly<{ snap: Snapshot; report: Report; open: Open; rev: number; accepted: string[]; onAccept: (ip: string, on: boolean) => void }>) {
  const view = (ip: string, a: Advice) => describeAdvice(ip, a, accepted.includes(ip));   // « C'est suffisant ainsi » pris en compte
  const [advice, setAdvice] = useState<Record<string, Advice> | null>(null), [error, setError] = useState(""), [i, setI] = useState(0);
  useEffect(() => {
    read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice)).catch((e: Error) => setError(e.message));
  }, [snap.data.generated, rev]);
  const active = new Set(snap.data.machine_list.filter(isActive).map((m) => m.ip));   // seules les machines qui répondent sont proposées
  useEffect(() => { if (advice) report("access", Object.entries(advice).filter(([ip]) => active.has(ip)).every(([ip, a]) => view(ip, a).status === "ok")); }, [advice, report, accepted, snap.data.generated]);   // tout est déjà en place
  if (error) return <p className="text-sm text-warn">⚠ {error}</p>;
  if (!advice) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{tx("Chargement…")}</p>;
  // Les machines pas encore lues par la méthode recommandée d'abord : c'est là qu'il y a quelque chose à faire
  const rank = (m: Machine) => STATUS_RANK[view(m.ip, advice[m.ip]).status];
  const machines = snap.data.machine_list.filter((m) => advice[m.ip] && active.has(m.ip)).sort((a, b) => rank(a) - rank(b));
  const asleep = snap.data.machine_list.filter((m) => advice[m.ip] && !active.has(m.ip)).length;
  const sum = summary(Object.fromEntries(Object.entries(advice).filter(([ip]) => active.has(ip))));
  if (machines.length === 0) return <p className="text-sm text-muted">{tx("Aucune machine à régler pour l'instant : ajoutez-en à l'étape précédente.")}</p>;
  const m = machines[Math.min(i, machines.length - 1)], v = view(m.ip, advice[m.ip]);
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Lire chaque machine")}</h2>
      <InfoNote className="mt-2">{tx("Pour chaque machine, MyServices vous recommande la méthode la plus simple. Rien ne change tant que vous ne lancez pas l'action proposée.")}</InfoNote>
      <p className="mt-2 text-xs text-dim">{tx("{0} machines suivies, {1} déjà lues par la méthode recommandée. Les machines à finir ou à optimiser passent en premier.", sum.total, sum.read)}
        {asleep > 0 && <> {tx("{0} éteintes ou hors ligne ne sont pas proposées : à régler quand elles seront allumées.", asleep)}</>}</p>
      {/* Hauteur minimale fixe : les boutons « Machine précédente / suivante » restent à la même place d'une machine à l'autre */}
      <div className="mt-4 flex min-h-[23rem] flex-col rounded-xl border border-line/60 bg-bg2/60 p-4 sm:min-h-[20rem]">
        <div className="flex flex-wrap items-center gap-3">
          <MachineIcon m={{ name: m.name, role: m.role, info: m.info, ttl: m.ttl, icon: m.icon ?? undefined }} reserve />
          <b className="text-base">{m.name}</b><Dim>{m.ip}</Dim>
          <span className="ml-auto"><SourceBadges all m={m} /></span>
        </div>
        <div className={`mt-3 flex-1 rounded-lg border p-3 ${ADVICE_PANEL[v.status] ?? "border-link/50 bg-link/5"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Recommandé")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-bold">{v.title}
            {v.status === "ok" && v.read && <Badge tone="ok">✓ {tx("déjà en place")}</Badge>}
            {v.kept && <Badge tone="ok" title={tx("Vous avez choisi de garder la méthode actuelle pour cette machine.")}>✓ {tx("gardée ainsi")}</Badge>}
            {v.status === "optimize" && <Badge tone="warn" title={tx("La machine est déjà lue, mais pas par la meilleure méthode.")}>{tx("à optimiser")}</Badge>}
            {v.status === "todo" && <Badge tone="info">{tx("à régler")}</Badge>}</p>
          <p className="mt-1 text-sm text-muted">{v.why}</p>
          {v.explain && <p className="mt-2 rounded-md bg-warn/10 px-2.5 py-1.5 text-sm text-txt">{v.explain}</p>}
          {v.todo && <p className="mt-2 text-sm"><b className="text-txt">{tx("À faire :")}</b> <span className="text-muted">{v.todo}</span></p>}
          {(v.action || v.status === "optimize") && (
            <div className="mt-3 flex flex-wrap gap-2">{/* actions alignées : même largeur, même hauteur, icône à gauche */}
              {v.action && <button type="button" className={`${primary} ${ACTION}`} onClick={() => open(setupFor(v.action!.setup, m, advice[m.ip]))}>
                {createElement(SETUP_ICON[v.action.setup], { size: 14, "aria-hidden": true })}{v.action.label}</button>}
              {v.status === "optimize" && <button type="button" className={`${quiet} ${ACTION}`} title={tx("Garder la méthode actuelle : cette machine ne sera plus signalée comme à optimiser.")} onClick={() => onAccept(m.ip, true)}>
                <Check size={14} aria-hidden />{tx("C'est suffisant ainsi")}</button>}
            </div>
          )}
          {v.kept && <p className="mt-2 text-xs text-dim">{tx("Méthode actuelle gardée : {0}.", v.now)} <button type="button" className="text-link hover:underline" onClick={() => onAccept(m.ip, false)}>{tx("Revenir à la recommandation")}</button></p>}
          {v.others.length > 0 && <p className="mt-2 text-xs text-dim">
            {v.others.every((o) => o.active) ? tx("Déjà actif en complément :") : tx("Aussi possible :")}{" "}
            {v.others.map((o) => (o.active && !v.others.every((x) => x.active) ? `${o.label} (${tx("déjà actif")})` : o.label)).join(", ")}.</p>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className={quiet} disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={14} aria-hidden />{tx("Machine précédente")}</button>
        <span className="text-xs text-dim">{tx("Machine {0} sur {1}", Math.min(i, machines.length - 1) + 1, machines.length)}</span>
        <button type="button" className={quiet} disabled={i >= machines.length - 1} onClick={() => setI(i + 1)}>{tx("Machine suivante")}<ChevronRight size={14} aria-hidden /></button>
      </div>
    </div>
  );
}

/** Étape 5 : les outils reconnus sur le réseau que MyServices sait lire par leur API, pas encore reliés */
function Tools({ snap, report, open, rev }: Readonly<{ snap: Snapshot; report: Report; open: Open; rev: number }>) {
  const [instances, setInstances] = useState<ConnectorInstance[] | null>(null);
  useEffect(() => { read<ConnectorsState>("connectors/settings").then((c) => setInstances(c.instances)).catch(() => setInstances([])); }, [snap.data.generated, rev]);
  const list: Proposal[] | null = instances ? (snap.data.proposals ?? []).filter((x) => !savedFor(x, instances)) : null;
  useEffect(() => report("tools", !!list && list.length === 0), [list?.length, report]);   // aucun outil reconnu qui reste à relier
  const how = (c: Proposal["confidence"]) => ({ sure: tx("conteneur reconnu"), probable: tx("page reconnue"), possible: tx("à vérifier") })[c];
  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-bold"><Plug size={20} className="text-link" aria-hidden />{tx("Relier vos outils")}</h2>
      {!list && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{tx("Chargement…")}</p>}
      {list?.length === 0 && (
        <p className="mt-3 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">✓ {tx("Aucun outil à relier pour l'instant : tout ce qui est reconnu l'est déjà. Vous pourrez en ajouter à tout moment dans Réglages → Connecteurs.")}</p>
      )}
      {list && list.length > 0 && (
        <>
          <InfoNote className="mt-2">{tx("MyServices a reconnu ces outils sur votre réseau. Reliez-les pour lire leurs données (certificats, DNS, sauvegardes, santé) : une clé en lecture seule suffit.")}</InfoNote>
          <ul className="mt-4 flex flex-col gap-2">
            {list.map((x) => (
              <li key={`${x.connector}/${x.ip}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg2/60 px-3 py-2">
                {appIcon([x.label]) && <img src={appIcon([x.label])!} alt="" aria-hidden className="h-5 w-5 object-contain" />}
                <b className="text-sm text-txt">{x.label}</b><Dim>{x.machine || x.ip}</Dim>
                <Badge tone={CONFIDENCE_TONE[x.confidence]}>{how(x.confidence)}</Badge>
                <button type="button" className={`${x.confidence === "possible" ? quiet : primary} ml-auto`} onClick={() => open({ kind: "connector", ip: x.ip, name: x.label, proposal: x })}>{tx("Configurer")}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Fin de l'assistant : ce que MyServices lit maintenant, méthode par méthode, et ce qui peut encore être amélioré */
function Recap({ snap, onReview }: Readonly<{ snap: Snapshot; onReview: () => void }>) {
  const [advice, setAdvice] = useState<Record<string, Advice> | null>(null);
  useEffect(() => { read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice)).catch(() => undefined); }, [snap.data.generated]);
  if (!advice) return null;
  const live = new Set(snap.data.machine_list.filter(isActive).map((m) => m.ip));
  const all = Object.entries(advice).filter(([ip]) => live.has(ip)), views = all.map(([ip, a]) => describeAdvice(ip, a));
  const how = (a: Advice) => ["ssh", "agent", "connector"].find((k) => a.current.includes(k)) ?? "ping";
  const count = (k: string) => all.filter(([, a]) => how(a) === k).length;
  const todo = views.filter((v) => v.status !== "ok").length;
  return (
    <section className="mt-4 rounded-2xl border border-ok/50 bg-ok/5 p-5" aria-label={tx("Résumé")}>
      <h2 className="text-lg font-bold text-ok">✓ {tx("Vous avez fait le tour")}</h2>
      <p className="mt-2 text-sm text-muted">{tx("MyServices suit {0} :", plural(all.length, "machine"))}</p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone="ok">{count("ssh")} SSH</Badge><Badge tone="ok">{count("agent")} {tx("agent")}</Badge><Badge tone="info">{count("connector")} {tx("connecteur")}</Badge><Badge tone="off">{count("ping")} {tx("ping seul")}</Badge>
      </p>
      {todo > 0
        ? <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">{tx("À régler ou à optimiser : {0}.", todo)} <button type="button" className={quiet} onClick={onReview}>{tx("Revoir l'étape 4")}</button></p>
        : <p className="mt-3 text-sm font-semibold text-ok">{tx("Tout est en place.")}</p>}
      <a href="#home" className={`${primary} mt-4 inline-flex no-underline`}>{tx("Aller au tableau de bord")}<ArrowRight size={14} aria-hidden /></a>
    </section>
  );
}

function Soon({ title }: Readonly<{ title: string }>) {
  return (
    <div>
      <h2 className="text-xl font-bold">{title}</h2>
      <InfoNote className="mt-2">{tx("Cette étape arrive bientôt. En attendant, vous pouvez la passer : elle reste disponible dans Réglages.")}</InfoNote>
    </div>
  );
}
