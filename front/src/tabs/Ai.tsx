// « IA et agents »: what the AI services contain (models, agents and their platforms, MCP servers, who talks to whom, GPUs), from the AI
// connectors and GpuViewR. No probe and no form of its own: the state is the one of Services, a service is declared in Services or
// Connectors, and every card and row leads to the page of its service. Four sub-pages of the side menu: #ai/overview, models, agents, gpu.
import { ArrowRight, Bot, Cpu, Fan, Gauge, MemoryStick, Thermometer, Workflow, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { aiAlerts, aiCards, aiFigures, aiGpus, aiLinks, aiModels, GPU_FULL, memPct, type AiCard, type AiRole, type GpuCard, type ModelRow } from "../lib/ai";
import type { GpuRead } from "../types";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import { Badge, Dim, Empty, GradientFill, Pct, Td, Th } from "../components/ui";
import { Dot } from "../components/marks";
import { FoldPanel } from "../components/FoldPanel";
import { FamilyCard, WatchPanel } from "../components/FamilyCards";
import { HeadTags } from "../components/HeadTags";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { InfoNote } from "../components/InfoNote";
import { HistoryTile, useAiHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { TilePoint } from "../lib/tileHistory";

const VIEWS = ["overview", "models", "agents", "gpu"] as const;
const ROLE: Record<AiRole, string> = { engine: tx("moteur"), agent: tx("agent"), interface: tx("interface"), mcp: "MCP", gpu: "GPU", other: tx("autre") };
const MIB = 2 ** 20;
const num = (n?: number | null) => (n == null ? "-" : new Intl.NumberFormat().format(n));

export function Ai({ snap, route }: Readonly<{ snap: Snapshot; route: string }>) {
  const view = usePageView(route, "ai", VIEWS, "overview");
  const cards = useMemo(() => aiCards(snap), [snap]);
  const models = useMemo(() => aiModels(snap, cards), [snap, cards]);
  const gpus = useMemo(() => aiGpus(snap), [snap]);
  const admin = snap.me.role === "admin";
  const read = [...new Set(cards.filter((c) => !c.unread && c.conn?.ok).map((c) => c.conn!.label))];
  const unread = [...new Set(cards.filter((c) => c.unread).map((c) => c.title))];
  const machines = new Set(cards.map((c) => c.machine).filter(Boolean)).size;
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={Bot} title={tx("IA et agents")} tags={<HeadTags counts={[tx("{0} services", cards.length), tx("{0} machines", machines)]} sources={read} others={unread} at={snap.data.generated} />} actions={admin && <ConnectorsLink />} />
      {!cards.length && <Empty>{tx("Aucun service IA pour l'instant : un service de catégorie « IA » dans Services, ou un connecteur IA, fait apparaître cette page.")}</Empty>}
      {cards.length > 0 && view === "overview" && <Overview snap={snap} cards={cards} models={models} gpus={gpus} admin={admin} />}
      {cards.length > 0 && view === "models" && <Models rows={models} cards={cards} />}
      {cards.length > 0 && view === "agents" && <Agents snap={snap} cards={cards} />}
      {cards.length > 0 && view === "gpu" && <Gpus gpus={gpus} models={models} />}
    </div>
  );
}

function Overview({ snap, cards, models, gpus, admin }: Readonly<{ snap: Snapshot; cards: AiCard[]; models: ModelRow[]; gpus: GpuCard[]; admin: boolean }>) {
  const alerts = aiAlerts(cards, gpus), fig = aiFigures(snap, cards);
  const engines = cards.filter((c) => c.role === "engine");
  const [hours, setHours] = usePeriod(), hist = useAiHistory(hours, snap.data.generated), now = Math.floor(Date.now() / 1000);
  const ratio = (p: TilePoint) => `${p[1]}/${p[2]}`, missing = (p: TilePoint) => p[2] - p[1], level = (p: TilePoint) => `${p[1]} %`;
  const hot = (v: number | null, limit: number) => (v != null && v >= limit ? "warn" : v == null ? undefined : "ok");
  const powerTop = Math.max(fig.powerLimit ?? 0, ...(hist?.power ?? []).map((p) => p[1]), 1);
  const dash = (v: number | null, unit: string) => (v == null ? "-" : `${v} ${unit}`);
  const common = { hours, now } as const;
  return (
    <>
      <InfoNote>{tx("Ce que contiennent vos services IA : modèles, agents, GPU. Leur état (en ligne, en panne, en pause) vient de Services, sans sonde en plus. Pour ajouter ou modifier un service, passez par Services ou Connecteurs.")}</InfoNote>
      <div className="flex justify-end"><PeriodSwitch value={hours} onChange={setHours} /></div>
      {gpus.length > 0 && (
        <div className="flex flex-wrap gap-2.5 pb-1">
          <HistoryTile n={dash(fig.gpu, "%")} label={tx("Charge GPU")} tone={hot(fig.gpu, GPU_FULL)} fact={tx("{0} GPU, lus par GpuViewR", gpus.length)} scale={100} kind="curve" points={hist?.gpu ?? null} {...common} figure={(p) => p[1]} fmt={level} goodHigh />
          <HistoryTile n={dash(fig.vram, "%")} label={tx("Mémoire GPU")} tone={hot(fig.vram, GPU_FULL)} scale={100} kind="curve" points={hist?.vram ?? null} {...common} figure={(p) => p[1]} fmt={level} goodHigh={false} />
          <HistoryTile n={dash(fig.temp, "°C")} label={tx("Température GPU")} tone={hot(fig.temp, 80)} fact={tx("la plus chaude")} scale={100} kind="curve" points={hist?.temp ?? null} {...common} figure={(p) => p[1]} fmt={(p) => `${p[1]} °C`} goodHigh={false} />
          <HistoryTile n={dash(fig.power, "W")} label={tx("Puissance")} fact={fig.powerLimit ? tx("limite {0} W", fig.powerLimit) : undefined} scale={powerTop} kind="curve" points={hist?.power ?? null} {...common} figure={(p) => p[1]} fmt={(p) => `${p[1]} W`} goodHigh={false} />
        </div>
      )}
      <div className="flex flex-wrap gap-2.5 pb-1">
        <HistoryTile n={fig.engines ? `${fig.enginesUp}/${fig.engines}` : engines.length} label={tx("Moteurs en ligne")} tone={fig.engines ? (fig.enginesUp < fig.engines ? "warn" : "ok") : undefined}
          fact={[...new Set(engines.map((e) => e.title))].join(", ") || tx("aucun")} kind="strip" points={hist?.engines ?? null} {...common} figure={missing} fmt={(p) => tx("{0} moteur(s) hors ligne", missing(p))} goodHigh />
        <HistoryTile n={fig.models ? `${fig.modelsLoaded}/${fig.models}` : models.length} label={tx("Modèles chargés")} fact={tx("en mémoire, sur {0} modèles", models.length)} dips={false} kind="curve" points={hist?.models ?? null} {...common} figure={(p) => p[1]} fmt={ratio} goodHigh />
        <HistoryTile n={fig.platforms ? `${fig.platformsUp}/${fig.platforms}` : cards.filter((c) => c.role === "agent").length} label={tx("Agents")} tone={fig.platforms && fig.platformsUp < fig.platforms ? "warn" : undefined}
          fact={fig.platforms ? tx("plateformes connectées") : tx("aucune plateforme lue")} kind="strip" points={hist?.agents ?? null} {...common} figure={missing} fmt={(p) => tx("{0} plateforme(s) déconnectée(s)", missing(p))} goodHigh />
        {fig.ram != null && <HistoryTile n={`${fig.ram} %`} label={tx("Mémoire de la machine IA")} tone={hot(fig.ram, GPU_FULL)} scale={100} kind="curve" points={hist?.ram ?? null} {...common} figure={(p) => p[1]} fmt={level} goodHigh={false} />}
      </div>
      <WatchPanel id="ai-watch" lines={alerts} admin={admin} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => <ServiceCard key={c.key} c={c} admin={admin} />)}
      </div>
      <Dim>{tx("Tri : ce qui demande un œil d'abord, puis moteurs, agents, interfaces, MCP. Bordure en pointillés : service connu de Services dont le contenu n'est pas lu.")}</Dim>
    </>
  );
}

