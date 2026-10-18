// Fichiers produits par les tâches (data.json, health/stats.json, backups.json, events.json) : seulement les
// champs lus par le front. Source : myservices.py, health.py, backups.py, watcher.py.

export interface Probe {
  code?: number;
  err?: string;
  ms?: number;
  cert_ok?: boolean;
}

export interface Backend {
  up?: boolean;
  ms?: number;
  err?: string;
  internal?: boolean;
}

export interface WebCheck {
  cert_valid?: boolean;
  cert_days?: number | null;
}

export interface Service {
  kind: string;
  stale?: boolean;  // identification gardée du passage précédent : le backend ne répond plus
  name?: string;
  image?: string;
  version?: string;
  state?: string;
  compose?: string;
  title?: string;
  description?: string;
  url?: string;
  match?: string;
  inner?: number | null;
  logs_url?: string;
  vhost?: string;
  docroot?: string;
  conf?: string;
}

export interface Host {
  id: string | number;
  forward_declared?: string | null;   // NPM forward target, when the advanced config sends the traffic elsewhere (the real target is ip:port)
  vhost_domains?: string[];   // domain names declared by Apache / nginx on the machine for this port
  vhost_server?: "apache" | "nginx";
  npm?: string;
  scheme?: string;
  category?: string;
  app?: { key: string; label: string; confidence: "sure" | "probable" | "possible"; connector: string | null; agent_of?: string };
  tags?: string[];
  description?: string;
  page_title?: string;
  machine_role?: string;
  manual?: boolean;
  hsts?: boolean;
  http2?: boolean;
  websocket?: boolean;
  cloudflare?: boolean;
  block_exploits?: boolean;
  nginx_err?: string;
  created?: string;
  modified?: string;
  type: "proxy" | "redirect" | "dead" | "stream" | "local";
  enabled: boolean;
  domains: string[];
  name?: string;
  ip?: string;
  port?: number;
  host_ip?: string;
  target?: string;
  target_ip?: string;
  incoming_port?: number;
  listen_addr?: string;
  machine?: string;
  machine_off?: boolean;
  paused?: string;
  public?: Probe;
  backend?: Backend;
  follow?: { code?: number };
  service?: Service;
  closes_root?: boolean;
  acl?: string;
  acl_adv?: boolean;
  public_ok?: boolean;
  ssl?: boolean;
  ssl_forced?: boolean;
  nginx_online?: boolean;
  webcheck?: WebCheck & { hsts?: boolean; headers_ok?: number; headers_total?: number; checked?: number };
  uptime?: { name?: string; status: string; response_ms?: number | null; cert_days?: number | null }[];
  dns?: { issues: [string, ...unknown[]][]; rewrites?: unknown[] };
  web?: string;
  direct_ok?: boolean;
}

export interface Machine {
  ip: string;
  name: string;
  role?: string;
  ping: boolean;
  off: boolean;
  icon?: string | null;  // icône choisie dans Réglages → Machines (clé de lib/machineIcons.ts) ; absent = automatique
  detected?: string[];  // réglages confirmés par la détection (gateway, vm, npm, off) : les autres interrupteurs sont grisés
  ttl?: number | null;  // TTL du ping : 128 = Windows probable, 255 = matériel réseau
  disabled?: boolean;  // machine non suivie (Réglages → Machines) : ni ping, ni SSH, ni santé
  local?: boolean;
  gateway?: boolean;
  services: number;
  npm: number;
  down: number;
  ssh?: { alias: string; port: number; user?: string; identity?: string | null; key_fp?: string | null; host_key?: string | null; methods?: string[] | null; note?: string | null } | null;
  links?: MachineLinks | null;   // matching layer: MAC, other names, one badge per tool that sees it
  api?: { type: string; name: string; label: string; ok: boolean; stale?: boolean; version?: string | null; message?: string; host?: { cpu?: number; mem_pct?: number; temp?: number; boot?: string } | null }[];   // connecteurs API (Home Assistant…) qui lisent cette machine
  agent?: { os: string; kernel?: string | null; uptime_s?: number | null; hardware?: AgentHardware | null; docker?: number | null; apps?: { key: string; label: string }[]; via: "agent" } | null;  // système lu par l'agent (PC Windows)
  info?: {
    os?: string; kernel?: string; uptime_s?: number; gpus?: string[]; apache?: boolean; nginx?: boolean; docker?: number; docker_installed?: boolean;
    sshd?: { permitrootlogin?: string; passwordauthentication?: string };
    vhosts?: unknown[]; vhosts_unreadable?: string[];
  } | null;
}

