// Accès SSH d'une machine (relevé par la collecte) : ligne de résumé, alerte sshd, détail ; état d'un connecteur.
import { AlertTriangle, CheckCircle2, KeyRound, RefreshCw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { dur } from "../lib/format";
import { liveText, type TaskInfo } from "../lib/tasks";
import type { Connector, ConnectorStatus, Machine } from "../types";
import { Badge, Dim } from "./ui";
import { tx } from "../lib/i18n";
import { appIcon } from "../lib/appIcons";

const SSH_KIND: Record<string, string> = { docker: tx("conteneurs Docker"), process: tx("services hors Docker"), adguard: "AdGuard" };
const SSH_KIND_ICON: Record<string, string | null> = { docker: appIcon(["Docker"]), adguard: appIcon(["AdGuard Home"]), process: null };

export function StatusLine({ s, collect }: { s: (Partial<ConnectorStatus> & Connector) | null; collect?: { task: TaskInfo | null; now: number } }) {
  if (!s) {
    const t = collect?.task;   // when the collection runs next, or that it is running now
    if (!t?.enabled) return <Dim>{tx("pas encore lu (prochain passage de la collecte)")}</Dim>;
    return <span className="flex items-center gap-2 text-dim">{t.running && <RefreshCw size={14} className="shrink-0 animate-spin text-link" aria-hidden />}
      {t.running ? tx("pas encore lu : collecte en cours…") : tx("pas encore lu : prochaine collecte à {0}", liveText(t, collect!.now))}</span>;
  }
  // Saved (or switched on) after the last collection: its old error belongs to the old settings, the collection is reading it again
  if (s.pending) return <span className="flex items-center gap-2 text-link"><RefreshCw size={15} className="shrink-0 animate-spin" aria-hidden />{tx("enregistré : relecture en cours…")}</span>;
  const version = s.version && <Badge tone={s.version_tested === false ? "warn" : "off"} title={s.version_tested === false ? tx("version non testée") : undefined}>v{s.version}</Badge>;
  // Lu : la coche verte suffit (pas de texte « OK »). Périmé ou en échec : l'icône et le message
  const found = (s.found ?? []).map((f) => <Badge key={f.name} tone={f.count ? "ok" : "off"} title={tx("Lu à la dernière collecte")}>{f.name} : {f.count}</Badge>);
  // Docker read fine but not installed (VMware ESXi, a NAS…): nothing to read, said in grey, not a green tick
  if (s.ok && s.type === "docker" && s.message?.startsWith("pas de Docker")) return <Dim>{tx("pas de Docker sur cette machine (rien à lire)")}</Dim>;
  if (s.ok && !s.stale && s.warning) return <span className="flex flex-wrap items-center gap-2"><AlertTriangle size={16} className="shrink-0 text-warn" aria-label={tx("lecture partielle")} /><span className="text-warn">{s.warning}</span>{version}{found}</span>;
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
  return <div className="flex justify-between gap-3 whitespace-nowrap"><span className="shrink-0 text-dim">{k}</span><span className="min-w-0 truncate text-right">{children}</span></div>;
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

/** One line for the state of the connection: connected, partly read, or refused */
function ConnectionState({ refused, reading, failed }: Readonly<{ refused: boolean; reading: boolean; failed: number }>) {
  if (refused) return <Badge tone="bad" title={tx("La connexion SSH échoue : voir l'action requise en haut de la fenêtre")}>{tx("connexion refusée")}</Badge>;
  if (failed > 0) return <Badge tone="warn" title={tx("SSH répond, mais certaines lectures échouent (détail plus bas)")}>{tx("connecté, {0} lecture(s) en échec", failed)}</Badge>;
  return <Badge tone="ok" title={reading ? tx("SSH répond et toutes les lectures ont réussi") : tx("SSH répond")}>{reading ? tx("connecté, tout est lu") : tx("connecté")}</Badge>;
}

const risky = (v?: string) => !!v && !/^(no|prohibit-password)$/.test(v);

/** Long key fingerprint cut in the middle (full value in the tooltip) */
const shortFp = (fp: string) => (fp.length > 24 ? `${fp.slice(0, 14)}…${fp.slice(-8)}` : fp);

function Block({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line/50 bg-bg/40 p-2.5">
      <b className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{title}</b>
      {children}
    </div>
  );
}

/** What is read over SSH: containers, web servers (one line, or a grey « nothing more ») */
function readSummary(i: NonNullable<Machine["info"]>): ReactNode {
  let docker: string | null = null;
  if (i.docker) docker = tx("{0} conteneurs", i.docker);
  else if (i.docker_installed === false) docker = tx("pas de Docker");
  const parts = [docker, i.apache ? tx("Apache") : null, i.nginx ? tx("nginx") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : <Dim>{tx("rien de plus")}</Dim>;
}

/** Détail SSH : état de la connexion en tête, puis le bloc Accès (alias, clé, empreintes), le bloc Lecture (système, sshd, conteneurs) et l'état de chaque connecteur SSH. */
export function SshDetails({ m, statuses }: { m: Machine; statuses: (Connector | ConnectorStatus)[] }) {
  const s = m.ssh, i = m.info, d = i?.sshd;
  if (!s && !m.local) return <p className="text-dim">{tx("Pas d'accès SSH : ping et services web seulement.")}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ConnectionState refused={!i && !!s?.identity} reading={statuses.length > 0 && statuses.every((c) => c.ok)} failed={statuses.filter((c) => !c.ok).length} />
        {i?.os && <span className="text-sm">{i.os}{i.uptime_s ? <Dim> {tx("· en marche depuis")} {dur(i.uptime_s)}</Dim> : null}</span>}
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        <Block title={tx("Accès")}>
          {s ? <Kv k={tx("Compte")}><SshAccess alias={s.alias} user={s.user} ip={m.ip} port={s.port} refused={!i && !!s.identity} /></Kv> : <Kv k={tx("Compte")}>{tx("collecteur lui-même (local)")}</Kv>}
          {s && <Kv k={tx("Clé")}><span className="inline-flex items-center gap-1 font-mono text-xs"><KeyRound size={12} />{s.identity || tx("aucune (mot de passe)")}</span></Kv>}
          {s?.key_fp && <Kv k={tx("Empreinte clé")}><span className="font-mono text-xs" title={s.key_fp}>{shortFp(s.key_fp)}</span></Kv>}
          {s?.host_key && <Kv k={tx("Clé d'hôte")}><span className="font-mono text-xs" title={s.host_key}>{shortFp(s.host_key)}</span></Kv>}
          {s?.note && <Kv k={tx("Note")}>{s.note}</Kv>}
        </Block>
        <Block title={tx("Lecture")}>
          {i ? <Kv k={tx("Lu par SSH")}>{readSummary(i)}</Kv> : <Dim>{tx("rien lu pour l'instant")}</Dim>}
          {d && (
            <Kv k="sshd">
              <span className={risky(d.permitrootlogin) ? "text-warn" : ""}>{tx("root")} {d.permitrootlogin || "?"}</span>
              {" · "}
              <span className={d.passwordauthentication?.startsWith("yes") ? "text-warn" : ""}>{tx("mot de passe")} {d.passwordauthentication || "?"}</span>
            </Kv>
          )}
        </Block>
      </div>
      {statuses.length > 0 && (
        <Block title={tx("Connecteurs SSH")}>
          <ul className="flex flex-col gap-1">
            {statuses.map((st) => (
              <li key={`${st.type}/${st.name}`} className="flex flex-wrap items-center gap-2">
                {SSH_KIND_ICON[st.type] ? <img src={SSH_KIND_ICON[st.type]!} alt="" aria-hidden className="h-4 w-4 shrink-0" /> : null}
                <span className="font-semibold text-txt">{SSH_KIND[st.type] || st.type}</span><StatusLine s={st} />
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