/** The figures of a card, by role: only what was read */
function cardFacts(c: AiCard): [string, string][] {
  const out: [string, string][] = [];
  if (c.machine || c.ip) out.push([tx("Machine"), [c.machine, c.ip].filter(Boolean).join(" · ")]);
  if (c.version) out.push([tx("Version"), c.version]);
  if (c.unread) return [...out, [tx("Contenu"), tx("non lu")]];
  out.push(...roleFacts(c));
  if (c.partial) out.push([tx("Lecture"), tx("partielle")]);
  return out.slice(0, 5);
}

/** The figures a card shows for its role */
function roleFacts(c: AiCard): [string, string][] {
  const ai = c.conn?.ai, out: [string, string][] = [];
  switch (c.role) {
    case "engine": {
      const loaded = c.models.filter((m) => m.loaded).map((m) => m.name);
      out.push([tx("Modèles"), tx("{0} installés", c.models.length)], [tx("Chargés"), loaded.join(", ") || tx("aucun")]);
      break;
    }
    case "agent": {
      const p = ai?.platforms ?? [], model = ai?.uses?.find((u) => "model" in u);
      if (p.length) out.push([tx("Plateformes"), tx("{0}/{1} connectées", p.filter((x) => x.state === "connected").length, p.length)]);
      if (model && "model" in model) out.push([tx("Modèle"), model.model]);
      break;
    }
    case "interface":
      out.push([tx("Modèles proposés"), String(c.models.length)]);
      if (ai?.uses?.length) out.push([tx("Reliée à"), tx("{0} serveurs", ai.uses.length)]);
      break;
    case "gpu":
      for (const f of (c.conn?.facts ?? []).slice(0, 2)) out.push([f.label, f.value]);
      break;
    default:
      break;
  }
  return out;
}