export interface DnsServer {
  name: string;
  readable: boolean;
  rewrites: number;
  silent: number;
}

export interface Rewrite {
  domain: string;
  answer: string;
  why?: string;
  rule?: string;
  only?: string;
  waiting?: boolean;   // difference between two AdGuard: adguardhome-sync has not had a full turn since it appeared
  since?: number;      // when it was first seen (epoch s)
  enabled?: boolean;
}

export interface Dns {
  npm_ip?: string;
  servers: Record<string, DnsServer & { container?: string; user_rules?: number }>;
  sync?: Record<string, { container: string; origin?: string; last_done?: Record<string, string>; errors_24h?: number; errors_open?: number; last_error?: string | null; interval_min?: number; unreadable?: boolean }>;
  rewrites_diff: Rewrite[];
  user_rules_diff: Rewrite[];
  orphans: Rewrite[];
  invalid?: Rewrite[];
  direct?: Rewrite[];
}

export interface Connector {
  type: string;
  name: string;
  ok: boolean;
  message: string;
  ip?: string;  // machine visée (connecteurs SSH : Docker, process, AdGuard)
  found?: { name: string; count: number }[];
}

/** Une machine trouvée par la recherche réseau (netscan.py) */
export interface NetHost {
  ip: string;
  name: string;
  ports: number[];
  ssh_port?: number | null;
  hints: string[];
  apps: string[];
  title?: string | null;  // titre de la page web (port 80 ou 443)
  known?: boolean;        // machine déjà déclarée dans MyServices
  os?: "windows" | "linux" | "macos" | "ios" | "network" | null;  // système probable (suggestion)
  os_how?: string | null;  // indice qui le dit : SSH, ports, TTL, MAC…
}

export interface NetScan {
  phase: "idle" | "ping" | "identify" | "done";
  net: string | null;
  total: number;
  done: number;
  up: number;
  described: number;
  found: NetHost[];
  previous?: string[];
  previous_ended?: number | null;
  gone?: string[];
  ignored?: string[];  // appareils que l'auteur ne veut plus voir proposés
  started: number | null;
  ended: number | null;
  error: string | null;
  stopped: boolean;
}

/** État d'un service lu par son API (connecteur « status » : Home Assistant) */
export interface ServiceStatus {
  connector: string;
  name: string;
  label: string;
  ok: boolean;
  stale: boolean;
  message: string;
  version?: string | null;
  url?: string | null;
  entities?: number;
  facts?: { label: string; value: string; tone?: "ok" | "warn" | "bad" }[];  // connecteurs « état d'un service » : chiffres clés
  problems?: string[];                                                       // et ce qui est à regarder
  updates?: { name: string; installed?: string | null; latest?: string | null; group?: "core" | "addon" | "other" }[];
  instance?: string;                     // connector instance name (« name » can be the app's own, Home Assistant's place)
  // Home Assistant only
  addons?: { name: string; slug: string; version?: string | null; latest?: string | null }[];   // add-ons installed
  system?: { method?: string; core?: string | null; supervisor?: string; os?: string };            // what Home Assistant runs on
  state?: string | null;                 // RUNNING, NOT_RUNNING, STARTING
  unavailable?: number; unavailable_names?: string[]; batteries_low?: string[];
  automations?: { on: number; total: number };
  mcp?: HaMcp | null;   // advanced mode (ha-mcp add-on): backups, apps, integrations, configuration check
  host?: { cpu?: number | null; mem_pct?: number | null; temp?: number | null; disks?: { mount: string; used_pct: number; size_gb?: number; used_gb?: number }[]; ips?: string[]; boot?: string | null };
}

/** What the ha-mcp add-on gives about a Home Assistant (read-only calls); each part is absent when its call failed (see errors) */
export interface HaMcp {
  server?: { name?: string; version?: string };
  errors?: Record<string, string>;
  backups?: { total: number; items: { id: string; name: string; date: number; size: number; protected?: boolean; database?: boolean; ha_version?: string; auto?: boolean; locations: string[]; offsite?: boolean }[] };
  overview?: { version?: string; state?: string; notifications?: { title: string; created: number }[]; repairs?: number };
  health?: { config_ok?: boolean; config_errors?: string[]; repairs?: unknown[]; repairs_count?: number; components?: number };
  apps?: { total: number; running: number; stopped: number; updates: number; items: { name: string; slug: string; version?: string; state: string; update?: boolean }[] };
  integrations?: { total: number; states: Record<string, number>; problems: { domain: string; title?: string; state: string }[] };
}

