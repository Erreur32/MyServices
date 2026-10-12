// Réglages → Journaux : tri des lignes du conteneur.

/** Origine d'une ligne : « [collect] … » = sortie d'une tâche, le reste = le serveur */
export const sourceOf = (text: string) => /^\s*\[(\w+)\]/.exec(text)?.[1] ?? "server";

/** Ligne à regarder : écrite sur la sortie d'erreur, ou qui dit une erreur / un avertissement */
export const isProblem = (l: { err: boolean; text: string }) => l.err || /⚠|traceback|error|erreur|exception|impossible|refusé|échec/i.test(l.text);
