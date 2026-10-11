// Logo d'un système d'exploitation d'après son nom lisible (« Debian GNU/Linux 13 », « Ubuntu 24.04 », « Microsoft Windows 11 »…).
// Les fichiers sont dans public/icons ; aucun logo (null) : l'appelant garde l'icône générique de la famille (Linux, Windows…).
const DISTROS: [RegExp, string][] = [
  [/windows server/, "windows-server"], [/windows 11/, "windows-11"], [/windows 10/, "windows-10"], [/windows/, "windows-classic"],
  [/ubuntu/, "ubuntu"], [/debian/, "debian"], [/fedora/, "fedora"], [/arch ?linux|\barch\b/, "archlinux"], [/centos/, "centos"],
  [/red ?hat|rhel/, "redhat"], [/alpine/, "alpinelinux"], [/opensuse|suse/, "opensuse"], [/freebsd/, "freebsd"], [/linux mint|\bmint\b/, "linuxmint"],
  [/manjaro/, "manjaro"], [/nixos/, "nixos"], [/gentoo/, "gentoo"], [/kali/, "kalilinux"], [/android/, "android"], [/raspbian|raspberry/, "raspberrypi"],
  [/truenas/, "truenas"], [/synology|dsm/, "synology"], [/qnap/, "qnap"], [/unraid/, "unraid"], [/openwrt/, "openwrt"], [/pfsense/, "pfsense"],
  [/opnsense/, "opnsense"], [/proxmox|pve/, "proxmox"],
];

/** Adresse du logo de la distribution ou du système, ou null */
export function distroIcon(osName?: string | null): string | null {
  const t = (osName || "").toLowerCase();
  const hit = t ? DISTROS.find(([rx]) => rx.test(t)) : undefined;
  return hit ? `${import.meta.env.BASE_URL}icons/${hit[1]}.svg` : null;
}