/** Connecteur à proposer : appli reconnue sur une machine, pas encore réglée (known_apps.py) */
export interface Proposal {
  connector: string;
  label: string;
  confidence: "sure" | "probable" | "possible";
  ip: string;
  port: number | null;
  url: string;
  machine?: string | null;
  service?: string | null;
  linked?: boolean;                      // detected_apps seulement : un connecteur est déjà réglé pour cette machine
  running?: boolean | null;              // its container (or process) runs; false = stopped (docker ps -a), null = unknown
  state?: string;                        // docker state as read: « Up 2 days », « Exited (0) 3 weeks ago »
}

export interface Data {
  generated: string;
  page: { health_url: string; backups_url: string; stale_min: number; map: boolean; links: { url: string; label: string }[] };
  npm_instances: Record<string, string>;
  connectors?: Connector[];
  proposals?: Proposal[];
  detected_apps?: Proposal[];
  services_status?: ServiceStatus[];
  network?: NetworkConnector[];
  security?: SecurityConnector[];
  containers?: ContainersConnector[];
  virtualization?: VirtualizationConnector[];
  sheets?: Record<string, AddressSheet>;   // address -> sheet, from the fast reads (live.json), not from data.json
  hosts: Host[];
  dns?: Dns;
  machine_list: Machine[];
  unlinked?: Unlinked[];   // seen by a tool (MynetworK, Proxmox, Dockhand, Beszel), not followed here
}

/** One tool that sees a machine, and how it was tied to it (address is sure, name is a guess) */
export interface LinkSource { source: string; label: string; instance: string; by: "ip" | "mac" | "name"; ok: boolean; vmid?: number | string; node?: string; environment?: string; containers?: number; kind?: string;
  gpus?: { name?: string; temp?: number | null; util?: number | null; mem_used?: number | null; mem_total?: number | null; power?: number | null;
    day?: { temp_max?: number; util_avg?: number; util_max?: number; mem_max?: number; pow_avg?: number } }[];   // GpuViewR, day: last 24 h
  models?: { model?: string; alias?: string | null; port?: number | null; runtime?: string | null; state?: string | null; gpu?: number | null; mem_mb?: number }[] }   // AI models running (GpuViewR)
/** Matching layer (matching.py): the same machine as seen by the other tools */
export interface MachineLinks {
  mac: string | null; vendor: string | null; names: string[]; sources: LinkSource[];
  guest: { vmid?: number | string; type?: string; node?: string; status?: string; instance: string; source?: string } | null;
  hypervisor: { node?: string; instance: string; source?: string } | null;
}
export interface Unlinked { source: string; label: string; instance: string; ip?: string; mac?: string; name?: string; online?: boolean; vmid?: number | string; type?: string; node?: string }

export type Level = "ok" | "warn" | "crit" | "down";

export interface HealthHost {
  id: string;
  name: string; // « Nom · IP »
  os?: string;
  reachable: boolean;
  level: Level | "na";
  reboot_required?: boolean;
  disks?: { mount: string; used_pct: number; size_gb?: number; avail_gb?: number; warning?: boolean; critical?: boolean }[];
  systemd?: { failed: { unit: string }[] };
  docker?: { accessible: boolean; total?: number; stopped?: number; unhealthy?: number; restarting?: number; issues?: string[] };
  apt?: { upgradable: number; sample?: string[]; available?: boolean; security?: number | null; firmware?: boolean };   // packages (apt) or Windows updates; sample: up to 30 named
  kernel?: { has_errors: boolean; samples?: string[] };
  load?: { load_1: number; ncpu: number; available: boolean };
  res?: { available: boolean; cpu_pct?: number; mem_pct?: number; mem_total_mb?: number; mem_used_mb?: number; swap_total_mb?: number; swap_used_mb?: number };  // CPU et mémoire
  temp?: { available: boolean; celsius?: number; source?: string; virt?: string; sensors?: { name: string; celsius: number }[] };  // température du processeur (capteur de la machine ou Beszel)
  ssh_auth?: { failed_24h: number; available: boolean };
  smart?: { accessible: boolean; disks: { device: string; healthy: boolean; failed?: boolean }[]; vm?: boolean };
  source?: "ssh" | "agent" | "beszel" | "ha";  // source retenue pour la santé de la machine
  sources?: string[];                    // toutes celles qui ont servi (la retenue, puis celles qui ont complété)
  vmem?: { used_mb: number; total_mb: number; pct: number };
  drives?: { model: string | null; state: string | null; temperature: number | null; smart_ok: boolean | null }[];   // Freebox: its internal disks (the partitions are in `disks`)
  fans?: { name: string; rpm: number }[];       // Freebox: its fans
  vms?: { running: number; total: number };   // Freebox: its virtual machines, how many run   // Freebox: memory given to its virtual machines (the box itself reports no load)
  api_name?: string;                     // source « ha » : the service whose API was read (Glances, Home Assistant)
}

