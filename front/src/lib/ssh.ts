// Accès SSH d'une machine : alerte sshd, ligne de résumé (hors composants, voir lib/forms.ts).
import type { Machine } from "../types";

export const risky = (v?: string) => !!v && !/^(no|prohibit-password)$/.test(v);

/** sshd autorise root ou le mot de passe */
export function sshWarn(m: Machine): boolean {
  const d = m.info?.sshd;
  return !!d && (risky(d.permitrootlogin) || !!d.passwordauthentication?.startsWith("yes"));
}

/** Rôle d'une machine (texte « a, b, c ») en étiquettes */
export const rolesOf = (role?: string | null): string[] => (role ?? "").split(",").map((t) => t.trim()).filter(Boolean);

/** Dossier personnel d'un compte Linux : /root pour root, sinon /home/<compte> */
export const homeOf = (user: string) => (user === "root" ? "/root" : `/home/${user}`);

/** Commande « autoriser la clé » (donnée par le serveur avec ~/.ssh/authorized_keys) avec le chemin complet du compte choisi */
export const authorizeFor = (cmd: string, user: string) => cmd.replace("~/.ssh/authorized_keys", `${homeOf(user || "root")}/.ssh/authorized_keys`);

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

