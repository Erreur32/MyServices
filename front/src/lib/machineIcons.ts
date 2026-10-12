// Icônes qu'on peut attribuer à une machine (Réglages → Machines → Identité). Clé enregistrée dans services-meta.json (« icon ») ;
// sans clé, l'icône reste automatique (appli reconnue, sinon système). Trois familles : applis (images de public/icons), systèmes,
// et quelques objets courants.
import { Antenna, Apple, Bot, Boxes, Cable, Camera, Car, Cctv, Cloud, Container, Cpu, Database, Droplets, Fan, Film, Flame, Gamepad2, Globe, HardDriveDownload, Headphones, Home, Lamp, Laptop, Lightbulb, Lock, Mail, MemoryStick, Mic, Monitor, MonitorSmartphone, Music, Network, Plug, Printer, Projector, Radio, Router, Satellite, Server, ServerCog, Shield, Smartphone, Speaker, Tablet, Terminal, Thermometer, Tv, Usb, Watch, Webcam, Wifi, Workflow, Wrench, Zap, type LucideIcon } from "lucide-react";
import { tx } from "./i18n";

export type ChosenIcon = { key: string; label: string; family: "app" | "system" | "object" } & ({ file: string } | { Icon: LucideIcon });

const app = (key: string, label: string): ChosenIcon => ({ key, label, family: "app", file: key });
/** Logo de public/icons (applis et systèmes), couleur de la marque ; gris quand elle serait illisible sur fond clair ou sombre */
const brand = (key: string, label: string, family: "app" | "system"): ChosenIcon => ({ key, label, family, file: key });
const obj = (key: string, label: string, Icon: LucideIcon): ChosenIcon => ({ key, label, family: "object", Icon });