/** Poste « souvent éteint » qui ne répond pas : fiche grisée, sans alerte (last_seen : dernier relevé de son agent, en secondes) */
export interface AsleepHost { id: string; name: string; ip: string; os?: string; last_seen: number | null; ping?: boolean }

export interface Health {
  timestamp: string;
  hosts: HealthHost[];
  asleep?: AsleepHost[];
}

export interface BackupLocation {
  host: string;
  label: string;
  level: string;
  age?: number | null;
  via?: string;
  vzdump?: string | null;   // « qemu/101 »: dump of this Proxmox guest
}

export interface BackupSet {
  id: string;
  label: string;
  origin: string;
  schedule: string;
  level: string;
  archived: boolean;
  offsite: number;
  expect_offsite?: boolean;  // false : jeu décrit depuis la page, aucune copie ailleurs n'est exigée
  locations: BackupLocation[];
}

export interface BackupHost {
  id: string;
  label: string;
  ip: string;
  kind: string;
  reachable: boolean;
  level: string;
  storage?: boolean;
  disks: { mount: string; pct: number; avail: number; size: number; level: string }[];
  sets: string[];
  last_local: { age: number; mtime: number; set: string; level: string } | null;
  copies: { host: string; label: string; vias: string[]; sets: number; level: string; age: number | null; encrypted: boolean }[];
  crons: { line?: string; src?: string }[];
  local: { path: string; size: number | null; covered: string[]; age: number | null; readable?: boolean; newest_name?: string }[];
}

export interface Backups {
  generated: string;
  summary: { ok: number; warn: number; crit: number; sets: number; hosts: number; volume: number; no_offsite: number; offsite_unknown?: number; local_dirs?: number; local_unlisted?: number };
  issues: { level: Level; set: string; text: string }[];
  hosts?: BackupHost[];
  sets?: BackupSet[];
}

export interface Event {
  ts?: string;
  at?: string;
  kind: string;
  label?: string;
  machine?: string;
  target?: string;
  detail?: string;
}

/** Événement de l'historique SQLite (API v1 /events) */
export interface StoredEvent {
  ts: number;
  source: string;
  kind: string;
  key: string;
  label?: string;
  machine?: string;
  target?: string;
  detail?: string;
}

export interface Events {
  labels: Record<string, string>;
  severity: Record<string, number>;
  events: Event[];
}

export interface Me {
  username: string;
  role: "admin" | "viewer";
  git?: string;      // dev image: « branch|commit|ahead|tag|dirty » from scripts/git-rev.sh (build-arg GIT_REV)
  released?: string | null;  // last release written in this build's changelog (shown for images built from a branch)
  update?: { available: boolean; tag?: string | null; url?: string | null } | null;   // newer release published (last check kept); null: header notice off
  planned?: string | null;  // version prévue (journal des changements : section Unreleased + dernière publiée + 1)
  version?: string;  // version de l'application (tag de l'image, puis empreinte du commit) ; « dev » pour une image construite sur place
  email?: string | null;  // address for a forgotten password link (Profile)
  avatar?: string | null;  // fingerprint of the account's avatar (api/v1/users/<name>/avatar?v=…); null: its initial
}

/** Compte (api/v1/users) ; dates en secondes. */
export interface User {
  username: string;
  role: "admin" | "viewer";
  created: number;
  last_login: number | null;
  disabled: number;
}

