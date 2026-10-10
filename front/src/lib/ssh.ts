// Accès SSH d'une machine : alerte sshd, ligne de résumé (hors composants, voir lib/forms.ts).
import type { Machine } from "../types";

export const risky = (v?: string) => !!v && !/^(no|prohibit-password)$/.test(v);

/** sshd autorise root ou le mot de passe */
export function sshWarn(m: Machine): boolean {
  const d = m.info?.sshd;
  return !!d && (risky(d.permitrootlogin) || !!d.passwordauthentication?.startsWith("yes"));
}

/** Une ligne : compte@alias:port · système · conteneurs · Apache */
export function sshBrief(m: Machine): string {
  const s = m.ssh, i = m.info;
  return [
    s ? `${s.user || "?"}@${s.alias}:${s.port}` : m.local ? "local" : null,
    i?.os?.replace(/ GNU\/Linux/, "").replace(/ \(.*\)/, ""),
    i?.docker ? `${i.docker} conteneurs` : null,
    i?.apache ? "Apache" : null,
  ].filter(Boolean).join(" · ");
}

