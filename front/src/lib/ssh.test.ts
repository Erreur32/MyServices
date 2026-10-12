import { describe, expect, it } from "vitest";
import { authorizeFor } from "./ssh";

const CMD = "echo 'ssh-ed25519 AAAAkey myservices' >> ~/.ssh/authorized_keys";

describe("autoriser la clé", () => {
  it("un compte : son dossier, .ssh créé, clé une fois, propriétaire et droits remis (lancée en root)", () => {
    expect(authorizeFor(CMD, "erreur32")).toBe(
      "mkdir -p /home/erreur32/.ssh && touch /home/erreur32/.ssh/authorized_keys"
      + " && (grep -qxF 'ssh-ed25519 AAAAkey myservices' /home/erreur32/.ssh/authorized_keys || echo 'ssh-ed25519 AAAAkey myservices' >> /home/erreur32/.ssh/authorized_keys)"
      + " && chown -R erreur32: /home/erreur32/.ssh && chmod 700 /home/erreur32/.ssh && chmod 600 /home/erreur32/.ssh/authorized_keys");
  });
  it("root, ou compte vide : /root, sans chown", () => {
    for (const u of ["root", "", " "]) {
      const c = authorizeFor(CMD, u);
      expect(c).toContain("/root/.ssh/authorized_keys");
      expect(c).not.toContain("chown");
    }
  });
  it("commande sans clé : rendue telle quelle", () => {
    expect(authorizeFor("rien", "x")).toBe("rien");
  });
});