/** Réglages → Alertes (api/v1/alerts) ; secrets jamais renvoyés (« set » dit s'ils sont renseignés). */
export type ChannelType = "discord" | "telegram" | "webhook";
export interface AlertChannel {
  id: number;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, string>;
  set: Record<string, boolean>;
}
export interface AlertRule {
  id: number;
  name: string;
  kinds: string[];
  machine: string;
  match: string;
  channels: number[];
  cooldown_min: number;
  resolved: boolean;
  enabled: boolean;
}
export interface AlertSent {
  ts: number;
  rule: string;
  channel: string;
  ok: number;
  n: number;
  info: string;
  summary: string;
}
export interface AlertsState {
  channels: AlertChannel[];
  rules: AlertRule[];
  sent: AlertSent[];
  active: boolean;
  kinds: { id: string; label: string; group: string }[];
  groups: Record<string, string>;
  presets: { name: string; kinds: string[]; resolved: boolean; cooldown_min: number }[];
}

/** Réglages → Connecteurs (api/v1/connectors/settings) */
export interface ConnectorField {
  name: string;
  label: string;
  kind: "text" | "url" | "password" | "number" | "bool" | "choice";
  required: boolean;
  secret: boolean;
  default: unknown;
  help: string;
  choices: string[];
}
/** Façon de relier un service quand elle demande d'autres champs (NPM : API directe, API par SSH, script) */
export interface ConnectorMode { id: string; label: string; help: string; fields: string[]; required: string[] }
export interface ConnectorType {
  type: string;
  label: string;
  category?: string;   // grouping in the « add » picker (Monitoring, Médias…)
  kinds: string[];
  tested: string[];
  guide?: string[];
  fields: ConnectorField[];
  modes?: ConnectorMode[];
}
/** Conseil sur le chemin de npm-api.sh (vert / orange / rouge) */
export interface ScriptTip { level: "ok" | "warn" | "bad"; text: string }
export interface ConnectorStatus {
  via?: string; label?: string;   // read over SSH without a connector (Proxmox by pvesh…): « Already read over SSH »
  type: string;
  name: string;
  ok: boolean;
  message: string;
  version: string | null;
  version_tested: boolean | null;
  stale: boolean;
  failures: number;
  warning?: string;   // read fine but incomplete (ss without root): orange, not a failure
  found?: { name: string; count: number }[];
  pending?: boolean;   // saved or switched on after the last collection: being read again
}
export interface ConnectorInstance {
  type: string;
  label: string;
  name: string;
  config: Record<string, string | number | boolean>;
  set: Record<string, boolean>;
  enabled: boolean;
  status: ConnectorStatus | null;
}
export interface ConnectorsState {
  types: ConnectorType[];
  instances: ConnectorInstance[];
  others: ConnectorStatus[];
}

/** Ligne du journal d'audit (api/v1/audit) */
export interface AuditEntry {
  ts: number;
  username: string | null;
  ip: string | null;
  action: string;
  detail: string | null;
}

/** Réglages → Machines (api/v1/machines/…) : entrée de services-meta.json */
export interface MachineConf {
  name: string;
  role?: string;
  ssh?: string | null | false;   // false : SSH coupé à la main (jamais réactivé seul) ; null / absent : jamais réglé
  os?: string;
  health?: string | boolean | Record<string, unknown>;
  off?: boolean;
  disabled?: boolean;
  gateway?: boolean;
  npm?: boolean;
  npm_only?: boolean;
  vm?: boolean;
  adguard?: string;
  adguard_sync?: string;
  [k: string]: unknown;
}
export interface SshAlias { alias: string; host: string; ip: string | null; user?: string; port?: number }
export interface MachinesSettings {
  machines: Record<string, MachineConf>;
  process_hosts: Record<string, string>;
  aliases: SshAlias[];
  ssh_conf: string;
}
export interface Detection {
  ip: string;
  alias: string | null;
  up: boolean;
  dns: string;
  hints: string[];
  known: boolean;
  machine: MachineConf;
  notes: string[];
  detected?: string[];  // réglages cochés d'après la détection (gateway, npm, vm, off), à confirmer
  connectors: { type: string; label: string; container: string; proposed: Record<string, string> }[];
  web: { port: number; scheme: string; label: string }[];
}

/** Redétection des machines enregistrées (POST machines/redetect) : écarts proposés, rien n'est écrit */
export interface RedetectItem {
  ip: string;
  name: string;
  verifiable: boolean;
  note: string | null;  // « injoignable : non vérifiable », « rien à changer » ; null = des écarts à confirmer
  flags_on: string[];   // réglages détectés mais éteints
  flags_off: string[];  // réglages allumés mais plus confirmés (détection fiable seulement)
  os: string | null;    // système probable quand il manque
  process: boolean;     // lire aussi les services hors Docker
  ports: { port: number; name: string }[];
  role_add?: string[];     // étiquettes du rôle vues par la détection (applis, ports par défaut joignables)
  role_remove?: string[];  // étiquettes automatiques périmées (« port 5000 »…)
}
export interface Redetection { machines: RedetectItem[]; changes: number }

