// Connexion à la page (version Docker) : POST api/v1/login, puis retour à la page demandée (même site seulement).
// Tant qu'aucun compte n'existe (première installation), le même formulaire crée le compte admin :
// POST api/v1/setup, ouvert pendant les 30 minutes qui suivent le démarrage du conteneur.
(function () {
  var form = document.getElementById("login"), msg = document.getElementById("msg");
  var next = new URLSearchParams(location.search).get("next") || "";
  var setup = false;
  // Lien reçu par e-mail (login.html?reset=<jeton>) : le formulaire choisit un nouveau mot de passe
  var resetToken = new URLSearchParams(location.search).get("reset") || "";
  var reset = /^[A-Za-z0-9_-]{20,128}$/.test(resetToken);
  // Back only to a page of this site (never an external address); the old /myservices/ and /myservices/v2/ addresses lead to the root
  next = next.replace(/^\/myservices\/v2(?=\/|$)/, "").replace(/^\/myservices(?=\/|$)/, "") || "/";
  if (!/^\/[^\\]*$/.test(next) || next.indexOf("//") >= 0) next = "/";
  // Destination read again as an address: same site only (never another site nor javascript:)
  var dest = new URL(next, location.href);
  if (dest.origin !== location.origin) dest = new URL("/", location.origin);
  next = dest.pathname + dest.search + dest.hash;

  function $(id) { return document.getElementById(id); }
  // [HTTP status, JSON body] of an answer (an empty or non-JSON body gives {})
  function answer(r) {
    var status = r.status;
    return r.json().catch(function () { return {}; }).then(function (d) { return [status, d]; });
  }
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
    // Second field typed but different from the first: red frame, message and red rule (nothing red while it is still empty)
    var mismatch = again.length > 0 && !same;
    $("p").classList.toggle("ok", long);
    $("p2").classList.toggle("ok", same);
    $("p2").classList.toggle("bad", mismatch);
    $("p2-err").hidden = !mismatch;
    $("r-same").classList.toggle("bad", mismatch);
    if (setup || reset) {
      $("go").disabled = !(long && same);
      $("why-off").hidden = long && same;
    }
    return long && same;
  }

  // Eye buttons: show or hide the password typed in the field next to them
  document.querySelectorAll(".pw .eye").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = btn.parentNode.querySelector("input"), show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      var label = show ? "Masquer le mot de passe" : "Afficher le mot de passe";
      btn.setAttribute("aria-label", label);
      btn.title = label;
      input.focus();
    });
  });

  // Première installation : passe le formulaire en « création du compte admin »
  fetch("/api/v1/setup", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (s?.needed === false && !s.mail) $("forgot-sub").textContent = "L'envoi d'e-mails n'est pas encore réglé sur cette page : demande à un administrateur un nouveau mot de passe.";
      if (s?.mail === false) $("fgo").disabled = true;
      if (!s || !s.needed || reset) return;
      setup = true;
      $("links").hidden = true;
      $("sub").textContent = "Première installation : aucun compte n'existe encore.";
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

  // Mot de passe oublié : bascule vers le petit formulaire, et retour
  var forgot = $("forgot");
  $("forgot-link").addEventListener("click", function (e) {
    e.preventDefault();
    form.hidden = true;
    forgot.hidden = false;
    $("fi").value = form.username.value.trim();
    $("fi").focus();
  });
  $("back-link").addEventListener("click", function (e) {
    if (reset) return;   // from a reset link: the plain sign-in page
    e.preventDefault();
    forgot.hidden = true;
    form.hidden = false;
  });
  forgot.addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("fgo"), m = $("fmsg"), who = $("fi").value.trim();
    if (!who) return $("fi").focus();
    b.disabled = true;
    fetch("/api/v1/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: who }) })
      .then(answer)
      .then(function (x) {
        m.className = x[0] === 200 ? "" : "bad";
        m.textContent = x[0] === 200 ? "C'est envoyé : " + x[1].message + "." : (x[1].error || "Demande impossible (HTTP " + x[0] + ")");
        m.hidden = false;
      })
      .catch(function () { m.className = "bad"; m.textContent = "Serveur injoignable"; m.hidden = false; })
      .finally(function () { setTimeout(function () { b.disabled = false; }, 5000); });
  });

  // Lien reçu par e-mail : « choisir un nouveau mot de passe », mêmes règles qu'à la création du compte
  if (reset) {
    $("sub").textContent = "Choisis un nouveau mot de passe.";
    $("u").parentNode.querySelector("label[for=u]").hidden = true;
    $("u").hidden = true;
    $("u").required = false;
    $("p").autocomplete = "new-password";
    $("again").hidden = false;
    $("rulebox").hidden = false;
    $("forgot-link").textContent = "← Retour à la connexion";
    $("forgot-link").setAttribute("href", "login.html");
    $("forgot-link").replaceWith($("forgot-link").cloneNode(true));   // plain link, no forgot form
    $("go").textContent = "Enregistrer le mot de passe";
    $("go").disabled = true;
    ["p", "p2"].forEach(function (id) { $(id).addEventListener("input", rules); });
    rules();
    $("p").focus();
    fetch("/api/v1/password/reset?token=" + encodeURIComponent(resetToken), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (v?.valid) return;
        show("Ce lien a expiré ou a déjà servi. Demande un nouveau lien (« Mot de passe oublié ? » sur la page de connexion).");
        form.querySelectorAll("input, button[type=submit]").forEach(function (el) { el.disabled = true; });
      })
      .catch(function () {});
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("go");
    show("");
    if (reset) {
      if (!rules()) return;
      b.disabled = true;
      fetch("/api/v1/password/reset", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: form.password.value }) })
        .then(answer)
        .then(function (x) {
          if (x[0] === 200) {
            $("sub").textContent = "Mot de passe changé : connecte-toi avec le nouveau.";
            setTimeout(function () { location.replace("login.html"); }, 2500);
            return;
          }
          show(x[1].error || "Changement impossible (HTTP " + x[0] + ")");
          b.disabled = false;
        })
        .catch(function () { show("Serveur injoignable"); b.disabled = false; });
      return;
    }
    if (setup && !rules()) return;
    b.disabled = true;
    fetch(setup ? "/api/v1/setup" : "/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
    })
      .then(answer)
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