export const MACHINE_ICONS: ChosenIcon[] = [
  app("home-assistant", "Home Assistant"), app("proxmox", "Proxmox"), app("plex", "Plex"), app("docker", "Docker"),
  app("nginx-proxy-manager", "Nginx Proxy Manager"), app("adguard-home", "AdGuard Home"), app("beszel", "Beszel"), app("uptime-kuma", "Uptime Kuma"),
  app("dozzle", "Dozzle"), app("nginx", "nginx"), app("apache", "Apache"), app("syncthing", "Syncthing"), app("grafana", "Grafana"), app("unifi", "UniFi"),
app("dockhand", "Dockhand"), app("nextcloud", "Nextcloud"), app("healthchecks", "Healthchecks"), app("crowdsec", "CrowdSec"),
  app("technitium", "Technitium DNS"), app("nut", tx("Onduleur (NUT)")), app("freebox", "Freebox"), app("free", tx("Free (opérateur)")), app("wd", "Western Digital"), app("logviewr", "LogviewR"), app("mynetwork", "MynetworK"), app("veeam", "Veeam"), app("web-check", "Web-Check"),
  { key: "linux", label: "Linux", family: "system", Icon: Terminal }, { key: "windows", label: "Windows", family: "system", Icon: Monitor },
  { key: "macos", label: "macOS", family: "system", Icon: Apple }, { key: "ios", label: "iOS / Android", family: "system", Icon: Smartphone },
  { key: "network", label: tx("Matériel réseau"), family: "system", Icon: Router }, { key: "pi", label: "Raspberry Pi", family: "system", Icon: Cpu },
  { key: "server", label: tx("Serveur"), family: "object", Icon: Server }, { key: "nas", label: "NAS", family: "object", file: "nas" },
  { key: "laptop", label: tx("Portable"), family: "object", Icon: Laptop }, { key: "tv", label: tx("Télévision"), family: "object", Icon: Tv },
  { key: "camera", label: tx("Caméra"), family: "object", Icon: Camera }, { key: "game", label: tx("Console de jeu"), family: "object", Icon: Gamepad2 },
  { key: "printer", label: tx("Imprimante"), family: "object", Icon: Printer }, { key: "home", label: tx("Domotique"), family: "object", Icon: Home },
  { key: "ai", label: tx("IA / LLM"), family: "object", Icon: Bot },
  // Windows, plusieurs styles (dessins génériques : fenêtre à quatre carreaux)
  brand("windows-11", "Windows 11", "system"), brand("windows-10", "Windows 10", "system"), brand("windows-classic", tx("Windows classique"), "system"),
  brand("windows-server", "Windows Server", "system"), brand("windows-mono", tx("Windows (monochrome)"), "system"),
  // Plus de systèmes
  brand("ubuntu", "Ubuntu", "system"), brand("debian", "Debian", "system"), brand("fedora", "Fedora", "system"),
  brand("archlinux", "Arch Linux", "system"), brand("centos", "CentOS", "system"), brand("redhat", "Red Hat", "system"),
  brand("alpinelinux", "Alpine Linux", "system"), brand("opensuse", "openSUSE", "system"), brand("freebsd", "FreeBSD", "system"),
  brand("linuxmint", "Linux Mint", "system"), brand("manjaro", "Manjaro", "system"), brand("nixos", "NixOS", "system"),
  brand("gentoo", "Gentoo", "system"), brand("kalilinux", "Kali Linux", "system"), brand("android", "Android", "system"),
  brand("raspberrypi", "Raspberry Pi OS", "system"), brand("truenas", "TrueNAS", "system"), brand("synology", "Synology", "system"),
  brand("qnap", "QNAP", "system"), brand("unraid", "Unraid", "system"), brand("openwrt", "OpenWrt", "system"),
  brand("pfsense", "pfSense", "system"), brand("opnsense", "OPNsense", "system"), brand("vmware-esxi", "VMware ESXi", "system"), brand("vcenter", "VMware vCenter", "system"), brand("vmware", tx("VMware (logo texte)"), "system"),
  brand("ubiquiti", "Ubiquiti", "system"), brand("mikrotik", "MikroTik", "system"), brand("tp-link", "TP-Link", "system"),
  // Plus de services
  brand("portainer", "Portainer", "app"), brand("traefik", "Traefik", "app"), brand("caddy", "Caddy", "app"),
  brand("prometheus", "Prometheus", "app"), brand("influxdb", "InfluxDB", "app"), brand("mariadb", "MariaDB", "app"),
  brand("postgresql", "PostgreSQL", "app"), brand("mysql", "MySQL", "app"), brand("redis", "Redis", "app"),
  brand("mongodb", "MongoDB", "app"), brand("jellyfin", "Jellyfin", "app"),
  brand("emby", "Emby", "app"), brand("sonarr", "Sonarr", "app"), brand("radarr", "Radarr", "app"),
  brand("qbittorrent", "qBittorrent", "app"), brand("transmission", "Transmission", "app"), brand("pihole", "Pi-hole", "app"),
  brand("wireguard", "WireGuard", "app"), brand("tailscale", "Tailscale", "app"), brand("vaultwarden", "Vaultwarden", "app"),
  brand("gitea", "Gitea", "app"), brand("gitlab", "GitLab", "app"), brand("github", "GitHub", "app"),
  brand("homebridge", "Homebridge", "app"), brand("mosquitto", "Mosquitto", "app"), brand("nodered", "Node-RED", "app"),
  brand("zigbee2mqtt", "Zigbee2MQTT", "app"), brand("esphome", "ESPHome", "app"), brand("frigate", "Frigate", "app"),
  brand("netdata", "Netdata", "app"), brand("minio", "MinIO", "app"), brand("immich", "Immich", "app"),
  brand("paperless-ngx", "Paperless-ngx", "app"), brand("ghost", "Ghost", "app"), brand("wordpress", "WordPress", "app"),
  brand("openvpn", "OpenVPN", "app"), brand("cloudflare", "Cloudflare", "app"), brand("authelia", "Authelia", "app"),
  brand("authentik", "authentik", "app"), brand("ollama", "Ollama", "app"), brand("kubernetes", "Kubernetes", "app"),
  brand("ansible", "Ansible", "app"), brand("terraform", "Terraform", "app"), brand("jenkins", "Jenkins", "app"),
  brand("kodi", "Kodi", "app"), brand("steam", "Steam", "app"), brand("discord", "Discord", "app"),
  brand("telegram", "Telegram", "app"), brand("teamviewer", "TeamViewer", "app"), brand("wikijs", "Wiki.js", "app"),
  // Plus d'objets
  obj("database", tx("Base de données"), Database),
  obj("cloud", tx("Cloud"), Cloud),
  obj("shield", tx("Pare-feu / sécurité"), Shield),
  obj("wifi", tx("Borne Wi-Fi"), Wifi),
  obj("switch", tx("Switch réseau"), Network),
  obj("tablet", tx("Tablette"), Tablet),
  obj("speaker", tx("Enceinte"), Speaker),
  obj("music", tx("Musique"), Music),
  obj("media", tx("Médias / cinéma"), Film),
  obj("vault", tx("Coffre / accès"), Lock),
  obj("fan", tx("Ventilation"), Fan),
  obj("sensor", tx("Capteur"), Thermometer),
  obj("ups", tx("Onduleur (UPS)"), Zap),
  obj("cctv", tx("Vidéosurveillance"), Cctv),
  obj("webcam", tx("Webcam"), Webcam),
  obj("watch", tx("Montre"), Watch),
  obj("mic", tx("Micro"), Mic),
  obj("radio", tx("Radio"), Radio),
  obj("satellite", tx("Satellite"), Satellite),
  obj("boxes", tx("Conteneurs"), Boxes),
  obj("container", tx("Conteneur"), Container),
  obj("web", tx("Site web"), Globe),
  obj("mail", tx("Messagerie"), Mail),
  obj("workflow", tx("Automatisation"), Workflow),
  obj("tools", tx("Outils / maintenance"), Wrench),
  obj("usb", tx("Périphérique USB"), Usb),
  obj("plug", tx("Prise connectée"), Plug),
  obj("light", tx("Éclairage"), Lightbulb),
  obj("memory", tx("Mémoire"), MemoryStick),
  obj("projector", tx("Projecteur"), Projector),
  obj("audio", tx("Audio"), Headphones),
  obj("car", tx("Voiture"), Car),
  obj("antenna", tx("Antenne"), Antenna),
  obj("cable", tx("Câblage"), Cable),
  obj("servercog", tx("Serveur (admin)"), ServerCog),
  obj("multi", tx("Multi-écrans"), MonitorSmartphone),
  obj("downloads", tx("Téléchargements"), HardDriveDownload),
  obj("heating", tx("Chauffage"), Flame),
  obj("water", tx("Arrosage / eau"), Droplets),
  obj("lamp", tx("Lampe"), Lamp),
];

/** Icône choisie pour cette clé ; undefined si la clé est vide ou inconnue (retour à l'automatique) */
export const chosenIcon = (key?: string | null): ChosenIcon | undefined => (key ? MACHINE_ICONS.find((i) => i.key === key) : undefined);
