// « IA et agents »: what the AI services contain (models, agents and their platforms, MCP servers, who talks to whom, GPUs), from the AI
// connectors and GpuViewR. No probe and no form of its own: the state is the one of Services, a service is declared in Services or
// Connectors, and every card and row leads to the page of its service. Four sub-pages of the side menu: #ai/overview, models, agents, gpu.
import { ArrowRight, Bot, Cpu, Eye, Fan, Gauge, MemoryStick, Plug, Thermometer, Workflow, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { aiAlerts, aiCards, aiGpus, aiLinks, aiModels, GPU_FULL, memPct, type AiCard, type AiRole, type GpuCard, type ModelRow } from "../lib/ai";
import { appIcon } from "../lib/appIcons";
import { openConnector } from "../lib/connectorPrefill";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import { Badge, Dim, Empty, GradientFill, Pct, Td, Th } from "../components/ui";
import { Dot, Logo } from "../components/marks";
import { FoldPanel } from "../components/FoldPanel";
import { HeadTags } from "../components/HeadTags";
import { InfoNote } from "../components/InfoNote";
import { StatTile } from "../components/StatTile";

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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Bot size={18} aria-hidden />{tx("IA et agents")}</h1>
        <HeadTags counts={[tx("{0} services", cards.length), tx("{0} machines", machines)]} sources={read} others={unread} at={snap.data.generated} />
        {admin && <a href="#settings/connectors" className="ml-auto text-sm text-link hover:underline">{tx("Connecteurs")} ›</a>}
      </div>
      {!cards.length && <Empty>{tx("Aucun service IA pour l'instant : un service de catégorie « IA » dans Services, ou un connecteur IA, fait apparaître cette page.")}</Empty>}
      {cards.length > 0 && view === "overview" && <Overview cards={cards} models={models} gpus={gpus} admin={admin} />}
      {cards.length > 0 && view === "models" && <Models rows={models} cards={cards} />}
      {cards.length > 0 && view === "agents" && <Agents snap={snap} cards={cards} />}
      {cards.length > 0 && view === "gpu" && <Gpus gpus={gpus} models={models} />}
    </div>
  );
}

function Overview({ cards, models, gpus, admin }: Readonly<{ cards: AiCard[]; models: ModelRow[]; gpus: GpuCard[]; admin: boolean }>) {
  const alerts = aiAlerts(cards, gpus);
  const engines = cards.filter((c) => c.role === "engine"), agents = cards.filter((c) => c.role === "agent");
  const loaded = models.filter((m) => m.loaded).length;
  const plats = agents.flatMap((a) => a.conn?.ai?.platforms ?? []), up = plats.filter((p) => p.state === "connected").length;
  const used = gpus.reduce((t, g) => t + (g.gpu.mem_used ?? 0), 0), total = gpus.reduce((t, g) => t + (g.gpu.mem_total ?? 0), 0);
  const gpuPct = total ? Math.round((used / total) * 100) : null;
  return (
    <>
      <InfoNote>{tx("Ce que contiennent vos services IA : modèles, agents, GPU. Leur état (en ligne, en panne, en pause) vient de Services, sans sonde en plus. Pour ajouter ou modifier un service, passez par Services ou Connecteurs.")}</InfoNote>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={engines.length} label={tx("Moteurs")} sub={[...new Set(engines.map((e) => e.title))].join(", ") || tx("aucun")} />
        <StatTile n={models.length} label={tx("Modèles")} sub={tx("{0} chargés en mémoire", loaded)} />
        <StatTile n={agents.length} label={tx("Agents")} tone={plats.length && up < plats.length ? "warn" : undefined} sub={plats.length ? tx("{0} plateformes sur {1}", up, plats.length) : tx("aucune plateforme lue")} />
        <StatTile n={gpuPct == null ? "-" : `${gpuPct} %`} label={tx("Mémoire GPU")} tone={gpuPct != null && gpuPct >= GPU_FULL ? "warn" : undefined} sub={gpus.length ? tx("{0} GPU, lus par GpuViewR", gpus.length) : tx("GpuViewR non relié")} />
      </div>
      {alerts.length > 0 && (
        <FoldPanel id="ai-watch" icon={Eye} title={tx("À surveiller")} count={alerts.length} tone={alerts.some((a) => a.tone === "bad") ? "bad" : "warn"}>
          <ul className="flex flex-col [&>li:nth-child(even)]:bg-bg/50">
            {alerts.map((a) => (
              <li key={a.title} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2">
                <Dot tone={a.tone} />
                <span className="min-w-0 flex-1"><b className="block font-semibold">{a.title}</b>{a.detail && <span className="text-sm text-muted">{a.detail}</span>}</span>
                {a.prefill && admin && <AddConnector prefill={a.prefill} />}
                {a.hash && <a href={a.hash} className="text-sm text-link hover:underline">{tx("Voir")} ›</a>}
              </li>
            ))}
          </ul>
        </FoldPanel>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => <ServiceCard key={c.key} c={c} admin={admin} />)}
      </div>
      <Dim>{tx("Tri : ce qui demande un œil d'abord, puis moteurs, agents, interfaces, MCP. Bordure en pointillés : service connu de Services dont le contenu n'est pas lu.")}</Dim>
    </>
  );
}

