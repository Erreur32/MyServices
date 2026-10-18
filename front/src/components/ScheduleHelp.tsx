// Help window of Settings -> Tasks and schedules: how to write a schedule, and what we recommend for each task (freshness against network and log load).
import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { tx } from "../lib/i18n";
import { Overlay } from "./Overlay";

interface Advice { task: string; at: string; why: string; load: string }

/** One line per task: the default schedule, why, and what it costs the network. Texts are French, translated in en.ts. */
const ADVICE = (): Advice[] => [
  { task: tx("Collecte"), at: "0,15,30,45 *", why: tx("Lecture complète (SSH, Docker, connecteurs). Le pouls couvre déjà les pannes : descendre sous 10 min ajoute surtout des lignes dans auth.log."), load: tx("1 commande SSH par machine") },
  { task: tx("Veille"), at: "5,20,35,50 *", why: tx("Elle se lance seule après chaque collecte ; l'horaire n'est qu'un filet de sécurité, quelques minutes après."), load: tx("aucune (lit data.json)") },
  { task: tx("Santé"), at: "0 0,2,4,6,8,10,12,14,16,18,20,22", why: tx("Disque, mises à jour, SMART : lourd et lent à changer. Elle est relancée seule, pour une machine, quand son ping change."), load: tx("1 passage SSH par machine") },
  { task: tx("Sauvegardes"), at: "5 1,7,13,19", why: tx("Âge du dernier fichier de chaque sauvegarde : 4 fois par jour repèrent une sauvegarde manquée dans les 6 h. Alignez-les sur vos propres horaires."), load: tx("lecture des dossiers") },
  { task: tx("Vérifications en direct"), at: tx("toutes les 30 s"), why: tx("Un ping par machine, confirmé par deux réponses : une panne est annoncée en 1 à 2 minutes. Ne descendez pas sous 15 s."), load: tx("1 ping par machine") },
  { task: tx("Lectures rapides"), at: tx("toutes les 5 min"), why: tx("MynetworK, Proxmox et Beszel par leur API, sans toucher aux machines."), load: tx("3 requêtes HTTP") },
  { task: tx("Recherche réseau"), at: tx("toutes les 6 h"), why: tx("Ping de tout le réseau puis ports : le plus bruyant. Mode discret si un détecteur d'intrusion surveille."), load: tx("254 ping + ports") },
];

export function ScheduleHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="text-dim hover:text-link" onClick={() => setOpen(true)} title={tx("Recommandations d'horaires")} aria-label={tx("Aide sur les horaires")}><CircleHelp size={15} aria-hidden /></button>
      {open && (
        <Overlay title={<><CircleHelp size={18} aria-hidden />{tx("Horaires conseillés")}</>} onClose={() => setOpen(false)} wide>
          <div className="mt-3 flex flex-col gap-4 text-sm">
            <p className="text-muted">{tx("Plus une donnée est fraîche, plus il y a de connexions SSH et de lignes dans les journaux des machines. Un ping coûte presque rien, une lecture complète beaucoup plus : le pouls et les lectures rapides donnent le « direct », la collecte reste raisonnable.")}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-dim">
                    <th className="py-2 pr-3">{tx("Tâche")}</th><th className="px-3">{tx("Conseillé")}</th><th className="px-3">{tx("Pourquoi")}</th><th className="pl-3">{tx("Charge")}</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-line/60">
                  {ADVICE().map((a) => (
                    <tr key={a.task} className="align-top">
                      <th scope="row" className="py-2 pr-3 font-semibold">{a.task}</th>
                      <td className="px-3 py-2"><code className="font-mono text-xs">{a.at}</code></td>
                      <td className="px-3 py-2 text-muted">{a.why}</td>
                      <td className="py-2 pl-3 text-dim">{a.load}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section>
              <h3 className="mb-1 font-bold">{tx("Écrire un horaire")}</h3>
              <p className="text-muted">{tx("Format")} <code className="font-mono text-xs">{tx("minutes heures")}</code> : <code className="font-mono text-xs">0,15,30,45 *</code> {tx("toutes les 15 minutes")}, <code className="font-mono text-xs">5 7,19</code> {tx("à 7 h 05 et 19 h 05")}. {tx("Appliqué tout de suite, gardé dans")} <code className="font-mono text-xs">config.json</code>.</p>
            </section>
          </div>
        </Overlay>
      )}
    </>
  );
}