/** Réglages → API et MCP (api/v1/tokens) */
export interface ApiToken {
  id: number;
  kind: "api" | "mcp";
  name: string;
  level: "read" | "runs" | "admin";
  hint: string;
  created: number;
  created_by: string | null;
  expires: number | null;
  revoked: number | null;
  last_used: number | null;
  last_ip: string | null;
  state: string;
}
export interface McpTool { name: string; level: string; description: string; enabled: boolean }
export interface TokensState { tokens: ApiToken[]; tools: McpTool[]; mcp_path: string; api_path: string }

/** Matériel lu par l'agent Windows (champs absents = non lisibles) */
export interface AgentHardware {
  maker?: string | null; model?: string | null; bios?: string | null; cpu?: string | null; cores?: number | null; threads?: number | null;
  ram_gb?: number | null; domain?: string | null; last_update?: string | null;
  gpu?: { name: string; res?: string | null }[]; net?: { name: string; ip: string }[];
}

/** Réglages → Agents (api/v1/agents) */
export interface AgentInfo {
  kind?: "windows" | "linux";  // type d'agent : script PowerShell ou Python
  hostname?: string | null;     // nom de poste retenu au premier relevé
  host_pending?: string | null; // autre nom de poste vu : relevés refusés jusqu'à confirmation de l'admin
  auto_update?: boolean;       // mise à jour automatique : l'agent récupère le script du serveur s'il est plus ancien
  update_requested?: boolean;  // « mettre à jour maintenant » demandé, pas encore pris en compte
  latest_version?: string;     // version du script d'agent servi par cette installation
  outdated?: boolean;          // l'agent est plus ancien que le script servi
  id: number;
  ip: string;
  name: string;
  hint: string;
  created: number;
  created_by: string | null;
  revoked: number | null;
  last_seen: number | null;
  last_ip: string | null;
  interval: number;
  version: string | null;
  os: string | null;
  state: "actif" | "silencieux" | "en attente" | "révoqué";
}
/** Méthode de lecture recommandée pour une machine (GET machines/advice, access_advice.py) */
export interface Advice {
  kind: string; method: "ssh" | "agent" | "connector" | "ping"; why: string; current: string[]; alternatives: string[];
  agent_possible: boolean; agent_kind: "windows" | "linux" | null;
  agent_state: "actif" | "silencieux" | "en attente" | null;   // état de l'agent installé, s'il y en a un
}
export interface AgentsState { agents: AgentInfo[]; report_path: string }

/** Réglages → Système (api/v1/system) */
export interface SystemTask {
  name: string; label: string; at: string; default: string; fixed: boolean; enabled: boolean; running: boolean;
  started: number | null; ended: number | null; result: string | null; timeout_s: number;
  next?: number | null;  // prochain passage (epoch), null si coupée
  switch?: boolean;     // la page propose un interrupteur pour allumer / couper la tâche (santé)
  why?: string | null;  // pourquoi la tâche est coupée et comment l'allumer
}
export interface SystemState {
  ssh: { public: string | null; fingerprint?: string | null; known_hosts?: number; authorize?: string; public_esxi?: string | null };
  tasks: SystemTask[];
  scheduler?: { beat: number | null };  // dernier tour du planificateur (epoch) : vivant s'il est récent
  netscan?: { every_h: number; enabled: boolean; running: boolean; next: number | null; started: number | null; ended: number | null };
  host_docker?: { present: boolean; containers: number; networks: number };
  info: {
    version: string; python: string; started: number; uptime_s: number; port: number; allow: string[]; auth: boolean;
    cookie_secure: boolean; docker: boolean; sizes: { data: number; db: number; config: number }; paths: { config: string; data: string };
  };
}

