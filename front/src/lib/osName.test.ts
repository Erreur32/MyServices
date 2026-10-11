import { describe, expect, it } from "vitest";
import { shortOs } from "./osName";

describe("nom de système abrégé", () => {
  it("Windows : sans Microsoft, édition abrégée", () => {
    expect(shortOs("Microsoft Windows 11 Professionnel")).toBe("Windows 11 Pro");
    expect(shortOs("Microsoft Windows 10 Pro")).toBe("Windows 10 Pro");
    expect(shortOs("Microsoft Windows 11 Famille")).toBe("Windows 11 Home");
    expect(shortOs("Microsoft Windows 11 Entreprise")).toBe("Windows 11 Enterprise");
    expect(shortOs("Microsoft Windows 11 Édition Familiale")).toBe("Windows 11 Home");
    expect(shortOs("Microsoft Windows Server 2022 Standard")).toBe("Windows Server 2022");
    expect(shortOs("Microsoft Windows 7")).toBe("Windows 7");
  });
  it("Linux : GNU/Linux retiré", () => {
    expect(shortOs("Debian GNU/Linux 13 (trixie)")).toBe("Debian 13 (trixie)");
    expect(shortOs("Raspbian GNU/Linux 12 (bookworm)")).toBe("Raspbian 12 (bookworm)");
    expect(shortOs("Red Hat Enterprise Linux 9.3 (Plow)")).toBe("RHEL 9.3 (Plow)");
    expect(shortOs("Fedora Linux 40 (Workstation Edition)")).toBe("Fedora 40");
    expect(shortOs("Ubuntu 24.04.1 LTS")).toBe("Ubuntu 24.04.1 LTS");
    expect(shortOs("Arch Linux")).toBe("Arch Linux");
  });
  it("vide ou absent", () => {
    expect(shortOs(undefined)).toBe("");
    expect(shortOs("")).toBe("");
  });
});