function ServiceCard({ c, admin }: Readonly<{ c: AiCard; admin: boolean }>) {
  return (
    <FamilyCard c={c} role={ROLE[c.role]} facts={cardFacts(c)} icon={Bot} admin={admin} links={<>
      {!c.unread && c.role === "engine" && c.models.length > 0 && <a href="#ai/models" className="text-link hover:underline">{tx("Ses modèles")} ›</a>}
      {!c.unread && (c.role === "agent" || c.role === "interface") && <a href="#ai/agents" className="text-link hover:underline">{tx("Agents et MCP")} ›</a>}
    </>} />
  );
}

type ModelFilter = { kind: "all" | "loaded" | "engine" | "machine"; value?: string };

function matchesFilter(m: ModelRow, f: ModelFilter): boolean {
  switch (f.kind) {
    case "all": return true;
    case "loaded": return !!m.loaded;
    case "engine": return m.engine === f.value;
    default: return m.machine === f.value;
  }
}

/** The sort key of a model for a column of the table: numbers for the sizes and the state, lower case text for the rest */
function modelKey(m: ModelRow, k: string): string | number {
  switch (k) {
    case "size": return m.size ?? -1;
    case "context": return m.context ?? -1;
    case "vram": return m.vram ?? -1;
    case "state": return Number(!m.loaded);
    case "name": return m.name.toLowerCase();
    case "engine": return m.engine.toLowerCase();
    case "machine": return (m.machine ?? "").toLowerCase();
    case "quant": return (m.quant ?? "").toLowerCase();
    case "family": return (m.family ?? "").toLowerCase();
    case "params": return (m.params ?? "").toLowerCase();
    default: return "";
  }
}

