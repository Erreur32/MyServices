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

/** Commande « autoriser la clé » pour un compte, à lancer en root ou connecté avec ce compte : le vrai dossier (/root ou /home/<compte>),
 *  .ssh créé s'il manque, clé ajoutée une seule fois, puis propriétaire et droits remis (sinon sshd refuse une clé posée par root).
 *  `cmd` : la commande du serveur (« echo '<clé>' >> ~/.ssh/authorized_keys »), d'où la clé est reprise. */
export function authorizeFor(cmd: string, user: string): string {
  const key = /'([^']+)'/.exec(cmd)?.[1];
  if (!key) return cmd;
  const u = user.trim() || "root", dir = `${homeOf(u)}/.ssh`, file = `${dir}/authorized_keys`;
  return [`mkdir -p ${dir}`, `touch ${file}`, `(grep -qxF '${key}' ${file} || echo '${key}' >> ${file})`,
    ...(u === "root" ? [] : [`chown -R ${u}: ${dir}`]), `chmod 700 ${dir}`, `chmod 600 ${file}`].join(" && ");
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