/** The figures of a card, by role: only what was read */
function cardFacts(c: AiCard): [string, string][] {
  const ai = c.conn?.ai, out: [string, string][] = [];
  if (c.machine || c.ip) out.push([tx("Machine"), [c.machine, c.ip].filter(Boolean).join(" · ")]);
  if (c.version) out.push([tx("Version"), c.version]);
  if (c.unread) return [...out, [tx("Contenu"), tx("non lu")]];
  if (c.role === "engine") {
    const loaded = c.models.filter((m) => m.loaded).map((m) => m.name);
    out.push([tx("Modèles"), tx("{0} installés", c.models.length)], [tx("Chargés"), loaded.join(", ") || tx("aucun")]);
  } else if (c.role === "agent") {
    const p = ai?.platforms ?? [], model = ai?.uses?.find((u) => "model" in u);
    if (p.length) out.push([tx("Plateformes"), tx("{0}/{1} connectées", p.filter((x) => x.state === "connected").length, p.length)]);
    if (model && "model" in model) out.push([tx("Modèle"), model.model]);
  } else if (c.role === "interface") {
    out.push([tx("Modèles proposés"), String(c.models.length)]);
    if (ai?.uses?.length) out.push([tx("Reliée à"), tx("{0} serveurs", ai.uses.length)]);
  } else if (c.role === "gpu") {
    for (const f of (c.conn?.facts ?? []).slice(0, 2)) out.push([f.label, f.value]);
  }
  if (c.partial) out.push([tx("Lecture"), tx("partielle")]);
  return out.slice(0, 5);
}

function ServiceCard({ c, admin }: Readonly<{ c: AiCard; admin: boolean }>) {
  const icon = appIcon([c.title, c.engine ?? "", c.conn?.label ?? ""]);
  return (
    <article className={`flex h-56 min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ${c.unread ? "border-dashed border-line" : "border-line"}`}>
      <div className="flex items-center gap-2 border-b border-line/60 bg-bg px-4 py-2.5">
        <Dot tone={c.tone} />
        {icon ? <Logo src={icon} /> : <Bot size={14} className="text-muted" aria-hidden />}
        <h2 className="min-w-0 truncate font-bold" title={c.title}>{c.title}</h2>
        <Badge tone="off" outline>{ROLE[c.role]}</Badge>
        <span className="ml-auto truncate text-xs text-dim" title={c.state}>{c.state}</span>
      </div>
      <dl className="grid flex-1 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-4 gap-y-1 px-4 py-3 text-sm">
        {cardFacts(c).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="truncate tabular-nums" title={v}>{v}</dd></div>)}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-4 py-2 text-sm">
        {c.serviceHash && <a href={c.serviceHash} className="text-link hover:underline">{tx("Fiche du service")} ›</a>}
        {c.prefill && admin && <AddConnector prefill={c.prefill} />}
        {c.unread && !c.connector && <Dim>{tx("pas de connecteur pour cette appli")}</Dim>}
        {!c.unread && c.role === "engine" && c.models.length > 0 && <a href="#ai/models" className="text-link hover:underline">{tx("Ses modèles")} ›</a>}
        {!c.unread && (c.role === "agent" || c.role === "interface") && <a href="#ai/agents" className="text-link hover:underline">{tx("Agents et MCP")} ›</a>}
      </div>
    </article>
  );
}