/** Connecteurs d'infrastructure : état de l'instance, puis les données propres à chaque type (data.json) */
export interface InfraConnector { connector: string; name: string; label: string; ok: boolean; stale: boolean; message: string; version?: string | null; url?: string | null }
/** Fiche d'une adresse lue par MynetworK (ip-details, 0.10.74+) : scanner, où UniFi la voit branchée, bail et redirections de la Freebox */
export interface AddressSheet {
  scan?: { status?: string; ping_ms?: number | null; ports: number[]; ports_at?: string | null };
  unifi?: { name?: string; wired?: boolean; wireless?: boolean; switch_name?: string; switch_ip?: string; switch_model?: string; switch_port?: number; ap_name?: string; ap_model?: string };
  freebox?: { dhcp?: { ip?: string; hostname?: string; mac?: string; static?: boolean }; forwards?: Record<string, unknown>[]; name?: string; active?: boolean; type?: string };
}
export interface NetDevice { ip: string; mac?: string | null; hostname?: string | null; vendor?: string | null; status: string; ping_ms?: number | null; first_seen?: string | null; last_seen?: string | null; ports: number[]; ports_at?: string | null }
/** MynetworK : inventaire du réseau (scanner, UniFi) */
export interface NetworkConnector extends InfraConnector {
  devices?: NetDevice[]; online?: number;
  unifi?: { clients: { name?: string; ip?: string; mac?: string; wired?: boolean; essid?: string }[]; devices: UnifiDevice[]; system?: UnifiSystem | null } | null;
  freebox?: FreeboxInfo | null;
}
/** The Freebox as MynetworK relays it (no address given: matched to the machine whose name contains « Freebox ») */
export interface FreeboxInfo {
  connection?: { state?: string; media?: string; rate_down?: number; rate_up?: number; bandwidth_down?: number; bandwidth_up?: number } | null;
  system?: { model?: string; firmware?: string; latest_firmware?: string | null; update_available?: boolean | null; uptime?: number; lan_ip?: string | null;
    sensors?: { id?: string; name?: string; value: number }[]; fans?: { id?: string; name?: string; value: number }[] } | null;
  // MynetworK 0.10.69+: null = the paired app lacks the right (see missing_rights), absent = the box does not have it
  storage?: { disks: { model: string | null; state: string | null; smart_ok: boolean | null; temperature: number | null; total_bytes: number | null }[];
    partitions: { label: string | null; fstype: string | null; total_bytes: number | null; used_bytes: number | null; free_bytes: number | null; used_pct: number | null }[] } | null;
  ftth?: { sfp_present: boolean | null; sfp_has_signal: boolean | null; link: boolean | null; sfp_pwr_rx: number | null; sfp_pwr_tx: number | null } | null;
  wifi?: { enabled: boolean | null; aps: { name: string | null; state: string | null; band: string | null; channel: number | null; width?: string | null }[]; stations_count: number | null;
    networks?: { ssid: string | null; enabled: boolean | null; hidden: boolean | null; state: string | null; band: string | null }[] } | null;
  vms?: { id: number | null; name: string | null; status: string | null; vcpus: number | null; memory_mb: number | null; os: string | null }[] | null;
  // memory_pct and cpu_pct: the share allocated to the virtual machines, not the box's real load (MynetworK announces them; computed from the totals until then)
  vm_system?: { total_memory_mb: number | null; used_memory_mb: number | null; total_cpus: number | null; used_cpus: number | null; memory_pct?: number | null; cpu_pct?: number | null } | null;
  firmware_update?: { server?: { installed: string | null; latest: string | null; update_available: boolean | null; date: string | null; changelog: string | null; url: string | null } | null } | null;   // MynetworK 0.10.72+
  dhcp?: { enabled: boolean | null; ip_range_start: string | null; ip_range_end: string | null; gateway: string | null; netmask: string | null; dns: string[] } | null;   // MynetworK 0.10.72+
  missing_rights?: string[];
  hosts?: number | null; hosts_active?: number | null;   // devices the box has seen, and the ones active now
}
/** LogviewR : fail2ban */
export interface SecurityConnector extends InfraConnector {
  jails?: string[]; bans_24h?: number; bans?: { ip: string; jail: string; time: number; failures?: number }[]; threat_count?: number; log_sources?: number;
  stats?: Fail2banStats | null;   // 7 days of bans, worked out by the connector (connectors/logviewr.py ban_stats)
  threats?: { key: string; kind: "ip_escalation" | "asn_campaign" | "autre"; ips: string[]; ip_count: number; jails: string[]; bans: number | null; first: number | null; last: number | null; severity: number | null; asn: string | null }[];
}
export interface Fail2banStats {
  hours: number[]; days: number[];   // bans per hour over the last 24 h, per day over the last 7 (the last value is the most recent)
  by_jail: { jail: string; d1: number; d7: number }[];
  top_ips: { ip: string; bans: number; jails: string[]; failures: number; last: number; domains?: { domain: string; hits: number }[] }[];
  by_domain?: { domain: string; hits: number; ips: number }[];   // the domains the banned addresses went after (from the web logs LogviewR reads)
  unique_1d: number; unique_7d: number; repeat: number; failures_1d: number;
}
/** Dockhand, Dozzle : environnements Docker (hôtes, agents) */
export interface ContainersConnector extends InfraConnector {
  environments?: { id: number | string; name?: string; host?: string | null; agent?: string | null; available?: boolean;
    containers: { total?: number; running?: number; stopped?: number; paused?: number; unhealthy?: number }; updates: { container?: string; image?: string; newer?: string | null }[] }[];
  updates?: number;
  links_only?: boolean;   // Dozzle behind its login without an account here: links only, no card
}
/** Proxmox VE (nœuds, VM, conteneurs, stockages) et Proxmox Backup Server (magasins) */
export interface VirtualizationConnector extends InfraConnector {
  via?: "ssh" | "agent"; ip?: string;   // ssh: read on the host (pvesh, vim-cmd, virsh…), agent: Hyper-V by the Windows agent
  problems?: string[];   // Unraid, Datacenter Manager: what needs a look
  nodes?: { name: string; online: boolean; cpu_pct?: number | null; mem_pct?: number | null; uptime?: number | null; cpus?: number | null; mem?: number | null; maxmem?: number | null; model?: string | null
    load?: number[]; iowait_pct?: number; swap_used?: number; swap_total?: number; root_used?: number; root_total?: number; kernel?: string; sockets?: number; cores?: number; temp_c?: number; fans_rpm?: number[] }[];
  guests?: { name?: string; type: "qemu" | "lxc" | "vm"; node?: string; status?: string; template: boolean; cpu_pct?: number | null; mem_pct?: number | null; uptime?: number | null;
    cpus?: number | null; mem?: number | null; maxmem?: number | null; maxdisk?: number | null; tags?: string[]; vmid: number | string; os?: string | null; ip?: string | null; hostname?: string | null }[];
  storage?: { name: string; node?: string; used_pct?: number | null; status?: string; used?: number | null; total?: number | null }[];
  totals?: { vm: number; lxc: number; running: number; stopped: number };
  backups?: { last: number; ok: boolean; failed_recent: number } | null;
  datastores?: { name: string; used_pct?: number | null; last_backup?: number | null; groups: number; age_h?: number | null }[];
}

