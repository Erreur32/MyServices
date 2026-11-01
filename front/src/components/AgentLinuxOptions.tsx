// What a Linux agent may read beyond the basics, chosen before copying its command: each box adds an option of agent/install.sh to the command.
import type { ReactNode } from "react";
import { backupDirs, npmProblem, type AgentOptions } from "../lib/agentCommand";
import { input } from "../lib/forms";
import { tx } from "../lib/i18n";

function Box({ on, onChange, children }: Readonly<{ on: boolean; onChange: (on: boolean) => void; children: ReactNode }>) {
  return (
    <label className="mb-2 flex items-start gap-2 text-sm text-muted">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function AgentLinuxOptions({ value, onChange }: Readonly<{ value: AgentOptions; onChange: (v: AgentOptions) => void }>) {
  const set = (more: Partial<AgentOptions>) => onChange({ ...value, ...more });
  const dirs = value.backupDirs ?? "", wrongDirs = dirs.trim() !== "" && backupDirs(dirs).length !== dirs.split(/[\s,]+/).filter(Boolean).length;
  return (
    <div className="mb-2">
      <Box on={!!value.sudo} onChange={(sudo) => set({ sudo })}>{tx("Autoriser des lectures avec sudo : le programme derrière chaque port, les services à relancer, les adresses bloquées par fail2ban, les machines virtuelles (KVM, Incus, LXD). Chacune est une règle exacte, en lecture seule.")}</Box>
      <Box on={!!value.backups} onChange={(backups) => set({ backups })}>{tx("Lire les dossiers de sauvegarde : noms, tailles et dates, jamais le contenu. Seuls /home/backup, /var/backups, /backup, /backups et les dossiers ajoutés ici sont acceptés.")}</Box>
      {value.backups && <div className="mb-2 ml-6">
        <input className={input} aria-label={tx("Autres dossiers de sauvegarde")} placeholder={tx("Autres dossiers, séparés par des virgules (facultatif)")} value={dirs} onChange={(e) => set({ backupDirs: e.target.value })} />
        {wrongDirs && <p className="mt-1 text-sm text-warn">{tx("Chemins complets seulement, sans espace ni caractère spécial : les autres sont ignorés.")}</p>}
      </div>}
      <Box on={value.npm !== undefined} onChange={(on) => set({ npm: on ? "" : undefined })}>{tx("Lire Nginx Proxy Manager sur cette machine, sans SSH ni compte NPM dans MyServices.")}</Box>
      {value.npm !== undefined && <div className="mb-2 ml-6 flex flex-col gap-1">
        <input className={input} aria-label={tx("Chemin de npm-api.sh")} placeholder={tx("Chemin de npm-api.sh, vide pour l'installer")} value={value.npm} onChange={(e) => set({ npm: e.target.value })} />
        {value.npm.trim() === "" && <>
          <input className={input} aria-label={tx("Adresse de l'admin de NPM vue de la machine")} placeholder="http://127.0.0.1:81" value={value.npmUrl ?? ""} onChange={(e) => set({ npmUrl: e.target.value })} />
          <p className="text-sm text-muted">{tx("Le script sera installé pour l'agent (jq requis). Le terminal demandera le compte et le mot de passe NPM : ils restent sur la machine.")}</p>
        </>}
        {npmProblem(value) && <p className="text-sm text-warn">{tx("Chemin complet ou adresse http://hôte:port attendus : NPM reste hors de la commande tant que ce n'est pas corrigé.")}</p>}
      </div>}
    </div>
  );
}
