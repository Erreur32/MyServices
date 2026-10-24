// Réglages → Aide : par où commencer, comment MyServices lit le réseau, bons réflexes, dépannage. Du texte et des liens directs vers les réglages.
import { BookOpen, ChevronRight, LifeBuoy, ListChecks, ShieldCheck, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, Dim } from "../components/ui";
import { tx } from "../lib/i18n";
import { InfoNote } from "../components/InfoNote";

const link = "font-semibold text-link hover:underline";

/** Les étapes de la mise en route, dans l'ordre : titre, ce qu'on y fait, lien direct */
const STEPS: { title: string; text: string; href: string; go: string }[] = [
  { title: tx("Déclarer les machines"), text: tx("Ajoutez vos serveurs et PC (ou laissez la recherche réseau les trouver et choisissez celles à suivre). MyServices ne suit jamais une machine sans votre accord."), href: "#settings/machines", go: tx("Réglages → Machines") },
  { title: tx("Donner un accès en lecture"), text: tx("Linux : SSH, avec la clé de l'app à autoriser sur la machine. PC Windows : un petit agent PowerShell à installer. Les deux ne font que lire."), href: "#settings/ssh", go: tx("Réglages → Clé SSH") },
  { title: tx("Relier vos outils"), text: tx("Nginx Proxy Manager, AdGuard Home, Home Assistant, Beszel, Proxmox, Veeam… Le tableau « Services détectés » montre ce que MyServices a reconnu : le bouton « Activer » ouvre le connecteur déjà rempli. Donnez-lui toujours une clé ou un compte en lecture seule."), href: "#settings/connectors", go: tx("Réglages → Connecteurs") },
  { title: tx("Laisser la découverte travailler"), text: tx("Services, conteneurs, ports, nouvelles machines et sauvegardes sont cherchés tout seuls. Ce qui demande une décision est signalé en orange, avec un compteur."), href: "#settings/discovery", go: tx("Application › Découverte automatique") },
  { title: tx("Suivre les sauvegardes"), text: tx("Dossiers trouvés par SSH, jobs Veeam, groupes Proxmox Backup, sauvegarde Home Assistant : cochez ce qui compte et fixez l'âge au-delà duquel une alerte part."), href: "#settings/backups", go: tx("Réglages → Sauvegardes") },
  { title: tx("Être prévenu"), text: tx("Discord, Telegram ou un webhook : choisissez les événements qui méritent un message (machine éteinte, sauvegarde en retard, nouveau service…)."), href: "#settings/alerts", go: tx("Réglages → Notifications") },
];

const READ_WAYS: { title: string; text: string }[] = [
  { title: "SSH", text: tx("Pour les machines Linux : MyServices s'y connecte avec sa propre clé et lit la santé, Docker et les services en écoute.") },
  { title: tx("Agent"), text: tx("Pour un PC Windows : un script PowerShell envoie lui-même sa santé. Rien à ouvrir côté PC, et un PC souvent éteint se signale dès qu'il se rallume.") },
  { title: tx("Connecteur"), text: tx("Pour un outil qui a une API : MyServices lit ses données avec une clé ou un compte en lecture seule (certificats, DNS, sauvegardes, machines virtuelles…).") },
  { title: tx("Recherche réseau"), text: tx("Un balayage discret du réseau local trouve les machines et leurs applis. Elle se lance une fois à la main, puis se répète toute seule.") },
];

const HABITS = [
  tx("Un compte ou un jeton dédié et en lecture seule pour chaque outil : MyServices ne modifie rien et n'en a pas besoin."),
  tx("Ne l'exposez pas sur Internet : gardez-le sur votre réseau local ou derrière un VPN ou un proxy avec authentification."),
  tx("Stade précoce : gardez une copie des dossiers config/ et data/ avant chaque mise à jour."),
  tx("Un rappel qui revient trop ? « Ne plus me le rappeler » le coupe, et vous pouvez le réafficher dans Application › Découverte automatique (une appli : Connecteurs › Détectés à relier)."),
  tx("Pour ne plus lire un connecteur sans le supprimer, coupez son interrupteur « Collecte » : ses réglages sont gardés."),
  tx("L'onglet Historique garde les événements un an : choisissez la période et le style de graphique, votre choix est mémorisé."),
];

