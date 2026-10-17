// Assistant de démarrage : une étape à la fois, « Passer » et « Retour » partout, rien n'est modifié sur les machines.
// Étapes 1 (bienvenue) et 2 (cette machine, lue sans SSH) faites ; les suivantes sont annoncées. Progression gardée par le navigateur.
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Eye, Loader2, Plug, ShieldCheck, SkipForward, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import type { Snapshot } from "../api";
import { MachineIcon } from "../components/MachineIcon";
import { AssistantNetwork } from "../components/AssistantNetwork";
import { SourceBadges } from "../components/SourceBadges";
import { Badge, Card, Dim } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { STEPS, advance, chooseHost, chosenHost, loadProgress, previousStep, resetProgress, saveProgress, thisMachine, type AssistantProgress } from "../lib/assistant";
import { describeAdvice, summary } from "../lib/access";
import { primary, quiet } from "../lib/forms";
import { useNetScan } from "../lib/netScan";
import { tx } from "../lib/i18n";
import { plural } from "../lib/summary";
import type { Advice, Machine, SystemState } from "../types";

export function Assistant({ snap }: { snap: Snapshot }) {
  const [p, setP] = useState<AssistantProgress>(loadProgress);
  const update = (next: AssistantProgress) => { saveProgress(next); setP(next); scrollTo({ top: 0 }); };
  const index = STEPS.findIndex((s) => s.id === p.current), step = STEPS[index], last = index === STEPS.length - 1;
  const finished = STEPS.every((s) => p.done.includes(s.id) || p.skipped.includes(s.id));

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between gap-3 py-6">
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight">{tx("MyServices")} <span className="text-lg font-semibold text-dim">{tx("Assistant")}</span></h1>
        <a href="#" className="group inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted hover:border-link hover:text-txt">
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
                  className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-bold transition-colors ${now ? "border-link bg-link text-white" : done ? "border-ok/60 bg-ok/15 text-ok" : skipped ? "border-dim/50 bg-bg2 text-dim" : "border-line bg-card text-muted hover:border-link"}`}>
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
        {p.current === "machine" && <ThisMachine snap={snap} />}
        {p.current === "network" && <Network snap={snap} />}
        {p.current === "access" && <Access snap={snap} />}
        {!step.ready && <Soon title={step.title} />}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
          {index > 0 && <button type="button" className={quiet} onClick={() => update({ ...p, current: previousStep(p.current) })}><ArrowLeft size={14} aria-hidden />{tx("Retour")}</button>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {!last || !finished ? <button type="button" className={quiet} onClick={() => update(advance(p, "skipped"))}><SkipForward size={14} aria-hidden />{tx("Passer")}</button> : null}
            {step.ready
              ? <button type="button" className={primary} onClick={() => update(advance(p, "done"))}>{last ? tx("Terminer") : tx("Continuer")}<ArrowRight size={14} aria-hidden /></button>
              : null}
          </span>
        </div>
      </Card>

      {finished && <p className="mt-4 rounded-lg bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">✓ {tx("Toutes les étapes sont faites ou passées.")}</p>}
      <p className="mt-6 text-center text-xs text-dim">
        {tx("Votre progression est gardée dans ce navigateur.")}{" "}
        <button type="button" className="text-link hover:underline" onClick={() => { resetProgress(); setP(loadProgress()); }}>{tx("Recommencer")}</button>
      </p>
    </div>
  );
}

function Welcome({ snap }: { snap: Snapshot }) {
  const items = [
    { Icon: Eye, title: tx("Il lit, il ne modifie rien"), text: tx("MyServices regarde vos machines et vos outils en lecture seule. Rien n'est changé sur eux sans que vous le demandiez.") },
    { Icon: Plug, title: tx("Il s'appuie sur ce que vous avez déjà"), text: tx("SSH, un petit agent, ou les outils que vous utilisez déjà : à chaque machine sa méthode, vous choisissez.") },
    { Icon: ShieldCheck, title: tx("Chaque étape se passe ou se refait"), text: tx("Rien n'est obligatoire. Vous pouvez revenir en arrière, et reprendre plus tard : l'assistant se souvient d'où vous en êtes.") },
  ];
  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-bold"><Sparkles size={20} className="text-link" aria-hidden />{tx("Bienvenue sur MyServices")}</h2>
      <p className="mt-2 text-sm text-muted">{tx("En quelques étapes, MyServices apprend à connaître votre réseau. Voici comment il travaille.")}</p>
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
function ThisMachine({ snap }: { snap: Snapshot }) {
  const [sys, setSys] = useState<SystemState | null>(null);
  useEffect(() => { read<SystemState>("system").then(setSys).catch(() => undefined); }, []);
  const list = snap.data.machine_list;
  const [chosen, setChosen] = useState(chosenHost);
  const host = thisMachine(list, location.hostname, chosen);
  const apps = host ? [...new Set([
    ...snap.data.hosts.filter((h) => h.machine === host.name && h.app).map((h) => h.app!.label),
    ...(host.info?.apache ? ["Apache"] : []), ...(host.info?.nginx ? ["Nginx"] : []),
  ])].filter((a) => a !== "Docker") : [];
  const docker = sys?.host_docker;
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Cette machine")}</h2>
      <p className="mt-2 text-sm text-muted">{tx("MyServices commence par se regarder lui-même, sans rien configurer : voici ce qu'il voit déjà de la machine où il tourne.")}</p>
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
      ) : list.length === 0
        ? <p className="mt-4 rounded-lg bg-bg2 px-3 py-2 text-sm text-muted">{tx("Aucune machine détectée pour l'instant : la première lecture est en cours, revenez dans un instant.")}</p>
        : (
          <div className="mt-4 rounded-xl border border-warn/40 bg-warn/5 p-4">
            <p className="text-sm text-txt">{tx("MyServices n'a pas pu savoir tout seul sur laquelle de ces machines il tourne. Choisissez-la :")}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {list.filter((m) => !m.disabled).map((m) => (
                <li key={m.ip}><button type="button" className={quiet} onClick={() => { chooseHost(m.ip); setChosen(m.ip); }}>{m.name} <Dim>{m.ip}</Dim></button></li>
              ))}
            </ul>
          </div>
        )}
      {host && chosen === host.ip && <p className="mt-2 text-xs text-dim">{tx("Désignée par vous.")} <button type="button" className="text-link hover:underline" onClick={() => { chooseHost(""); setChosen(""); }}>{tx("Changer")}</button></p>}
      <p className="mt-3 text-xs text-dim">{tx("Ce que MyServices lit d'une autre machine dépend de la méthode choisie (SSH, agent ou outil déjà en place) : c'est l'objet des étapes suivantes.")}</p>
    </div>
  );
}

/** Étape 3 : chercher les autres machines du réseau et choisir celles à suivre (la recherche et l'ajout existent déjà dans NetworkStep) */
function Network({ snap }: { snap: Snapshot }) {
  const { net, reload } = useNetScan();
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Le réseau")}</h2>
      <p className="mt-2 text-sm text-muted">{tx("Trouvons les autres machines de votre réseau, puis choisissez celles à suivre. Rien n'est ajouté sans votre accord.")}</p>
      <AssistantNetwork net={net} reload={reload} known={snap.data.machine_list.map((m) => m.ip)} />
      <p className="mt-4 text-xs text-dim">{tx("Vous ne voulez pas de recherche automatique ? Ajoutez une machine à la main :")} <a href="#settings/machines" className="text-link hover:underline">{tx("Réglages → Machines")}</a></p>
    </div>
  );
}

/** Étape 4 : une machine à la fois, la méthode de lecture recommandée et ce qu'il reste à faire */
function Access({ snap }: { snap: Snapshot }) {
  const [advice, setAdvice] = useState<Record<string, Advice> | null>(null), [error, setError] = useState(""), [i, setI] = useState(0);
  useEffect(() => {
    read<{ advice: Record<string, Advice> }>("machines/advice").then((r) => setAdvice(r.advice)).catch((e: Error) => setError(e.message));
  }, [snap.data.generated]);
  if (error) return <p className="text-sm text-warn">⚠ {error}</p>;
  if (!advice) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" aria-hidden />{tx("Chargement…")}</p>;
  // Les machines pas encore lues par la méthode recommandée d'abord : c'est là qu'il y a quelque chose à faire
  const rank = (m: Machine) => (describeAdvice(m.ip, advice[m.ip]).read ? 1 : 0);
  const machines = snap.data.machine_list.filter((m) => advice[m.ip]).sort((a, b) => rank(a) - rank(b));
  const sum = summary(advice);
  if (machines.length === 0) return <p className="text-sm text-muted">{tx("Aucune machine à régler pour l'instant : ajoutez-en à l'étape précédente.")}</p>;
  const m = machines[Math.min(i, machines.length - 1)], v = describeAdvice(m.ip, advice[m.ip]);
  return (
    <div>
      <h2 className="text-xl font-bold">{tx("Lire chaque machine")}</h2>
      <p className="mt-2 text-sm text-muted">{tx("Pour chaque machine, MyServices vous recommande la méthode la plus simple. Rien ne change tant que vous ne lancez pas l'action proposée.")}</p>
      <p className="mt-2 text-xs text-dim">{tx("{0} machines suivies, {1} déjà lues par la méthode recommandée.", sum.total, sum.read)}</p>
      <div className="mt-4 rounded-xl border border-line/60 bg-bg2/60 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <MachineIcon m={{ name: m.name, role: m.role, info: m.info, ttl: m.ttl, icon: m.icon ?? undefined }} reserve />
          <b className="text-base">{m.name}</b><Dim>{m.ip}</Dim>
          <span className="ml-auto"><SourceBadges all m={m} /></span>
        </div>
        <div className={`mt-3 rounded-lg border p-3 ${v.read ? "border-ok/50 bg-ok/10" : "border-link/50 bg-link/5"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Recommandé")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-bold">{v.title}{v.read && <Badge tone="ok">✓ {tx("déjà en place")}</Badge>}</p>
          <p className="mt-1 text-sm text-muted">{v.why}</p>
          {v.action && <a href={v.action.href} className={`${primary} mt-3 inline-flex no-underline`}>{v.action.label}<ArrowRight size={14} aria-hidden /></a>}
          {v.others.length > 0 && <p className="mt-2 text-xs text-dim">{tx("Autres possibilités :")} {v.others.join(", ")}</p>}
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

function Soon({ title }: { title: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 rounded-lg bg-bg2 px-3 py-2 text-sm text-muted">{tx("Cette étape arrive bientôt. En attendant, vous pouvez la passer : elle reste disponible dans Réglages.")}</p>
    </div>
  );
}
