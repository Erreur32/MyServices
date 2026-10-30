import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { distroIcon } from "./osIcon";

describe("logo du système", () => {
  it("reconnaît les distributions courantes", () => {
    expect(distroIcon("Debian GNU/Linux 13 (trixie)")).toMatch(/icons\/debian\.svg$/);
    expect(distroIcon("Ubuntu 24.04.1 LTS")).toMatch(/icons\/ubuntu\.svg$/);
    expect(distroIcon("Raspbian GNU/Linux 12")).toMatch(/raspberrypi\.svg$/);
    expect(distroIcon("Microsoft Windows 11 Professionnel")).toMatch(/windows-11\.svg$/);
    expect(distroIcon("Microsoft Windows Server 2022 Standard")).toMatch(/windows-server\.svg$/);
    expect(distroIcon("Microsoft Windows 10 Pro")).toMatch(/windows-10\.svg$/);
    expect(distroIcon("Windows 7")).toMatch(/windows-7\.svg$/);
    expect(distroIcon("Microsoft Windows Vista Business")).toMatch(/windows-7\.svg$/);
    expect(distroIcon("Microsoft Windows 8.1 Pro")).toMatch(/windows-8\.svg$/);
    expect(distroIcon("Windows XP")).toMatch(/windows-classic\.svg$/);
    expect(distroIcon("Microsoft Windows Server 2008 R2 Standard")).toMatch(/windows-server-2008\.svg$/);
    expect(distroIcon("Microsoft Windows Server 2012 R2")).toMatch(/windows-server-2012\.svg$/);
    expect(distroIcon("Microsoft Windows Server 2019 Standard")).toMatch(/windows-server-2016\.svg$/);
    expect(distroIcon(undefined)).toBeNull();
  });
  it("chaque logo a son fichier", () => {
    for (const name of ["Ubuntu", "Debian", "Fedora", "Arch Linux", "CentOS", "Red Hat", "Alpine", "openSUSE", "FreeBSD", "Linux Mint", "Manjaro", "NixOS", "Gentoo", "Kali", "Android", "Raspbian", "TrueNAS", "Synology", "QNAP", "Unraid", "OpenWrt", "pfSense", "OPNsense", "Proxmox", "Windows 11", "Windows Server 2019", "Windows 10", "Windows XP", "Windows 7", "Windows 8.1", "Windows Server 2008", "Windows Server 2012", "Windows Server 2016"]) {
      const f = distroIcon(name)!;
      expect(existsSync(join(__dirname, "../../public/icons", f.split("/").pop()!)), name).toBe(true);
    }
  });
});
