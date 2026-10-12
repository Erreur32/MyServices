// Services : tous les services (NPM et directs) avec leur état, leur machine et leurs accès ; clic sur une ligne
// = fiche détaillée. Sur mobile, une fiche par service.
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { ipNum } from "../lib/format";
import { Dot, Logo } from "../components/marks";
import { appIcon, serviceIcon } from "../lib/appIcons";
import { CHECK, CLEANUP, KIND_NAME, checks, exposure, hostName, noIdentity, status, type Check } from "../lib/status";
import type { Host } from "../types";
import { Badge, Cards, Dim, Empty, FilterBar, Table, Td, Th, type Tone } from "../components/ui";
import { ServiceDetail } from "./ServiceDetail";
import { OPEN_CARD, OPEN_DETAIL, OPEN_ROW } from "../lib/forms";
import { tx } from "../lib/i18n";

const ST_TONE: Record<string, Tone> = { ok: "ok", warn: "warn", bad: "bad", off: "off" };
const ST_NAME: Record<string, string> = { ok: "OK", warn: "avertissement", bad: tx("en panne"), off: tx("désactivé / non testé") };
const TYPE_NAME: Record<string, string> = { proxy: tx("Proxy NPM"), redirect: "Redirection", dead: "404", stream: "Stream", local: tx("Service") };
const EXPO: Record<string, [Tone, string, string]> = {
  prive: ["ok", tx("🔒 privé"), tx("Réservé au LAN / VPN : access list NPM ou garde LAN")],
  public: ["info", tx("🌍 public"), tx("Site public voulu")],
  ouvert: ["bad", tx("⚠ ouvert ?"), tx("Ni ACL ni déclaration publique : accessible depuis Internet sans restriction ?")],
};
const hostIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
const keyOfRow = (r: Host) => `${r.type}${r.id}`;

function url(r: Host): string | null {
  if (r.domains.length) return `https://${r.domains[0]}/`;
  return r.ip ? `${r.scheme || "http"}://${r.ip}:${r.port}/` : null;
}

function Name({ r }: { r: Host }) {
  const u = url(r), e = exposure(r);
  return (
    <div className="min-w-0">
      {u ? (
        <a href={u} target="_blank" rel="noopener" onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 font-semibold hover:text-link">
          <span className="truncate">{hostName(r)}</span><ExternalLink size={12} className="shrink-0 text-dim" />
        </a>
      ) : <b>{hostName(r)}</b>}
      {r.domains.length > 1 && <span className="ml-1 text-xs text-dim" title={r.domains.slice(1).join(", ")}>+{r.domains.length - 1}</span>}
      {e && <span className="ml-2"><Badge tone={EXPO[e][0]} title={EXPO[e][2]}>{EXPO[e][1]}</Badge></span>}
    </div>
  );
}

function State({ r, ck }: { r: Host; ck: Check[] }) {
  const [cls, label, why] = status(r);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <span className={`text-[11px] font-bold uppercase ${r.type === "local" ? "text-loc" : "text-npm"}`}>{TYPE_NAME[r.type]}</span>
        <Badge tone={ST_TONE[cls]}>{label}</Badge>
      </span>
      <span className="text-xs text-dim">{why}</span>
      {ck.filter((k) => !CLEANUP.includes(k)).map((k) => <span key={k} className="text-xs text-warn" title={CHECK[k][1]}>⚑ {CHECK[k][0]}</span>)}
    </div>
  );
}

/** Logo du service, dans sa propre colonne pour ne pas déformer le nom ; la place est gardée quand il n'y en a pas */
function ServiceLogo({ r }: { r: Host }) {
  const src = serviceIcon(r);
  return src ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-bg2" title={r.app?.label || r.service?.name}><img src={src} alt="" className="h-4 w-4" /></span> : <span className="block h-7 w-7 shrink-0" aria-hidden />;
}

