// Accès SSH d'une machine (relevé par la collecte) : ligne de résumé, alerte sshd, détail ; état d'un connecteur.
import { AlertTriangle, CheckCircle2, KeyRound, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { dur } from "../lib/format";
import type { Connector, ConnectorStatus, Machine } from "../types";
import { Badge, Dim } from "./ui";
import { tx } from "../lib/i18n";

const SSH_KIND: Record<string, string> = { docker: tx("conteneurs Docker"), process: tx("services hors Docker"), adguard: "AdGuard" };

export function StatusLine({ s }: { s: (Partial<ConnectorStatus> & Connector) | null }) {
  if (!s) return <Dim>{tx("pas encore lu (prochain passage de la collecte)")}</Dim>;
  const version = s.version && <Badge tone={s.version_tested === false ? "warn" : "off"} title={s.version_tested === false ? tx("version non testée") : undefined}>v{s.version}</Badge>;
  // Lu : la coche verte suffit (pas de texte « OK »). Périmé ou en échec : l'icône et le message
  const found = (s.found ?? []).map((f) => <Badge key={f.name} tone={f.count ? "ok" : "off"} title={tx("Lu à la dernière collecte")}>{f.name} : {f.count}</Badge>);
  // Docker read fine but not installed (VMware ESXi, a NAS…): nothing to read, said in grey, not a green tick
  if (s.ok && s.type === "docker" && s.message?.startsWith("pas de Docker")) return <Dim>{tx("pas de Docker sur cette machine (rien à lire)")}</Dim>;
  if (s.ok && !s.stale) return <span className="flex flex-wrap items-center gap-2"><CheckCircle2 size={16} className="shrink-0 text-ok" aria-label={tx("lu")} />{version}{found}</span>;
  const bad = !s.ok;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {bad ? <XCircle size={16} className="shrink-0 text-bad" aria-label={tx("en échec{0}", "")} /> : <AlertTriangle size={16} className="shrink-0 text-warn" aria-label={tx("périmé")} />}
      <span className={bad ? "text-bad" : "text-warn"}>{bad ? s.message : `${tx("périmé")} : ${s.message}`}{bad && (s.failures || 0) > 1 ? tx(" ({0} passages)", s.failures) : ""}</span>
      {version}{found}
    </span>
  );
}

function Kv({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-dim">{k}</span><span className="min-w-0 truncate text-right">{children}</span></div>;
}

/** IP pill (blue) and port pill (yellow, filled when `odd`) */
const IpPill = ({ ip }: { ip: string }) =>
  <span title={tx("Adresse IP")} className="inline-flex items-center rounded-full border border-link/35 bg-link/10 px-1.5 font-mono text-[10.5px] font-bold text-link">{ip}</span>;
const PortPill = ({ port, odd, title }: { port: number | string; odd?: boolean; title?: string }) =>
  <span title={title} className={`inline-flex items-center rounded-full border px-1.5 font-mono text-[10.5px] font-bold ${odd ? "border-warn bg-warn text-bg" : "border-warn/35 bg-warn/10 text-warn"}`}>:{port}</span>;

const SSH_ICON = `${import.meta.env.BASE_URL}icons/ssh.svg`;

/** SSH access as in the first version of the page, on one line: SSH logo and alias, then the account, IP and port pills
 *  (port filled when it is not 22). noIp: without the IP pill, where the IP is already shown (machine card header);
 *  noAlias: logo only, the alias being in the unfolded detail (Machines table column). */
export function SshAccess({ alias, user, ip, port, refused, noIp, noAlias }: {
  alias: string; user?: string | null; ip?: string | null; port?: number | null; refused?: boolean; noIp?: boolean; noAlias?: boolean;
}) {
  const p = port || 22;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      <span className="inline-flex items-center gap-1 font-mono text-xs text-txt"><img src={SSH_ICON} alt="" aria-hidden={!noAlias} title={noAlias ? alias : undefined} className="h-3.5 w-3.5" />{!noAlias && alias}</span>
      <span title={tx("Compte SSH")} className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-400/10 px-1.5 text-[10.5px] font-bold text-violet-400">👤 {user || "?"}</span>
      {!noIp && ip && <IpPill ip={ip} />}
      <PortPill port={p} odd={p !== 22} title={p !== 22 ? tx("Port SSH (non standard)") : tx("Port SSH")} />
      {refused && <Badge tone="warn" title={tx("connexion refusée ou impossible")}>{tx("refusée")}</Badge>}
    </span>
  );
}

const risky = (v?: string) => !!v && !/^(no|prohibit-password)$/.test(v);

/** Détail SSH : accès, clé, empreintes, sshd, système, ce qui est lu, état des connecteurs SSH de la machine. */
export function SshDetails({ m, statuses }: { m: Machine; statuses: (Connector | ConnectorStatus)[] }) {
  const s = m.ssh, i = m.info, d = i?.sshd;
  if (!s && !m.local) return <p className="text-dim">{tx("Pas d'accès SSH : ping et services web seulement.")}</p>;
  return (
    <div>
      <div className="flex flex-col gap-0.5">
        {s ? <Kv k={tx("Accès")}><SshAccess alias={s.alias} user={s.user} ip={m.ip} port={s.port} refused={!i && !!s.identity} /></Kv> : <Kv k={tx("Accès")}>{tx("collecteur lui-même (local)")}</Kv>}
        {s && <Kv k={tx("Clé")}><span className="inline-flex items-center gap-1 font-mono text-xs"><KeyRound size={12} />{s.identity || tx("aucune (mot de passe)")}</span></Kv>}
        {s?.key_fp && <Kv k={tx("Empreinte clé")}><span className="font-mono text-xs" title={s.key_fp}>{s.key_fp}</span></Kv>}
        {s?.host_key && <Kv k={tx("Clé d'hôte")}><span className="font-mono text-xs" title={s.host_key}>{s.host_key}</span></Kv>}
        {d && (
          <Kv k="sshd">
            <span className={risky(d.permitrootlogin) ? "text-warn" : ""}>{tx("root")} {d.permitrootlogin || "?"}</span>
            {" · "}
            <span className={d.passwordauthentication?.startsWith("yes") ? "text-warn" : ""}>{tx("mot de passe")} {d.passwordauthentication || "?"}</span>
          </Kv>
        )}
        {i?.os && <Kv k={tx("Système")}>{i.os}{i.uptime_s ? <Dim> {tx("· en marche depuis")} {dur(i.uptime_s)}</Dim> : null}</Kv>}
        {i && (
          <Kv k={tx("Lu par SSH")}>
            {[i.docker ? `${i.docker} conteneurs` : i.docker_installed === false ? tx("pas de Docker") : null, i.apache ? tx("Apache") : null, i.nginx ? tx("nginx") : null].filter(Boolean).join(" · ") || <Dim>{tx("rien de plus")}</Dim>}
          </Kv>
        )}
        {s?.note && <Kv k={tx("Note")}>{s.note}</Kv>}
      </div>
      {statuses.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-line/60 pt-2">
          {statuses.map((st) => (
            <li key={`${st.type}/${st.name}`} className="flex flex-wrap items-center gap-2">
              <span className="text-muted">{SSH_KIND[st.type] || st.type}</span><StatusLine s={st} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
