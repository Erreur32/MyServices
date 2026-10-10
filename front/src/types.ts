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
  npm?: string;
  scheme?: string;
  category?: string;
  app?: { key: string; label: string; confidence: "sure" | "probable" | "possible"; connector: string | null };
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
  detected?: string[];  // réglages confirmés par la détection (gateway, vm, npm, off) : les autres interrupteurs sont grisés
  ttl?: number | null;  // TTL du ping : 128 = Windows probable, 255 = matériel réseau
  disabled?: boolean;  // machine non suivie (Réglages → Machines) : ni ping, ni SSH, ni santé
  local?: boolean;
  gateway?: boolean;
  services: number;
  npm: number;
  down: number;
  ssh?: { alias: string; port: number; user?: string; identity?: string | null; key_fp?: string | null; host_key?: string | null; methods?: string[] | null; note?: string | null } | null;
  info?: {
    os?: string; kernel?: string; uptime_s?: number; apache?: boolean; nginx?: boolean; docker?: number; docker_installed?: boolean;
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
  enabled?: boolean;
}

export interface Dns {
  npm_ip?: string;
  servers: Record<string, DnsServer & { container?: string; user_rules?: number }>;
  sync?: Record<string, { container: string; origin?: string; last_done?: Record<string, string>; errors_24h?: number; interval_min?: number; unreadable?: boolean }>;
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
  updates?: { name: string; installed?: string | null; latest?: string | null }[];
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
}

export interface Data {
  generated: string;
  page: { health_url: string; backups_url: string; stale_min: number; map: boolean; sources?: Record<string, boolean>; links: { url: string; label: string }[] };
  npm_instances: Record<string, string>;
  connectors?: Connector[];
  proposals?: Proposal[];
  services_status?: ServiceStatus[];
  hosts: Host[];
  dns?: Dns;
  machine_list: Machine[];
}

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
  apt?: { upgradable: number; sample?: string[] };
  kernel?: { has_errors: boolean; samples?: string[] };
  load?: { load_1: number; ncpu: number; available: boolean };
  res?: { available: boolean; cpu_pct?: number; mem_pct?: number; mem_total_mb?: number; mem_used_mb?: number; swap_total_mb?: number; swap_used_mb?: number };  // CPU et mémoire
  temp?: { available: boolean; celsius?: number; source?: string; virt?: string };  // température du processeur (capteur de la machine ou Beszel)
  ssh_auth?: { failed_24h: number; available: boolean };
  smart?: { accessible: boolean; disks: { device: string; healthy: boolean; failed?: boolean }[]; vm?: boolean };
  source?: "ssh" | "agent" | "beszel";  // source retenue pour la santé de la machine
  sources?: string[];                    // toutes celles qui ont servi (la retenue, puis celles qui ont complété)
}

export interface Health {
  timestamp: string;
  hosts: HealthHost[];
}

export interface BackupLocation {
  host: string;
  label: string;
  level: string;
  age?: number | null;
  via?: string;
}

export interface BackupSet {
  id: string;
  label: string;
  origin: string;
  schedule: string;
  level: string;
  archived: boolean;
  offsite: number;
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
  summary: { ok: number; warn: number; crit: number; sets: number; hosts: number; volume: number; no_offsite: number; local_dirs?: number; local_unlisted?: number };
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
export interface ConnectorType {
  type: string;
  label: string;
  kinds: string[];
  tested: string[];
  guide?: string[];
  fields: ConnectorField[];
}
export interface ConnectorStatus {
  type: string;
  name: string;
  ok: boolean;
  message: string;
  version: string | null;
  version_tested: boolean | null;
  stale: boolean;
  failures: number;
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
  ssh?: string | null;
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

/** Réglages → Agents (api/v1/agents) */
export interface AgentInfo {
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
export interface AgentsState { agents: AgentInfo[]; report_path: string }

/** Réglages → Système (api/v1/system) */
export interface SystemTask {
  name: string; label: string; at: string; default: string; fixed: boolean; enabled: boolean; running: boolean;
  started: number | null; ended: number | null; result: string | null; timeout_s: number;
  switch?: boolean;     // la page propose un interrupteur pour allumer / couper la tâche (santé)
  why?: string | null;  // pourquoi la tâche est coupée et comment l'allumer
}
export interface SystemState {
  ssh: { public: string | null; fingerprint?: string | null; known_hosts?: number; authorize?: string };
  tasks: SystemTask[];
  host_docker?: { present: boolean; containers: number; networks: number };
  info: {
    version: string; python: string; started: number; uptime_s: number; port: number; allow: string[]; auth: boolean;
    cookie_secure: boolean; docker: boolean; sizes: { data: number; db: number; config: number }; paths: { config: string; data: string };
  };
}