function modelSize(m: ModelRow): React.ReactNode {
  if (m.cloud) return <Dim>{tx("cloud")}</Dim>;
  return m.size ? bytes(m.size) : "-";
}

function modelState(m: ModelRow): string {
  if (m.cloud) return tx("sur ollama.com");
  return m.loaded ? tx("chargé") : tx("sur disque");
}

function Models({ rows, cards }: Readonly<{ rows: ModelRow[]; cards: AiCard[] }>) {
  const [f, setF] = useState<ModelFilter>({ kind: "all" });
  const shown = rows.filter((m) => matchesFilter(m, f));
  const sort = useSort(shown, modelKey, "name");
  const engines = [...new Set(rows.map((m) => m.engine))].sort((a, b) => a.localeCompare(b)), machines = [...new Set(rows.map((m) => m.machine).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const unread = cards.filter((c) => c.unread && c.role === "engine").map((c) => c.title);
  const chip = (label: string, v: ModelFilter) => {
    const on = f.kind === v.kind && f.value === v.value;
    return <button key={`${v.kind}${v.value ?? ""}`} type="button" onClick={() => setF(v)} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-link text-txt ring-2 ring-link/30" : "border-line text-muted hover:text-txt"}`}>{label}</button>;
  };
  if (!rows.length) return <Empty>{tx("Aucun modèle lu : reliez un connecteur Ollama, llama.cpp ou « API compatible OpenAI » dans Connecteurs.")}</Empty>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {chip(tx("Tous"), { kind: "all" })}{chip(tx("Chargés"), { kind: "loaded" })}
        {engines.length > 1 && engines.map((e) => chip(e, { kind: "engine", value: e }))}
        {machines.length > 1 && machines.map((m) => chip(m, { kind: "machine", value: m }))}
        {unread.length > 0 && <span className="ml-auto text-xs text-dim">{tx("{0} : non lus, absents du tableau", unread.join(", "))}</span>}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full border-collapse text-sm">
          <thead><tr>
            <Th k="name" sort={sort}>{tx("Modèle")}</Th><Th k="engine" sort={sort}>{tx("Moteur")}</Th><Th k="machine" sort={sort}>{tx("Machine")}</Th>
            <Th k="size" sort={sort} className="text-right">{tx("Taille")}</Th><Th k="quant" sort={sort}>{tx("Quantif.")}</Th><Th k="family" sort={sort}>{tx("Famille")}</Th>
            <Th k="params" sort={sort}>{tx("Paramètres")}</Th><Th k="context" sort={sort} className="text-right">{tx("Contexte")}</Th>
            <Th k="state" sort={sort}>{tx("État")}</Th><Th k="vram" sort={sort} className="text-right">{tx("Mémoire GPU")}</Th>
          </tr></thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">
            {sort.sorted.map((m) => (
              <tr key={`${m.card?.key ?? m.via}/${m.machine}/${m.name}`} className={m.card?.serviceHash ? "cursor-pointer hover:bg-bg2" : ""} onClick={() => { if (m.card?.serviceHash) location.hash = m.card.serviceHash; }}>
                <Td className="font-mono text-[13px]">{m.name}</Td>
                <Td>{m.engine}{m.via && <span className="ml-1.5"><Badge tone="off" outline title={tx("Vu en train de tourner par GpuViewR, sans connecteur pour ce moteur")}>{m.via}</Badge></span>}</Td>
                <Td>{m.machine ?? "-"}</Td>
                <Td className="text-right tabular-nums">{modelSize(m)}</Td>
                <Td>{m.quant ?? "-"}</Td><Td>{m.family ?? "-"}</Td><Td>{m.params ?? "-"}</Td>
                <Td className="text-right tabular-nums">{num(m.context)}</Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={m.loaded ? "ok" : "off"} />{modelState(m)}</span></Td>
                <Td className="text-right tabular-nums">{m.vram ? bytes(m.vram) : "-"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dim>{tx("Un clic sur une ligne ouvre la fiche du moteur dans Services. Un même modèle sur deux moteurs apparaît deux fois, une ligne par moteur.")}</Dim>
    </>
  );
}

function Agents({ snap, cards }: Readonly<{ snap: Snapshot; cards: AiCard[] }>) {
  const links = useMemo(() => aiLinks(snap, cards), [snap, cards]);
  const agents = cards.filter((c) => c.role === "agent"), ui = cards.filter((c) => c.role === "interface"), mcp = cards.filter((c) => c.role === "mcp");
  const partialUi = ui.filter((c) => c.partial && !c.unread);
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {agents.map((a) => (
          <FoldPanel key={a.key} id={`ai-agent-${a.key}`} icon={Bot} title={a.title} extra={<><Dot tone={a.tone} /><Dim>{[a.machine, a.version].filter(Boolean).join(" · ")}</Dim></>}>
            <AgentBody a={a} />
          </FoldPanel>
        ))}
        <FoldPanel id="ai-mcp" icon={Workflow} title={tx("Serveurs MCP")} count={mcp.length + 1}>
          <ul className="flex flex-col text-sm [&>li:nth-child(even)]:bg-bg/50">
            {mcp.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-2">
                <Dot tone={m.tone} /><span className="min-w-0 flex-1"><b className="block">{m.title}</b><span className="text-muted">{[m.machine, m.port && `port ${m.port}`].filter(Boolean).join(" · ")}</span></span>
                {m.serviceHash && <a href={m.serviceHash} className="text-link hover:underline">{tx("Fiche")} ›</a>}
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-2">
              <Dot tone="ok" /><span className="min-w-0 flex-1"><b className="block">{tx("MCP de MyServices")}</b><span className="text-muted">{tx("Ses jetons se gèrent dans Comptes et accès.")}</span></span>
              <a href="#settings/api" className="text-link hover:underline">{tx("Jetons API et MCP")} ›</a>
            </li>
          </ul>
        </FoldPanel>
      </div>
      <FoldPanel id="ai-links" icon={ArrowRight} title={tx("Qui parle à qui")} count={links.length}>
        {links.length ? (
          <ul className="flex flex-col gap-2">
            {links.map((l) => (
              <li key={`${l.from.key}>${l.toLabel}>${l.via}`} className="grid items-center gap-2 text-sm md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,14rem)]">
                <Node title={l.from.title} sub={l.from.machine} hash={l.from.serviceHash} />
                <ArrowRight size={16} className="justify-self-center text-dim max-md:rotate-90" aria-hidden />
                <Node title={l.toLabel} sub={l.toSub} hash={l.to?.serviceHash} outside={!l.to} />
                <span className="flex flex-wrap items-center gap-1.5"><Badge tone="off" outline>{l.via}</Badge>{l.guess && <Badge tone="warn" outline title={tx("Relié par le nom du modèle : un autre serveur peut servir le même")}>{tx("déduit")}</Badge>}</span>
              </li>
            ))}
          </ul>
        ) : <Dim>{tx("Aucun lien lu pour l'instant.")}</Dim>}
        <InfoNote className="mt-3" tone={partialUi.length ? "warn" : "info"}>
          {partialUi.length ? tx("{0} : donnez la clé d'API d'un admin à son connecteur pour voir à quels serveurs de modèles et d'outils elle est reliée.", partialUi.map((c) => c.title).join(", "))
            : tx("Ces liens viennent des réglages lus (Open WebUI avec la clé d'un admin) ou du nom du modèle utilisé (« déduit »). Sans source, la ligne n'apparaît pas : MyServices ne devine rien d'autre.")}
        </InfoNote>
      </FoldPanel>
    </>
  );
}

/** The inside of an agent panel: why it is not read, else its platforms and sessions */
function AgentBody({ a }: Readonly<{ a: AiCard }>) {
  if (a.unread) return <Dim>{tx("Contenu non lu : aucun connecteur ne lit cet agent.")}</Dim>;
  if (a.partial) return <InfoNote>{tx("Adresse de la passerelle : la version seulement. Donnez l'adresse du tableau de bord (port 19119) pour voir ses plateformes et son modèle.")}</InfoNote>;
  return (
    <ul className="flex flex-col text-sm [&>li:nth-child(even)]:bg-bg/50">
      {(a.conn?.ai?.platforms ?? []).map((p) => (
        <li key={p.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] items-center gap-x-6 rounded px-2 py-1.5 md:grid-cols-[minmax(0,14rem)_minmax(0,8rem)_minmax(0,1fr)]">
          <span className="truncate font-mono text-[13px]">{p.name}</span>
          <span className="inline-flex items-center gap-1.5"><Dot tone={p.state === "connected" ? "ok" : "bad"} />{p.state === "connected" ? tx("connectée") : p.state}</span>
          <span className="col-span-2 truncate text-muted md:col-span-1" title={p.error}>{p.error ?? ""}</span>
        </li>
      ))}
      {a.conn?.ai?.sessions != null && <li className="px-2 py-1.5 text-muted">{tx("{0} session(s) en cours", a.conn.ai.sessions)}</li>}
    </ul>
  );
}

function Node({ title, sub, hash, outside = false }: Readonly<{ title: string; sub?: string; hash?: string; outside?: boolean }>) {
  const body = <><b className="block truncate">{title}</b>{sub && <span className="block truncate text-xs text-muted">{sub}</span>}</>;
  const cls = `min-w-0 rounded-lg border px-3 py-2 bg-bg2 ${outside ? "border-dashed border-line" : "border-line"}`;
  return hash ? <a href={hash} className={`${cls} hover:border-link`}>{body}</a> : <div className={cls}>{body}</div>;
}

function Bar({ icon, label, pct, value }: Readonly<{ icon: React.ReactNode; label: string; pct: number | null; value: React.ReactNode }>) {
  if (pct == null && value == null) return null;
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
      <span className="flex items-center gap-1.5 text-muted">{icon}{label}</span>
      <span className="block h-2.5 overflow-hidden rounded-full border border-line bg-bg2">{pct != null && <GradientFill pct={pct} />}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function Gpus({ gpus, models }: Readonly<{ gpus: GpuCard[]; models: ModelRow[] }>) {
  if (!gpus.length) return <EngineVram models={models} />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {gpus.map((c) => <GpuPanel key={c.key} c={c} />)}
    </div>
  );
}

/** Without GpuViewR: the GPU memory the engines give, model by model */
function EngineVram({ models }: Readonly<{ models: ModelRow[] }>) {
  const vram = models.filter((m) => m.vram && !m.via);
  return (
    <>
      <InfoNote>{tx("GpuViewR n'est pas relié : seule la mémoire GPU donnée par les moteurs, modèle par modèle, est connue. La température, le calcul et la puissance demandent GpuViewR.")}</InfoNote>
      {vram.length ? (
        <ul className="flex flex-col rounded-2xl border border-line bg-card p-2 text-sm [&>li:nth-child(even)]:bg-bg/50">
          {vram.map((m) => <li key={`${m.card?.key}/${m.name}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_6rem] gap-4 rounded px-2 py-1.5"><span className="truncate font-mono text-[13px]">{m.name}</span><span className="truncate text-muted">{m.engine} · {m.machine}</span><span className="text-right tabular-nums">{bytes(m.vram)}</span></li>)}
        </ul>
      ) : <Empty>{tx("Aucun modèle chargé en mémoire GPU pour l'instant.")}</Empty>}
    </>
  );
}

const gpuFull = (pct: number | null) => pct != null && pct >= GPU_FULL;

function gpuDot(online: boolean, pct: number | null): "off" | "warn" | "ok" {
  if (!online) return "off";
  return gpuFull(pct) ? "warn" : "ok";
}

/** « 120 W », or « 120 / 250 W » when the limit is known */
function powerValue(g: GpuRead): string | null {
  if (g.power == null) return null;
  const limit = g.power_limit ? ` / ${Math.round(g.power_limit)}` : "";
  return `${Math.round(g.power)}${limit} W`;
}

const powerPct = (g: GpuRead): number | null => (g.power != null && g.power_limit ? (g.power / g.power_limit) * 100 : null);

/** The driver, the shared memory and the peaks of the last 24 h, those that were read */
function gpuNotes(g: GpuRead): string {
  const day = g.day ?? {};
  return [g.shared && tx("mémoire partagée (VRAM + mémoire système)"), g.driver && tx("pilote {0}", g.driver),
    day.temp_max != null && tx("24 h : {0} °C au plus", Math.round(day.temp_max)), day.util_max != null && tx("calcul {0} % au plus", Math.round(day.util_max))].filter(Boolean).join(" · ");
}

function GpuBars({ g, pct }: Readonly<{ g: GpuRead; pct: number | null }>) {
  const mem = g.mem_used == null ? null : `${bytes(g.mem_used * MIB)} / ${bytes((g.mem_total ?? 0) * MIB)}`;
  const util = g.util == null ? null : <Pct value={Math.round(g.util)} />;
  const tempPct = g.temp == null ? null : (g.temp / (g.temp_limit ?? 100)) * 100;
  const temp = g.temp == null ? null : <Pct value={Math.round(g.temp)} unit="°C" />;
  return (
    <>
      <Bar icon={<MemoryStick size={13} aria-hidden />} label={tx("Mémoire")} pct={pct} value={mem} />
      <Bar icon={<Gauge size={13} aria-hidden />} label={tx("Calcul")} pct={g.util ?? null} value={util} />
      <Bar icon={<Thermometer size={13} aria-hidden />} label={tx("Température")} pct={tempPct} value={temp} />
      <Bar icon={<Zap size={13} aria-hidden />} label={tx("Puissance")} pct={powerPct(g)} value={powerValue(g)} />
      {g.fan != null && <Bar icon={<Fan size={13} aria-hidden />} label={tx("Ventilateur")} pct={g.fan} value={<Pct value={Math.round(g.fan)} />} />}
    </>
  );
}

function GpuPanel({ c }: Readonly<{ c: GpuCard }>) {
  const { key, machine, online, gpu: g, processes } = c, pct = memPct(g);
  const total = g.mem_total ? ` · ${bytes(g.mem_total * MIB)}` : "";
  return (
    <FoldPanel id={`ai-gpu-${key}`} icon={Cpu} title={g.name ?? "GPU"} tone={gpuFull(pct) ? "warn" : "off"}
      extra={<><Dot tone={gpuDot(online, pct)} /><Dim>{machine}{total}</Dim></>}>
      <div className="flex flex-col gap-2">
        <GpuBars g={g} pct={pct} />
        <Dim>{gpuNotes(g)}</Dim>
        {processes.length > 0 && (
          <ul className="mt-1 flex flex-col border-t border-line/60 pt-2 text-sm [&>li:nth-child(even)]:bg-bg/50">
            {processes.map((p) => (
              <li key={`${p.name}/${p.model ?? ""}`} className="grid grid-cols-[minmax(0,1fr)_6rem] gap-4 rounded px-2 py-1">
                <span className="truncate">{p.name}{p.model && <span className="text-muted"> · {p.model}</span>}</span><span className="text-right tabular-nums">{bytes(p.mem_mb * MIB)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FoldPanel>
  );
}
