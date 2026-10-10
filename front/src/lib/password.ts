// Règles du mot de passe : la seule exigence du serveur est la longueur (auth.py, PASSWORD_MIN) ; le reste
// ne sert que de conseil, affiché sans bloquer.
export const PASSWORD_MIN = 12;

export interface PasswordCheck {
  long: boolean;      // exigé : PASSWORD_MIN caractères
  same: boolean | null; // exigé s'il y a une confirmation, sinon null
  words: boolean;     // conseil : plusieurs mots (phrase de passe)
  ok: boolean;        // tout ce qui est exigé est vrai
}

export function checkPassword(pw: string, again?: string): PasswordCheck {
  const long = pw.length >= PASSWORD_MIN;
  const same = again === undefined ? null : pw.length > 0 && pw === again;
  const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length > 1).length >= 3;
  return { long, same, words, ok: long && (same ?? true) };
}

/** Classe de bordure d'un champ mot de passe : verte dès que la longueur est bonne */
export const okField = (pw: string) => (pw.length >= PASSWORD_MIN ? "!border-ok/70" : "");
