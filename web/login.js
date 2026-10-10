// Connexion à la page (version Docker) : POST api/v1/login, puis retour à la page demandée (même site seulement).
// Tant qu'aucun compte n'existe (première installation), le même formulaire crée le compte admin :
// POST api/v1/setup, ouvert pendant les 30 minutes qui suivent le démarrage du conteneur.
(function () {
  var form = document.getElementById("login"), msg = document.getElementById("msg");
  var next = new URLSearchParams(location.search).get("next") || "";
  var setup = false;
  // Retour seulement vers une page de ce site, sous /myservices/ (jamais une adresse externe)
  if (!/^\/myservices\/[^\\]*$/.test(next) || next.indexOf("//") >= 0) next = "v2/";  // page par défaut : le nouveau front (/myservices/v2/)

  function $(id) { return document.getElementById(id); }
  function show(t) {
    msg.textContent = t;
    msg.hidden = !t;
  }

  // Règles du mot de passe en direct (création du compte) : seule la longueur est exigée par le serveur
  var MIN = 12;
  function rules() {
    var pw = $("p").value, again = $("p2").value;
    var long = pw.length >= MIN, same = pw.length > 0 && pw === again;
    var words = pw.trim().split(/[\s\-_.]+/).filter(function (w) { return w.length > 1; }).length >= 3;
    var set = function (id, ok) { $(id).className = ($(id).className.replace(/\bok\b/, "").trim() + (ok ? " ok" : "")).trim(); };
    set("r-long", long); set("r-same", same); set("r-words", words);
    $("r-count").textContent = "(" + pw.length + "/" + MIN + ")";
    $("p").classList.toggle("ok", long);
    $("p2").classList.toggle("ok", same);
    if (setup) $("go").disabled = !(long && same);
    return long && same;
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
      form.classList.add("setup-mode");
      var left = s.seconds_left;
      box.innerHTML = "<p><b>Crée le compte administrateur.</b></p>" +
        '<p class="why">Cet écran n\'est ouvert que ' + s.window_min + " minutes après le démarrage du conteneur, pour qu'un autre " +
        'appareil du réseau ne puisse pas créer ce compte à ta place. Temps restant : <b id="left"></b>. ' +
        "Passé ce délai : <code>docker restart myservices</code>, puis recharge la page.</p>";
      var tick = function () {
        $("left").textContent = left >= 60 ? Math.ceil(left / 60) + " min" : Math.max(left, 0) + " s";
        if (left-- <= 0) location.reload();
      };
      tick();
      setInterval(tick, 1000);
      $("again").hidden = false;
      $("rulebox").hidden = false;
      $("p").autocomplete = "new-password";
      $("go").textContent = "Créer le compte admin";
      $("go").disabled = true;
      ["p", "p2"].forEach(function (id) { $(id).addEventListener("input", rules); });
      rules();
    })
    .catch(function () {});

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("go");
    show("");
    if (setup && !rules()) return;
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
      .finally(function () { b.disabled = setup ? !rules() : false; });
  });
})();
