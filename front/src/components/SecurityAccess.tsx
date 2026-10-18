// Security -> "Access to MyServices" (admins only): the accounts, the API tokens and the agents that can get into MyServices, with when each was last used.
// The findings (unused accounts, old tokens, silent agents) are worked out in lib/accessFindings.ts and also lead the overview.
import { Bot, KeyRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { read } from "../api";
import { type AccessData, daysSince } from "../lib/accessFindings";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import type { AgentInfo, ApiToken, TokensState, User } from "../types";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { Badge, Dim } from "./ui";

/** Reads the three lists once the admin opens the Security page (each route is admin only; a failure leaves its list empty) */
export function useAccessData(admin: boolean): AccessData | null {
  const [data, setData] = useState<AccessData | null>(null);
  useEffect(() => {
    if (!admin) return;
    void Promise.all([
      read<{ users: User[] }>("users").then((r) => r.users).catch(() => [] as User[]),
      read<TokensState>("tokens").then((r) => r.tokens).catch(() => [] as ApiToken[]),
      read<{ agents: AgentInfo[] }>("agents").then((r) => r.agents).catch(() => [] as AgentInfo[]),
    ]).then(([users, tokens, agents]) => setData({ users, tokens, agents }));
  }, [admin]);
  return data;
}

const ROW = "grid items-center gap-x-4 gap-y-1 px-2 py-2 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]";
const HEAD = `${ROW} mb-1 hidden border-b border-line text-xs font-semibold uppercase tracking-wide text-dim md:grid`;
const LIST = "flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50";

/** « il y a 12 j », or a dash when it never happened */
function since(ts: number | null | undefined, now: number): React.ReactNode {
  if (ts == null) return <Dim>{tx("jamais")}</Dim>;
  const d = daysSince(ts, now);
  return <span title={dateTime(ts * 1000)}>{d < 1 ? tx("aujourd'hui") : tx("il y a {0} j", d)}</span>;
}

export function SecurityAccess({ data, now }: Readonly<{ data: AccessData | null; now: number }>) {
  if (!data) return <p className="py-6 text-sm text-muted">{tx("Chargement…")}</p>;
  const tokens = data.tokens.filter((t) => !t.revoked), agents = data.agents.filter((a) => a.state !== "révoqué");
  return (
    <div className="flex flex-col gap-4">
      <InfoNote>{tx("Qui peut entrer dans MyServices lui-même : comptes, jetons d'API et de MCP, agents. Ce qui n'est plus utilisé est signalé dans « À traiter d'abord ».")}</InfoNote>
      <FoldPanel id="security.members.users" icon={Users} title={tx("Comptes")} count={data.users.length}>
        <div className={HEAD} aria-hidden><span>{tx("Compte")}</span><span>{tx("Rôle")}</span><span>{tx("Dernière connexion")}</span><span>{tx("État")}</span></div>
        <ul className={LIST}>{data.users.map((u) => (
          <li key={u.username} className={ROW}>
            <b className="truncate">{u.username}</b>
            <span><Badge outline tone={u.role === "admin" ? "warn" : "off"}>{u.role}</Badge></span>
            <span className="text-muted">{since(u.last_login, now)}</span>
            <span><Badge outline tone={u.disabled ? "off" : "ok"}>{u.disabled ? tx("désactivé") : tx("actif")}</Badge></span>
          </li>))}</ul>
      </FoldPanel>
      <FoldPanel id="security.members.tokens" icon={KeyRound} title={tx("Jetons d'API et de MCP")} count={tokens.length}>
        {tokens.length === 0 ? <Dim>{tx("Aucun jeton actif.")}</Dim> : <>
          <div className={HEAD} aria-hidden><span>{tx("Jeton")}</span><span>{tx("Niveau")}</span><span>{tx("Dernier usage")}</span><span>{tx("Expire")}</span></div>
          <ul className={LIST}>{tokens.map((t) => (
            <li key={t.id} className={ROW}>
              <b className="truncate">{t.name} <Dim>{t.kind === "mcp" ? "MCP" : "API"}</Dim></b>
              <span><Badge outline tone={t.level === "admin" ? "warn" : "off"}>{t.level}</Badge></span>
              <span className="text-muted">{since(t.last_used, now)}</span>
              <span className="text-muted">{t.expires == null ? <Dim>{tx("jamais")}</Dim> : dateTime(t.expires * 1000)}</span>
            </li>))}</ul></>}
      </FoldPanel>
      <FoldPanel id="security.members.agents" icon={Bot} title={tx("Agents")} count={agents.length}>
        {agents.length === 0 ? <Dim>{tx("Aucun agent.")}</Dim> : <>
          <div className={HEAD} aria-hidden><span>{tx("Agent")}</span><span>{tx("État")}</span><span>{tx("Dernier relevé")}</span><span>{tx("Version")}</span></div>
          <ul className={LIST}>{agents.map((a) => (
            <li key={a.id} className={ROW}>
              <b className="truncate">{a.name} <Dim>{a.ip}</Dim></b>
              <span><Badge outline tone={a.state === "actif" ? "ok" : "warn"}>{a.state}</Badge>{a.host_pending && <Badge outline tone="bad">{tx("nom de poste à confirmer")}</Badge>}</span>
              <span className="text-muted">{since(a.last_seen, now)}</span>
              <span className="text-muted">{a.version ?? "-"}{a.outdated && <> <Badge outline tone="warn">{tx("ancien")}</Badge></>}</span>
            </li>))}</ul></>}
      </FoldPanel>
    </div>
  );
}
