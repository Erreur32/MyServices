// What the Security page says about who can get into MyServices itself: accounts that are not used, API tokens that are old, expired or never used,
// and agents that went silent or whose host name changed. Worked out from the lists the admin routes already give (users, tokens, agents).
import type { AgentInfo, ApiToken, User } from "../types";
import { tx } from "./i18n";
import type { Finding } from "./securityFindings";

export interface AccessData { users: User[]; tokens: ApiToken[]; agents: AgentInfo[] }

const DAY = 86400;
export const STALE_DAYS = 90;      // an account or a token not used for this long
export const NEVER_USED_DAYS = 30; // an account or a token still never used this long after it was made

/** « 12 j » : whole days between a time (epoch seconds) and now */
export const daysSince = (ts: number, now: number): number => Math.max(0, Math.floor((now - ts) / DAY));

const fix = (text: string): string => text;

function userFindings(users: User[], now: number): Finding[] {
  const out: Finding[] = [];
  for (const u of users.filter((x) => !x.disabled)) {
    const never = u.last_login == null, age = daysSince(never ? u.created : (u.last_login as number), now);
    if (never && age >= NEVER_USED_DAYS) out.push({ sev: "warn", area: "access", title: u.username, detail: tx("compte {0} jamais utilisé depuis sa création, il y a {1} j", u.role, age), fix: fix(tx("Supprimer ou désactiver ce compte s'il ne sert pas (Réglages, Comptes).")) });
    else if (!never && age >= STALE_DAYS) out.push({ sev: "warn", area: "access", title: u.username, detail: tx("compte {0} sans connexion depuis {1} j", u.role, age), fix: fix(tx("Désactiver ce compte s'il ne sert plus (Réglages, Comptes).")) });
  }
  return out;
}

function tokenFindings(tokens: ApiToken[], now: number): Finding[] {
  const out: Finding[] = [];
  for (const t of tokens.filter((x) => !x.revoked)) {
    const label = `${t.name} (${t.kind === "mcp" ? "MCP" : "API"}, ${t.level})`;
    if (t.expires != null && t.expires < now) out.push({ sev: "warn", area: "access", title: label, detail: tx("jeton expiré depuis {0} j mais pas révoqué", daysSince(t.expires, now)), fix: tx("Le révoquer (Réglages, API et MCP).") });
    else if (t.last_used == null && daysSince(t.created, now) >= NEVER_USED_DAYS) out.push({ sev: "warn", area: "access", title: label, detail: tx("jeton jamais utilisé depuis sa création, il y a {0} j", daysSince(t.created, now)), fix: tx("Le révoquer s'il ne sert pas (Réglages, API et MCP).") });
    else if (t.last_used != null && daysSince(t.last_used, now) >= STALE_DAYS) out.push({ sev: "warn", area: "access", title: label, detail: tx("jeton inutilisé depuis {0} j", daysSince(t.last_used, now)), fix: tx("Le révoquer s'il ne sert plus (Réglages, API et MCP).") });
  }
  return out;
}

function agentFindings(agents: AgentInfo[], now: number): Finding[] {
  const out: Finding[] = [];
  for (const a of agents.filter((x) => x.state !== "révoqué")) {
    if (a.host_pending) out.push({ sev: "warn", area: "access", title: a.name, detail: tx("un autre nom de poste ({0}) a envoyé des relevés : refusés tant que vous ne confirmez pas", a.host_pending), fix: tx("Vérifier que c'est bien la même machine, puis confirmer ou révoquer l'agent (Réglages, Agents).") });
    else if (a.state === "silencieux") out.push({ sev: "warn", area: "access", title: a.name, detail: a.last_seen ? tx("agent silencieux depuis {0} j", daysSince(a.last_seen, now)) : tx("agent silencieux"), fix: tx("La machine est peut-être éteinte ; sinon vérifier l'agent ou le révoquer.") });
    else if (a.state === "en attente" && daysSince(a.created, now) >= 7) out.push({ sev: "warn", area: "access", title: a.name, detail: tx("agent créé il y a {0} j, jamais installé", daysSince(a.created, now)), fix: tx("L'installer sur la machine, ou le révoquer.") });
  }
  return out;
}

export function accessFindings(a: AccessData, now: number): Finding[] {
  return [...userFindings(a.users, now), ...tokenFindings(a.tokens, now), ...agentFindings(a.agents, now)];
}