/** Opens Connectors on the form of the connector this service needs, already filled with its address */
function AddConnector({ prefill }: Readonly<{ prefill: NonNullable<AiCard["prefill"]> }>) {
  return (
    <button type="button" onClick={() => openConnector(prefill)} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
      <Plug size={13} aria-hidden />{tx("Ajouter un connecteur")} ›
    </button>
  );
}

type ModelFilter = { kind: "all" | "loaded" | "engine" | "machine"; value?: string };

function Models({ rows, cards }: Readonly<{ rows: ModelRow[]; cards: AiCard[] }>) {
  const [f, setF] = useState<ModelFilter>({ kind: "all" });
  const shown = rows.filter((m) => f.kind === "all" || (f.kind === "loaded" ? m.loaded : f.kind === "engine" ? m.engine === f.value : m.machine === f.value));
  const keyOf = (m: ModelRow, k: string): string | number => (k === "size" ? m.size ?? -1 : k === "context" ? m.context ?? -1 : k === "vram" ? m.vram ?? -1 : k === "state" ? Number(!m.loaded) : String((m as unknown as Record<string, unknown>)[k] ?? "").toLowerCase());
  const sort = useSort(shown, keyOf, "name");
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
                <Td className="text-right tabular-nums">{m.cloud ? <Dim>{tx("cloud")}</Dim> : m.size ? bytes(m.size) : "-"}</Td>
                <Td>{m.quant ?? "-"}</Td><Td>{m.family ?? "-"}</Td><Td>{m.params ?? "-"}</Td>
                <Td className="text-right tabular-nums">{num(m.context)}</Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={m.loaded ? "ok" : "off"} />{m.cloud ? tx("sur ollama.com") : m.loaded ? tx("chargé") : tx("sur disque")}</span></Td>
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
            {a.unread ? <Dim>{tx("Contenu non lu : aucun connecteur ne lit cet agent.")}</Dim>
              : a.partial ? <InfoNote>{tx("Adresse de la passerelle : la version seulement. Donnez l'adresse du tableau de bord (port 19119) pour voir ses plateformes et son modèle.")}</InfoNote>
              : (
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
              )}
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
  if (!gpus.length) {
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
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {gpus.map(({ key, machine, online, gpu: g, processes }) => {
        const pct = memPct(g), tempMax = g.temp_limit ?? 100;
        return (
          <FoldPanel key={key} id={`ai-gpu-${key}`} icon={Cpu} title={g.name ?? "GPU"} tone={pct != null && pct >= GPU_FULL ? "warn" : "off"}
            extra={<><Dot tone={!online ? "off" : pct != null && pct >= GPU_FULL ? "warn" : "ok"} /><Dim>{machine}{g.mem_total ? ` · ${bytes(g.mem_total * MIB)}` : ""}</Dim></>}>
            <div className="flex flex-col gap-2">
              <Bar icon={<MemoryStick size={13} aria-hidden />} label={tx("Mémoire")} pct={pct} value={g.mem_used != null ? `${bytes(g.mem_used * MIB)} / ${bytes((g.mem_total ?? 0) * MIB)}` : null} />
              <Bar icon={<Gauge size={13} aria-hidden />} label={tx("Calcul")} pct={g.util ?? null} value={g.util != null ? <Pct value={Math.round(g.util)} /> : null} />
              <Bar icon={<Thermometer size={13} aria-hidden />} label={tx("Température")} pct={g.temp != null ? (g.temp / tempMax) * 100 : null} value={g.temp != null ? <Pct value={Math.round(g.temp)} unit="°C" /> : null} />
              <Bar icon={<Zap size={13} aria-hidden />} label={tx("Puissance")} pct={g.power != null && g.power_limit ? (g.power / g.power_limit) * 100 : null} value={g.power != null ? `${Math.round(g.power)}${g.power_limit ? ` / ${Math.round(g.power_limit)}` : ""} W` : null} />
              {g.fan != null && <Bar icon={<Fan size={13} aria-hidden />} label={tx("Ventilateur")} pct={g.fan} value={<Pct value={Math.round(g.fan)} />} />}
              <Dim>{[g.shared && tx("mémoire partagée (VRAM + mémoire système)"), g.driver && tx("pilote {0}", g.driver),
                g.day?.temp_max != null && tx("24 h : {0} °C au plus", Math.round(g.day.temp_max)), g.day?.util_max != null && tx("calcul {0} % au plus", Math.round(g.day.util_max))].filter(Boolean).join(" · ")}</Dim>
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
      })}
    </div>
  );
}