const FIXES: { problem: string; fix: ReactNode }[] = [
  { problem: tx("Un connecteur est en rouge ou « périmé »"), fix: tx("Cliquez sur « Tester » sur sa carte : le message dit si c'est l'adresse, la clé ou le certificat. « Modifier » corrige les réglages.") },
  { problem: tx("Une machine n'est pas lue"), fix: tx("Pour SSH, autorisez la clé de l'app sur la machine (Réglages → Clé SSH) et vérifiez le compte et le port. Pour un agent, vérifiez qu'il a envoyé un premier relevé.") },
  { problem: tx("Les chiffres ne bougent pas"), fix: tx("La collecte passe à heures fixes : Réglages → Tâches et horaires, bouton « Relancer », ou le bouton d'actualisation de la page.") },
  { problem: tx("Un service apparaît ou disparaît"), fix: tx("C'est normal : les nouveautés et les disparitions sont notées dans l'onglet Historique (« Nouveau », « Disparu »).") },
  { problem: tx("Qui a changé quoi ?"), fix: tx("Réglages → Requêtes et journaux → Journal d'audit liste chaque action des comptes, filtrable et exportable en CSV.") },
];

function Block({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <Card><h2 className="mb-3 flex items-center gap-2 font-bold"><Icon size={16} aria-hidden />{title}</h2>{children}</Card>;
}

export function Help() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-bold"><BookOpen size={16} aria-hidden />{tx("Bien utiliser MyServices")}</h2>
        <InfoNote>
          {tx("MyServices rassemble en une page les services, la santé et les sauvegardes de toutes vos machines, en s'appuyant sur les outils que vous avez déjà. Il lit, il ne modifie rien. Voici dans l'ordre comment le configurer, puis les bons réflexes.")}
        </InfoNote>
      </Card>

      <Block icon={ListChecks} title={tx("Par où commencer")}>
        <ol className="flex flex-col gap-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-link/15 text-xs font-bold text-link">{i + 1}</span>
              <div className="min-w-0">
                <b>{s.title}</b>
                <p className="text-muted">{s.text}</p>
                <a className={`${link} inline-flex items-center gap-1`} href={s.href}>{s.go}<ChevronRight size={14} aria-hidden /></a>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <Block icon={Wrench} title={tx("Comment MyServices lit votre réseau")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {READ_WAYS.map((w) => (
            <div key={w.title} className="rounded-xl border border-line bg-bg2/50 p-3 text-sm"><dt className="font-bold">{w.title}</dt><dd className="mt-0.5 text-muted">{w.text}</dd></div>
          ))}
        </dl>
        <InfoNote className="mt-3">{tx("Une machine peut avoir plusieurs sources : la première qui répond fait foi, les suivantes complètent. L'ordre se règle machine par machine.")}</InfoNote>
      </Block>

      <Block icon={ShieldCheck} title={tx("Bons réflexes")}>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted marker:text-link">{HABITS.map((h) => <li key={h}>{h}</li>)}</ul>
      </Block>

      <Block icon={LifeBuoy} title={tx("Si ça ne marche pas")}>
        <ul className="flex flex-col divide-y divide-line/60">
          {FIXES.map((f) => (
            <li key={f.problem} className="py-2.5 text-sm"><b>{f.problem}</b><p className="text-muted">{f.fix}</p></li>
          ))}
        </ul>
        <p className="mt-2 text-xs"><Dim>{tx("Le détail de chaque version est dans le CHANGELOG du projet.")}</Dim></p>
      </Block>
    </div>
  );
}