function Tech({ r }: { r: Host }) {
  const s = r.service;
  if (!s && r.app) {  // pas d'identification sûre : l'appli devinée par la page, les en-têtes HTTP ou le port, avec son degré de confiance
    const how = CONFIDENCE[r.app.confidence];
    return <div className="min-w-0"><span className="font-medium">{r.app.label}</span><span className="block truncate text-xs text-dim" title={how[1]}>{how[0]}</span></div>;
  }
  if (!s) return <Dim>{noIdentity(r) ?? tx("non identifié")}</Dim>;
  return (
    <div className="min-w-0">
      <span className="font-medium">{s.title || s.name}{s.stale && <span className="ml-1.5 text-xs font-normal text-dim" title={tx("Le backend ne répond plus : identification du dernier passage où il répondait")}>⏳ {tx("dernière connue")}</span>}</span>
      <span className="block truncate text-xs text-dim">{KIND_NAME[s.kind] || s.kind}{s.version ? ` · ${s.version}` : ""}{s.image ? ` · ${s.image}` : ""}</span>
    </div>
  );
}

function Access({ r }: { r: Host }) {
  if (r.type === "local" || r.type === "stream") return <Dim>-</Dim>;
  return (
    <span className="flex flex-wrap gap-1">
      {r.type === "proxy" && (r.acl || r.acl_adv ? <Badge tone="ok" title={r.acl || tx("garde LAN")}>{tx("ACL")}</Badge> : r.public_ok ? <Badge tone="info">{tx("public")}</Badge> : <Badge tone="bad">{tx("sans ACL")}</Badge>)}
      {!r.ssl ? <Badge tone="bad">{tx("sans SSL")}</Badge> : !r.ssl_forced ? <Badge tone="warn">{tx("SSL non forcé")}</Badge> : <Badge tone="ok">{tx("SSL")}</Badge>}
      {r.hsts && <Badge tone="off">{tx("HSTS")}</Badge>}
    </span>
  );
}

const CONFIDENCE: Record<string, [string, string]> = {
  sure: [tx("sûr"), tx("Reconnu par son image Docker")],
  probable: [tx("probable"), tx("Reconnu par le titre de sa page ou ses en-têtes HTTP, sans SSH")],
  possible: [tx("possible"), tx("Deviné par son port ou son serveur web : à confirmer")],
};
const KIND_LOGO = new Set(["docker", "apache", "nginx"]);  // types de service qui ont un logo dans public/icons

