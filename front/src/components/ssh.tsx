// Accès SSH d'une machine (relevé par la collecte) : ligne de résumé, alerte sshd, détail ; état d'un connecteur.
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { dur } from "../lib/format";
import type { Connector, ConnectorStatus, Machine } from "../types";
import { Badge, Dim } from "./ui";
import { tx } from "../lib/i18n";

const SSH_KIND: Record<string, string> = { docker: tx("conteneurs Docker"), process: tx("services hors Docker"), adguard: "AdGuard" };

export function StatusLine({ s }: { s: (Partial<ConnectorStatus> & Connector) | null }) {
  if (!s) return <Dim>{tx("pas encore lu (prochain passage de la collecte)")}</Dim>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={!s.ok ? "bad" : s.stale ? "warn" : "ok"}>{!s.ok ? tx("en échec{0}", (s.failures || 0) > 1 ? tx(" ({0} passages)", s.failures) : "") : s.stale ? tx("périmé") : tx("lu")}</Badge>
      <span className="text-muted">{s.message}</span>
      {s.version && <Badge tone={s.version_tested === false ? "warn" : "off"} title={s.version_tested === false ? tx("version non testée") : undefined}>v{s.version}</Badge>}
    </span>
  );
}

function Kv({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-dim">{k}</span><span className="min-w-0 truncate text-right">{children}</span></div>;
}

const risky = (v?: string) => !!v && !/^(no|prohibit-password)$/.test(v);

/** Détail SSH : accès, clé, empreintes, sshd, système, ce qui est lu, état des connecteurs SSH de la machine. */
export function SshDetails({ m, statuses }: { m: Machine; statuses: (Connector | ConnectorStatus)[] }) {
  const s = m.ssh, i = m.info, d = i?.sshd;
  if (!s && !m.local) return <p className="text-dim">{tx("Pas d'accès SSH : ping et services web seulement.")}</p>;
  return (
    <div>
      <div className="flex flex-col gap-0.5">
        {s ? <Kv k={tx("Accès")}><code className="font-mono text-xs">{s.user || "?"}@{s.alias}:{s.port}</code></Kv> : <Kv k={tx("Accès")}>{tx("collecteur lui-même (local)")}</Kv>}
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