/** Réglages → Notifications (api/v1/notifications) */
export interface NotificationReport { machines: string[]; sensors: string[]; at: string[]; days: number[] }
export interface NotificationEvents { kinds: string[]; machine: string; match: string; resolved: boolean; cooldown_min: number }
export interface NotificationItem {
  id: number; name: string; kind: "report" | "events"; enabled: boolean; channels: number[]; last_sent: number | null;
  config: NotificationReport & NotificationEvents;
}
export interface NotificationsState {
  notifications: NotificationItem[]; channels: AlertChannel[]; sent: AlertSent[];
  sensors: { id: string; label: string; icon: string }[]; machines: { ip: string; name: string }[];
  kinds: { id: string; label: string; group: string }[]; groups: Record<string, string>; examples: { name: string; kind: "report" | "events" }[];
}

/** UniFi system summary (MynetworK 0.10.68+, /api/plugins/unifi/system): UniFi Network, UniFi OS and the gateway; unknown = null */
export interface UnifiSystem {
  version?: string | null; previous_version?: string | null; update_available?: boolean | null; update_downloaded?: boolean | null;
  name?: string | null; hostname?: string | null; uptime?: number | null; console_version?: string | null;
  gateway?: { version?: string | null; upgradable?: boolean | null; upgrade_to_firmware?: string | null; lan_ip?: string | null; uptime?: number | null;
    cpu_pct?: number | null; mem_pct?: number | null; mem_total?: number | null; mem_used?: number | null; temperature?: number | null } | null;
}

/** A UniFi device as MynetworK relays it (gateway, switch, access point); upgradable / upgrade_to_firmware only when MynetworK passes them on */
export interface UnifiDevice {
  name?: string; model?: string; type?: string; state?: string; clients?: number; mac?: string; ip?: string; version?: string;
  uptime?: number; cpu_pct?: number | string | null; mem_pct?: number | string | null; upgradable?: boolean | null; upgrade_to_firmware?: string | null;
  temperature?: number | null; mem_total?: number | null; mem_used?: number | null;   // from the system summary, gateway only
  network_update?: boolean;                                                             // the UniFi Network application it runs has an update
}
