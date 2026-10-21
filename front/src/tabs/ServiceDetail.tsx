// Fiche d'un service (ligne dépliée) : identité, service, réseau & NPM.
import { Globe, Pause, Play, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { send } from "../api";
import { NoteLine } from "../components/form";
import { act, quiet, type Note } from "../lib/forms";
import { CHECK, KIND_NAME, checks, noIdentity, status } from "../lib/status";
import { mergePorts } from "../lib/servicesState";
import type { Host } from "../types";
import { tx } from "../lib/i18n";
import { TONES } from "../lib/tones";

type Row = [string, ReactNode, ("ok" | "warn" | "bad" | "mut" | "mono")?];
const PORT_TONE: Record<string, string> = { bad: "text-bad", warn: "text-warn", ok: "text-ok", off: "text-dim" };

const CLS = { ok: "text-ok", warn: "text-warn", bad: "text-bad", mut: "text-dim", mono: "font-mono text-xs" };

function yes(v: boolean | undefined, good: boolean | null): Row[2] {
  return v ? (good === false ? "warn" : good ? "ok" : undefined) : good ? "bad" : "mut";
}
const yn = (v: boolean | undefined) => (v ? "oui" : "non");

function Block({ title, tone, rows }: { title: string; tone: keyof typeof TONES; rows: Row[] }) {
  const t = TONES[tone];
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-line/60 border-l-4 ${t.box}`}>
      <h4 className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${t.head}`}>{title}</h4>
      <dl className="mx-3 mb-3 mt-2 grid grid-cols-[minmax(90px,auto)_1fr] overflow-hidden rounded-md text-sm">
        {rows.map(([k, v, c], i) => (
          <div key={i} className="contents">
            <dt className="px-2 py-1 font-semibold text-muted">{k}</dt>
            <dd className={`min-w-0 break-words px-3 py-1 ${c ? CLS[c] : ""}`}>{v ?? "-"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function link(url: string, text: string) {
  return <a href={url} target="_blank" rel="noopener" className="text-link hover:underline">{text}</a>;
}

/** An NPM host without access list nor LAN guard: « public site, on purpose » said once (services-meta « public »), or taken back (admin) */
function PublicOnPurpose({ r, admin }: Readonly<{ r: Host; admin: boolean }>) {
  const [note, setNote] = useState<Note>(null);
  const domain = r.domains[0];
  const set = (on: boolean) => act(() => send("PUT", "services/public", { domain, public: on }), on ? tx("déclaré public : il quitte « À surveiller »") : tx("déclaration retirée"), setNote);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={r.public_ok ? "text-dim" : ""}>{r.public_ok ? tx("site public (voulu)") : tx("aucune")}</span>
      {admin && domain && (r.public_ok
        ? <button type="button" className={`${quiet} py-0.5 text-xs`} onClick={() => void set(false)} title={tx("Le site n'est plus censé être public : il revient dans « À surveiller » tant qu'il n'a pas de liste d'accès")}><Undo2 size={13} aria-hidden />{tx("Ce n'est plus public")}</button>
        : <button type="button" className={`${quiet} py-0.5 text-xs`} onClick={() => void set(true)} title={tx("Ouvert à Internet volontairement (site, blog, page de contact) : ne plus le signaler")}><Globe size={13} aria-hidden />{tx("Site public voulu")}</button>)}
      <NoteLine note={note} />
    </span>
  );
}

/** A service of a machine in pause (not followed, or « pause » set by hand): why, and the way back (admin) */
function Paused({ r, admin }: { r: Host; admin: boolean }) {
  const [note, setNote] = useState<Note>(null);
  const resume = () => act(() => send("DELETE", `services/pause/${encodeURIComponent(`${r.ip}:${r.port}`)}`), tx("suivi repris : sondé à la prochaine collecte"), setNote);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line/60 bg-bg2/60 px-3 py-2 text-sm">
      <Pause size={15} className="shrink-0 text-dim" aria-hidden />
      <span className="min-w-0 flex-1 text-muted">{tx("En pause : ni sonde ni alerte.")} <span className="text-dim">{r.paused}</span></span>
      {admin && r.type === "local" && r.ip && r.port && <button type="button" className={quiet} onClick={() => void resume()}><Play size={14} aria-hidden />{tx("Reprendre le suivi")}</button>}
      <NoteLine note={note} />
    </div>
  );
}

type Tone = Row[2];
const optRows = (on: unknown, rows: Row[]): Row[] => (on ? rows : []);

/** Where a row goes: the redirect target, nothing for a 404 host, the incoming port of a stream, else the backend URL */
function targetText(r: Host): string {
  if (r.type === "redirect") return r.target ?? "-";
  if (r.type === "dead") return tx("aucune (404)");
  if (r.type === "stream") return `:${r.incoming_port} → ${r.ip}:${r.port}`;
  return `${r.scheme}://${r.ip}:${r.port}`;
}

/** The ports of the service as chips, the open one marked */
function PortsRow({ r, ports, onOpen }: Readonly<{ r: Host; ports: Host[]; onOpen?: (h: Host) => void }>) {
  return (
    <span className="flex flex-wrap gap-1">{ports.map((p) => (
      <button key={p.port} type="button" onClick={() => onOpen?.(p)} disabled={p === r} title={`${status(p)[1]} · ${status(p)[2]}`}
        className={`rounded border px-1.5 font-mono text-xs leading-5 ${p === r ? "border-link bg-link/15" : "border-line hover:border-link"} ${PORT_TONE[status(p)[0]] ?? ""}`}>:{p.port}</button>
    ))}</span>
  );
}

/** The rows that are the same service seen from elsewhere (an NPM host, the container behind it), one line each, a machine's service with its ports */
function RelatedRow({ related, onOpen }: Readonly<{ related: Host[]; onOpen?: (h: Host) => void }>) {
  return (
    <span className="flex flex-col gap-1">{mergePorts(related).map(({ lead: h, ports: hp }) => (
      <span key={`${h.type}${h.id}`} className="inline-flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onOpen?.(h)} className="font-semibold hover:text-link">{h.domains[0] ?? h.service?.name ?? `${h.ip}:${h.port}`}</button>
        {h.type === "local"
          ? <span className="inline-flex items-center gap-1 font-mono text-xs text-dim">{h.ip}{hp.map((x) => (
              <button key={x.port} type="button" onClick={() => onOpen?.(x)} title={status(x)[1]} className={`rounded border border-line px-1 leading-5 hover:border-link ${PORT_TONE[status(x)[0]] ?? ""}`}>:{x.port}</button>
            ))}</span>
          : <span className="text-xs text-dim">{tx("Proxy NPM → {0}:{1}", h.ip ?? "?", h.port ?? "?")}</span>}
        <span className={`text-xs ${PORT_TONE[status(h)[0]] ?? ""}`}>{status(h)[1]}</span>
      </span>
    ))}</span>
  );
}

function identRows(r: Host, ports: Host[], related: Host[], onOpen?: (h: Host) => void): Row[] {
  const s = r.service, ck = checks(r), desc = r.description || s?.description;
  return [
    ...optRows(ck.length, [[tx("À vérifier"), <ul key="checks" className="flex flex-col gap-0.5">{ck.map((k) => <li key={k}><b className="text-warn">⚑ {CHECK[k][0]}</b> <span className="text-dim">{CHECK[k][1]}</span></li>)}</ul>]]),
    ["Domaines", r.domains.join(", ") || "-", r.domains.length ? undefined : "mut"],
    ...optRows(ports.length > 1, [[tx("Ports"), <PortsRow key="ports" r={r} ports={ports} onOpen={onOpen} />]]),
    ...optRows(related.length, [[tx("Associé à"), <RelatedRow key="related" related={related} onOpen={onOpen} />]]),
    [tx("Catégorie"), [r.category, ...(r.tags || [])].filter(Boolean).join(" · ") || "-"],
    ["Description", desc || "-", desc ? undefined : "mut"],
    [tx("Titre de page"), r.page_title || "-", r.page_title ? undefined : "mut"],
    ["Machine", r.machine ? `${r.machine}${r.machine_role ? ` · ${r.machine_role}` : ""}` : "inconnue", r.machine ? undefined : "bad"],
    ["Cible", targetText(r), "mono"],
    [tx("Référence"), r.type === "local" ? String(r.id) : tx("NPM #{0}{1}", String(r.id).split("/").pop(), r.npm ? ` · ${r.npm}` : ""), "mono"],
  ];
}

/** The « Service » line: what runs behind, or why there is nothing to identify */
function serviceLine(r: Host): [string, Tone] {
  const s = r.service;
  if (s?.name) {
    const stale = s.stale ? ` (${tx("dernière identification connue")})` : "";
    return [`${KIND_NAME[s.kind] || s.kind} · ${s.name}${stale}`, s.stale ? "mut" : undefined];
  }
  const none = noIdentity(r);
  return [none ?? tx("non identifié"), none ? "mut" : "warn"];
}

function stateTone(state?: string | null): Tone {
  if (!state) return "mut";
  if (/unhealthy/.test(state)) return "bad";
  return /healthy/.test(state) ? "ok" : undefined;
}

function webcheckRow(r: Host): Row {
  const w = r.webcheck;
  if (!w) return ["Web-Check", "-", "mut"];
  let cert = tx("certificat : ?");
  if (w.cert_valid === false) cert = tx("certificat invalide");
  else if (w.cert_days != null) cert = tx("certificat : {0} j", w.cert_days);
  const text = [cert, w.hsts != null && tx("HSTS : {0}", yn(w.hsts)), w.headers_total ? tx("en-têtes : {0}/{1}", w.headers_ok, w.headers_total) : ""].filter(Boolean).join(" · ");
  return ["Web-Check", text, w.cert_valid === false || (w.cert_days ?? 99) < 21 ? "warn" : undefined];
}

const KUMA: Record<string, string> = { up: tx("en ligne"), down: tx("en panne"), pending: tx("en attente"), maintenance: "maintenance" };
const WEB: Record<string, string> = { ui: tx("interface web"), api: tx("API / sans page"), none: tx("pas de HTTP"), inconnu: "injoignable" };

function kumaRow(r: Host): Row {
  const list = r.uptime || [];
  const text = list.map((u) => `${u.name || "?"} : ${KUMA[u.status] || "?"}${u.response_ms != null ? tx(" · {0} ms", u.response_ms) : ""}`).join(" ; ") || "-";
  let tone: Tone = list.length ? undefined : "mut";
  if (list.some((u) => u.status === "down")) tone = "bad";
  return [tx("Uptime Kuma"), text, tone];
}

const httpUrl = (u?: string | null) => !!u && /^https?:\/\//.test(u);

function serviceRows(r: Host): Row[] {
  const s = r.service, [svcText, svcTone] = serviceLine(r);
  return [
    ...optRows(!s?.name && r.app, [["Appli devinée", `${r.app?.label} (${r.app?.confidence === "possible" ? tx("possible : port ou serveur web") : tx("probable : page ou en-têtes HTTP")})`, "mut"]]),
    ["Service", svcText, svcTone],
    ...optRows(r.app?.agent_of, [[tx("Agent de"), tx("{0} (pas de page, envoie ses données au serveur central)", r.app?.agent_of)]]),
    ...optRows(s?.kind === "apache", [["Vhost", s?.vhost || "-"], [tx("Fichiers servis"), s?.docroot || "-", "mono"], ["Config", s?.conf || "-", "mono"]]),
    ["Image", s?.image || "-", s?.image ? "mono" : "mut"],
    ["Version", s?.version || "-", s?.version ? undefined : "mut"],
    [tx("État"), s?.state || "-", stateTone(s?.state)],
    ["Compose", s?.compose || "-", s?.compose ? undefined : "mut"],
    ["Projet", httpUrl(s?.url) ? link(s!.url!, s!.url!.replace(/^https?:\/\//, "")) : "-", s?.url ? undefined : "mut"],
    ["Journaux", httpUrl(s?.logs_url) ? link(s!.logs_url!, tx("ouvrir dans Dozzle")) : "-", s?.logs_url ? undefined : "mut"],
    webcheckRow(r),
    kumaRow(r),
    [tx("Interface web"), WEB[r.web || ""] || "-", r.web === "ui" ? "ok" : "mut"],
  ];
}

function backendRow(r: Host, npmOnly: boolean): Row {
  const b = r.backend || {};
  if (npmOnly) return [tx("Backend TCP"), "-", "mut"];
  if (b.internal) return [tx("Backend TCP"), tx("interne, testé via NPM"), "mut"];
  return b.up ? [tx("Backend TCP"), tx("joignable · {0} ms", b.ms), "ok"] : [tx("Backend TCP"), tx("injoignable · {0}", b.err || "?"), "bad"];
}

function httpsRow(r: Host): Row {
  const p = r.public || {};
  if (!p.code) return [tx("HTTPS via NPM"), p.err || "-", p.err ? "bad" : "mut"];
  let tone: Tone = "ok";
  if (p.code >= 500) tone = "bad";
  else if (p.cert_ok === false || p.code >= 400) tone = "warn";
  return [tx("HTTPS via NPM"), tx("{0} · {1} ms{2}", p.code, p.ms, p.cert_ok === false ? tx(" · certificat ≠ nom") : ""), tone];
}

function aclRow(r: Host, npmOnly: boolean, admin: boolean): Row {
  let value: ReactNode;
  if (r.acl) value = r.acl;
  else if (r.acl_adv) value = tx("garde LAN (advanced_config)");
  else if (r.type === "proxy") value = <PublicOnPurpose r={r} admin={admin} />;
  else value = r.public_ok ? tx("site public (voulu)") : "aucune";
  let tone: Tone = "bad";
  if (r.acl || r.acl_adv) tone = "ok";
  else if (r.public_ok || npmOnly) tone = "mut";
  return [tx("Access list"), value, tone];
}

function nginxTone(r: Host): Tone {
  if (r.nginx_online === false) return "bad";
  return r.nginx_online ? "ok" : "mut";
}

function networkRows(r: Host, admin: boolean): Row[] {
  const npmOnly = r.type === "redirect" || r.type === "dead";
  const net: Row[] = [backendRow(r, npmOnly)];
  if (r.type !== "local" && r.type !== "stream") net.push(httpsRow(r), aclRow(r, npmOnly, admin),
    [tx("Certificat SSL"), yn(r.ssl), yes(r.ssl, true)], [tx("SSL forcé"), yn(r.ssl_forced), yes(r.ssl_forced, true)]);
  if (r.type === "proxy") net.push(
    [tx("Config nginx"), r.nginx_online === false ? tx("en erreur : {0}", r.nginx_err || "?") : (r.nginx_online && "OK") || "-", nginxTone(r)],
    ["HTTP/2", yn(r.http2), yes(r.http2, true)], ["HSTS", yn(r.hsts), yes(r.hsts, null)], ["Websocket", yn(r.websocket), yes(r.websocket, null)],
    [tx("Block exploits"), yn(r.block_exploits), yes(r.block_exploits, true)], [tx("Real IP Cloudflare"), yn(r.cloudflare), yes(r.cloudflare, null)],
    [tx("Créé"), r.created || "-", "mut"], [tx("Modifié"), r.modified || "-", "mut"],
  );
  return net;
}

export function ServiceDetail({ r, admin = false, ports = [], related = [], onOpen }: Readonly<{ r: Host; admin?: boolean; ports?: Host[]; related?: Host[]; onOpen?: (h: Host) => void }>) {
  return (
    <>
    {r.paused && <Paused r={r} admin={admin} />}
    <div className="grid gap-3 lg:grid-cols-3">
      <Block title={tx("Identité")} tone="link" rows={identRows(r, ports, related, onOpen)} />
      <Block title={tx("Service")} tone="violet" rows={serviceRows(r)} />
      <Block title={r.type === "local" ? tx("Réseau") : tx("Réseau & NPM")} tone="ok" rows={networkRows(r, admin)} />
    </div>
    </>
  );
}