export function Services({ snap, initial }: { snap: Snapshot; initial?: Selected }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const machines = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m.name])), [snap.data.machine_list]);
  const facets = useMemo((): Facet<Host>[] => [
    { key: "src", label: tx("Source"), get: (r) => (r.type === "local" ? "local" : "npm"), name: (v) => (v === "npm" ? "NPM" : tx("Services")), order: ["npm", "local"],
      mark: (v) => (v === "npm" ? <Logo src={`${import.meta.env.BASE_URL}icons/nginx-proxy-manager.svg`} /> : <Dot tone="info" />) },
    { key: "status", label: tx("État"), get: (r) => status(r)[0], name: (v) => ST_NAME[v] || v, order: ["bad", "warn", "ok", "off"], mark: (v) => <Dot tone={v as Tone} /> },
    { key: "check", label: tx("À vérifier"), get: (r) => checks(r), name: (v) => CHECK[v as Check]?.[0] || v, mark: (v) => <Dot tone={CLEANUP.includes(v as Check) ? "off" : "warn"} /> },
    { key: "machine", label: tx("Machine"), get: (r) => hostIp(r), name: (v) => machines.get(v) || v },
    { key: "cat", label: tx("Catégorie"), get: (r) => r.category || "" },
    { key: "app", label: tx("Appli"), get: (r) => r.app?.label || "", mark: (v) => { const i = appIcon([v]); return i ? <Logo src={i} /> : null; } },
    { key: "kind", label: tx("Type"), get: (r) => r.service?.kind || "", name: (v) => KIND_NAME[v] || v,
      mark: (v) => (KIND_LOGO.has(v) ? <Logo src={`${import.meta.env.BASE_URL}icons/${v}.svg`} /> : null) },
  ], [machines]);
  const text = useCallback((r: Host) => [
    ...r.domains, r.name, r.ip, r.port, r.target, r.machine, r.category, r.service?.name, r.service?.image, r.service?.title, r.description,
  ].join(" "), []);
  // Par défaut seuls les services en ligne s'affichent (le filtre « État : OK » se retire d'un clic) ; un filtre demandé ailleurs (compteur de l'accueil, machine) est gardé tel quel
  const f = useFilter(snap.data.hosts, facets, text, initial && Object.keys(initial).length ? initial : { status: ["ok"] });
  const keyOf = useCallback((r: Host, k: string): string | number => {
    switch (k) {
      case "status": return ["bad", "warn", "ok", "off"].indexOf(status(r)[0]);
      case "machine": return (r.machine || "~").toLowerCase();
      case "target": return ipNum(r.ip || "0") * 65536 + (r.port || 0);
      case "kind": return r.service?.kind || "~";
      default: return hostName(r).toLowerCase();
    }
  }, []);
  const sort = useSort(f.shown, keyOf, "status");
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Domaine, IP, port, conteneur, image…")} />
      {sort.sorted.length === 0 ? <Empty>{tx("Aucun service pour ce filtre.")}</Empty> : (
        <>
          <Table head={<>
            <Th className="w-6" /><Th className="w-10" /><Th k="status" sort={sort}>{tx("État")}</Th><Th k="name" sort={sort}>{tx("Service")}</Th><Th k="target" sort={sort}>{tx("Cible")}</Th>
            <Th k="machine" sort={sort}>{tx("Machine")}</Th><Th k="kind" sort={sort}>{tx("Logiciel")}</Th><Th>{tx("Accès")}</Th>
          </>}>
            {sort.sorted.map((r) => {
              const k = keyOfRow(r), ck = checks(r);
              return (
                <Fragment key={k}>
                  <tr onClick={() => toggle(k)} className={`cursor-pointer ${open[k] ? OPEN_ROW : "hover:bg-bg2/60"} ${r.enabled ? "" : "opacity-60"}`}>
                    <Td className="text-dim">{open[k] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</Td>
                    <td className="w-10 px-1 py-2.5 align-middle"><ServiceLogo r={r} /></td>
                    <Td className="w-[230px]"><State r={r} ck={ck} /></Td>
                    <Td className="max-w-[320px]"><Name r={r} /></Td>
                    <Td className="whitespace-nowrap font-mono text-xs text-muted">
                      {r.type === "redirect" ? `→ ${r.target}` : r.type === "dead" ? tx("aucune (404)") : `${r.ip}:${r.port}`}
                    </Td>
                    <Td>{r.machine ? <><b className="font-medium">{r.machine}</b>{r.category && <span className="block text-xs text-dim">{r.category}</span>}</> : <Dim>-</Dim>}</Td>
                    <Td className="max-w-[260px]"><Tech r={r} /></Td>
                    <Td><Access r={r} /></Td>
                  </tr>
                  {open[k] && <tr className={`bg-bg/40 ${OPEN_DETAIL}`}><td colSpan={8} className="p-3"><ServiceDetail r={r} /></td></tr>}
                </Fragment>
              );
            })}
          </Table>
          <Cards>
            {sort.sorted.map((r) => {
              const k = keyOfRow(r), [cls, label] = status(r);
              return (
                <div key={k} className={`rounded-2xl border border-line bg-card p-3.5 ${open[k] ? OPEN_CARD : ""} ${r.enabled ? "" : "opacity-70"}`}>
                  <button type="button" onClick={() => toggle(k)} className="flex w-full items-start justify-between gap-2 text-left">
                    <ServiceLogo r={r} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{hostName(r)}</b>
                      <span className="block text-xs text-dim">{r.machine || tx("machine inconnue")} · {r.ip ? `${r.ip}:${r.port}` : r.target || ""}</span>
                    </span>
                    <Badge tone={ST_TONE[cls]}>{label}</Badge>
                  </button>
                  {open[k] && <div className="mt-3"><ServiceDetail r={r} /></div>}
                </div>
              );
            })}
          </Cards>
        </>
      )}
    </div>
  );
}
