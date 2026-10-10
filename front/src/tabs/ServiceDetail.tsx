// Fiche d'un service (ligne dépliée) : identité, service, réseau & NPM.
import type { ReactNode } from "react";
import { CHECK, KIND_NAME, checks } from "../lib/status";
import type { Host } from "../types";
import { tx } from "../lib/i18n";

type Row = [string, ReactNode, ("ok" | "warn" | "bad" | "mut" | "mono")?];

const CLS = { ok: "text-ok", warn: "text-warn", bad: "text-bad", mut: "text-dim", mono: "font-mono text-xs" };

function yes(v: boolean | undefined, good: boolean | null): Row[2] {
  return v ? (good === false ? "warn" : good ? "ok" : undefined) : good ? "bad" : "mut";
}
const yn = (v: boolean | undefined) => (v ? "oui" : "non");

function Block({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-bg2/60 p-3">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-dim">{title}</h4>
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v, c], i) => (
          <div key={i} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className={`min-w-0 break-words ${c ? CLS[c] : ""}`}>{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function link(url: string, text: string) {
  return <a href={url} target="_blank" rel="noopener" className="text-link hover:underline">{text}</a>;
}

export function ServiceDetail({ r }: { r: Host }) {
  const s = r.service, b = r.backend || {}, p = r.public || {};
  const npmOnly = r.type === "redirect" || r.type === "dead";
  const ck = checks(r);
  const ident: Row[] = [
    ...(ck.length ? [[tx("À vérifier"), <ul className="flex flex-col gap-0.5">{ck.map((k) => <li key={k}><b className="text-warn">⚑ {CHECK[k][0]}</b> <span className="text-dim">{CHECK[k][1]}</span></li>)}</ul>] as Row] : []),
    ["Domaines", r.domains.join(", ") || "—", r.domains.length ? undefined : "mut"],
    [tx("Catégorie"), [r.category, ...(r.tags || [])].filter(Boolean).join(" · ") || "—"],
    ["Description", r.description || s?.description || "—", r.description || s?.description ? undefined : "mut"],
    [tx("Titre de page"), r.page_title || "—", r.page_title ? undefined : "mut"],
    ["Machine", r.machine ? `${r.machine}${r.machine_role ? ` · ${r.machine_role}` : ""}` : "inconnue", r.machine ? undefined : "bad"],
    ["Cible", r.type === "redirect" ? r.target : r.type === "dead" ? tx("aucune (404)") : r.type === "stream" ? `:${r.incoming_port} → ${r.ip}:${r.port}` : `${r.scheme}://${r.ip}:${r.port}`, "mono"],
    [tx("Référence"), r.type === "local" ? String(r.id) : tx("NPM #{0}{1}", String(r.id).split("/").pop(), r.npm ? ` · ${r.npm}` : ""), "mono"],
  ];
  const svc: Row[] = [
    ["Service", s?.name ? `${KIND_NAME[s.kind] || s.kind} · ${s.name}` : tx("non identifié"), s?.name ? undefined : "warn"],
    ...(s?.kind === "apache" ? [["Vhost", s.vhost || "—"], [tx("Fichiers servis"), s.docroot || "—", "mono"], ["Config", s.conf || "—", "mono"]] as Row[] : []),
    ["Image", s?.image || "—", s?.image ? "mono" : "mut"],
    ["Version", s?.version || "—", s?.version ? undefined : "mut"],
    [tx("État"), s?.state || "—", !s?.state ? "mut" : /unhealthy/.test(s.state) ? "bad" : /healthy/.test(s.state) ? "ok" : undefined],
    ["Compose", s?.compose || "—", s?.compose ? undefined : "mut"],
    ["Projet", s?.url && /^https?:\/\//.test(s.url) ? link(s.url, s.url.replace(/^https?:\/\//, "")) : "—", s?.url ? undefined : "mut"],
    ["Journaux", s?.logs_url && /^https?:\/\//.test(s.logs_url) ? link(s.logs_url, tx("ouvrir dans Dozzle")) : "—", s?.logs_url ? undefined : "mut"],
    ["Web-Check", r.webcheck ? [
      r.webcheck.cert_valid === false ? tx("certificat invalide") : r.webcheck.cert_days != null ? tx("certificat : {0} j", r.webcheck.cert_days) : tx("certificat : ?"),
      r.webcheck.hsts != null && tx("HSTS : {0}", yn(r.webcheck.hsts)),
      r.webcheck.headers_total ? tx("en-têtes : {0}/{1}", r.webcheck.headers_ok, r.webcheck.headers_total) : "",
    ].filter(Boolean).join(" · ") : "—", r.webcheck ? (r.webcheck.cert_valid === false || (r.webcheck.cert_days ?? 99) < 21 ? "warn" : undefined) : "mut"],
    [tx("Uptime Kuma"), (r.uptime || []).map((u) => `${u.name || "?"} : ${({ up: tx("en ligne"), down: tx("en panne"), pending: tx("en attente"), maintenance: "maintenance" } as Record<string, string>)[u.status] || "?"}${u.response_ms != null ? tx(" · {0} ms", u.response_ms) : ""}`).join(" ; ") || "—",
      (r.uptime || []).some((u) => u.status === "down") ? "bad" : r.uptime?.length ? undefined : "mut"],
    [tx("Interface web"), ({ ui: tx("interface web"), api: tx("API / sans page"), none: tx("pas de HTTP"), inconnu: "injoignable" } as Record<string, string>)[r.web || ""] || "—", r.web === "ui" ? "ok" : "mut"],
  ];
  const net: Row[] = [
    [tx("Backend TCP"), npmOnly ? "—" : b.internal ? tx("interne, testé via NPM") : b.up ? tx("joignable · {0} ms", b.ms) : tx("injoignable · {0}", b.err || "?"), npmOnly || b.internal ? "mut" : b.up ? "ok" : "bad"],
  ];
  if (r.type !== "local" && r.type !== "stream") net.push(
    [tx("HTTPS via NPM"), p.code ? tx("{0} · {1} ms{2}", p.code, p.ms, p.cert_ok === false ? tx(" · certificat ≠ nom") : "") : p.err || "—", !p.code ? (p.err ? "bad" : "mut") : p.code >= 500 ? "bad" : p.cert_ok === false || p.code >= 400 ? "warn" : "ok"],
    [tx("Access list"), r.acl ? r.acl : r.acl_adv ? tx("garde LAN (advanced_config)") : r.public_ok ? tx("site public (voulu)") : "aucune", r.acl || r.acl_adv ? "ok" : r.public_ok || npmOnly ? "mut" : "bad"],
    [tx("Certificat SSL"), yn(r.ssl), yes(r.ssl, true)],
    [tx("SSL forcé"), yn(r.ssl_forced), yes(r.ssl_forced, true)],
  );
  if (r.type === "proxy") net.push(
    [tx("Config nginx"), r.nginx_online === false ? tx("en erreur : {0}", r.nginx_err || "?") : r.nginx_online ? "OK" : "—", r.nginx_online === false ? "bad" : r.nginx_online ? "ok" : "mut"],
    ["HTTP/2", yn(r.http2), yes(r.http2, true)], ["HSTS", yn(r.hsts), yes(r.hsts, null)], ["Websocket", yn(r.websocket), yes(r.websocket, null)],
    [tx("Block exploits"), yn(r.block_exploits), yes(r.block_exploits, true)], [tx("Real IP Cloudflare"), yn(r.cloudflare), yes(r.cloudflare, null)],
    [tx("Créé"), r.created || "—", "mut"], [tx("Modifié"), r.modified || "—", "mut"],
  );
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Block title={tx("Identité")} rows={ident} />
      <Block title={tx("Service")} rows={svc} />
      <Block title={r.type === "local" ? tx("Réseau") : tx("Réseau & NPM")} rows={net} />
    </div>
  );
}
