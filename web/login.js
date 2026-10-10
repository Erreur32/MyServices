// Connexion à la page (version Docker) : POST api/v1/login, puis retour à la page demandée (même site seulement).
// Tant qu'aucun compte n'existe (première installation), le même formulaire crée le compte admin :
// POST api/v1/setup, ouvert pendant les 30 minutes qui suivent le démarrage du conteneur.
(function () {
  var form = document.getElementById("login"), msg = document.getElementById("msg");
  var next = new URLSearchParams(location.search).get("next") || "";
  var setup = false;
  // Retour seulement vers une page de ce site, sous /myservices/ (jamais une adresse externe)
  if (!/^\/myservices\/[^\\]*$/.test(next) || next.indexOf("//") >= 0) next = "./";

  function $(id) { return document.getElementById(id); }
  function show(t) {
    msg.textContent = t;
    msg.hidden = !t;
  }

  // Première installation : passe le formulaire en « création du compte admin »
  fetch("api/v1/setup", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (!s || !s.needed) return;
      setup = true;
      $("sub").textContent = "Première installation : aucun compte n'existe encore.";
      $("hint").hidden = true;
      var box = $("setup");
      box.hidden = false;
      if (!s.seconds_left) {
        box.textContent = "La création du premier compte n'est ouverte que " + s.window_min +
          " minutes après le démarrage. Redémarre le conteneur MyServices, puis recharge cette page.";
        box.className = "setup late";
        form.querySelectorAll("input, button").forEach(function (el) { el.disabled = true; });
        return;
      }
      box.textContent = "Choisis le nom et le mot de passe du compte administrateur (12 caractères minimum). " +
        "Encore " + Math.ceil(s.seconds_left / 60) + " min pour le faire ; ensuite, cet écran disparaît.";
      $("again").hidden = false;
      $("p").autocomplete = "new-password";
      $("go").textContent = "Créer le compte admin";
    })
    .catch(function () {});

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("go");
    show("");
    if (setup && form.password.value !== form.password2.value) {
      show("Les deux mots de passe sont différents.");
      return;
    }
    b.disabled = true;
    fetch(setup ? "api/v1/setup" : "api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return [r.status, d]; });
      })
      .then(function (x) {
        if (x[0] === 200) return location.replace(next);
        if (x[0] === 409) return location.reload();  // compte créé entre-temps (autre onglet) : connexion
        show(x[1].error || "Connexion impossible (HTTP " + x[0] + ")");
        form.password.value = "";
        if (setup) form.password2.value = "";
        form.password.focus();
      })
      .catch(function () { show("Serveur injoignable"); })
      .finally(function () { b.disabled = false; });
  });
})();
