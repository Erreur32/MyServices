// Bouton « Rafraîchir » de MyServices (index.html, docker.html).
// Demande un passage du collecteur à refresh-api.py (nginx /myservices/api/, LAN seulement),
// affiche l'étape en cours puis émet « myservices:refreshed » pour que la page relise data.json.
// Garde-fous côté serveur : un passage à la fois, 5 min mini entre deux passages (bouton ou timer),
// limit_req nginx. Ici on se contente de les afficher (bouton grisé + compte à rebours).
(function () {
  var API = "api/";  // relatif à la page : suit l'emplacement choisi dans nginx
  // Poids de chaque étape dans la barre (les sondes, étape 5, prennent l'essentiel du temps)
  var W = [4, 4, 12, 4, 56, 14, 6];
  var st = null,
    waitUntil = 0,
    timer = null,
    wasRunning = false,
    doneMsg = 0,
    err = null;

  var css = document.createElement("style");
  css.textContent =
    ".msr{position:relative;display:inline-flex;align-items:center;gap:7px;overflow:hidden;font:600 12.5px/1 ui-sans-serif,system-ui,sans-serif;" +
    "color:#e6e9f2;background:#161a26;border:1px solid #2b3246;border-radius:999px;padding:5px 12px 5px 10px;cursor:pointer;white-space:nowrap}" +
    ".msr:hover:not(:disabled){border-color:#2496ed;background:#1a2133}" +
    ".msr:disabled{cursor:default;color:#9aa3b8}" +
    ".msr .bar{position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,#2496ed,#4cd07f);transition:width .6s ease}" +
    ".msr .ic{display:inline-block;width:1em;line-height:1;text-align:center;font-size:13px}" +
    ".msr.run{color:#e6e9f2;border-color:rgba(36,150,237,.55);background:rgba(36,150,237,.1)}" +
    ".msr.run .ic{animation:msr-spin 1s linear infinite}" +
    ".msr.ok{color:#4cd07f;border-color:rgba(76,208,127,.5)}" +
    ".msr.err{color:#f06a6a;border-color:rgba(240,106,106,.5)}" +
    ".msr small{color:#6b7488;font-weight:500}" +
    "@keyframes msr-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(css);

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msr";
  btn.innerHTML =
    '<span class="ic">⟳</span><span class="tx">Rafraîchir</span><span class="bar"></span>';
  // index.html : à droite du badge « sondé il y a » ; docker.html : sous le kicker de l'en-tête
  var anchor = document.getElementById("live");
  if (anchor) anchor.insertAdjacentElement("afterend", btn);
  else {
    var k = document.querySelector("header .kicker");
    if (!k) return;
    var row = document.createElement("div");
    row.style.margin = "10px 0 0";
    row.appendChild(btn);
    k.insertAdjacentElement("afterend", row);
  }

  // Version Docker : session (cookie ms_csrf lisible, jeton de session HttpOnly) ; écritures signées
  // par l'en-tête X-CSRF-Token, bouton de déconnexion. Installation classique : rien de tout ça.
  function csrf() {
    var m = /(?:^|; )ms_csrf=([^;]+)/.exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : "";
  }
  if (csrf()) {
    var out = document.createElement("button");
    out.type = "button";
    out.className = "msr";
    out.title = "Se déconnecter";
    out.innerHTML = '<span class="ic">⏻</span><span class="tx">Déconnexion</span>';
    out.addEventListener("click", function () {
      fetch(API + "v1/logout", { method: "POST", headers: { "X-CSRF-Token": csrf() } }).finally(function () {
        location.href = "login.html";
      });
    });
    btn.insertAdjacentElement("afterend", out);
    out.style.marginLeft = "6px";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function mmss(s) {
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }
  function pct(p) {
    if (!p) return 2;
    var before = W.slice(0, p.step - 1).reduce(function (a, b) {
      return a + b;
    }, 0);
    var frac = p.total ? p.done / p.total : 0.5;
    return Math.min(99, before + W[p.step - 1] * frac);
  }

  function paint() {
    var tx = btn.querySelector(".tx"),
      ic = btn.querySelector(".ic"),
      bar = btn.querySelector(".bar");
    var now = Date.now(),
      wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));
    btn.classList.remove("run", "ok", "err");
    bar.style.width = "0";
    if (st && st.running) {
      var p = st.progress,
        el = st.started ? Math.max(0, Math.round(now / 1000 - st.started)) : 0;
      btn.disabled = true;
      btn.classList.add("run");
      ic.textContent = "⟳";
      bar.style.width = pct(p) + "%";
      tx.innerHTML = p
        ? "Étape " +
          +p.step +
          "/" +
          +p.steps +
          " · " +
          esc(p.label) +
          (p.total ? " <b>" + (+p.done) + "/" + (+p.total) + "</b>" : "") +
          " <small>" +
          el +
          " s</small>"
        : "Démarrage… <small>" + el + " s</small>";
      btn.title =
        "Passage du collecteur en cours (lancé par le bouton ou par le timer de 30 min)";
    } else if (err) {
      btn.disabled = wait > 0;
      btn.classList.add("err");
      ic.textContent = "⚠";
      tx.textContent = err + (wait ? " · " + mmss(wait) : "");
      btn.title = err;
    } else if (now < doneMsg) {
      btn.disabled = true;
      btn.classList.add("ok");
      ic.textContent = "✓";
      bar.style.width = "100%";
      tx.innerHTML =
        "À jour" +
        (st && st.started && st.ended
          ? " <small>" + (st.ended - st.started) + " s</small>"
          : "");
    } else if (wait > 0) {
      btn.disabled = true;
      ic.textContent = "⏳";
      tx.innerHTML = "Rafraîchir <small>dans " + mmss(wait) + "</small>";
      btn.title =
        "Délai minimal de " +
        Math.round((st ? st.cooldown : 300) / 60) +
        " min entre deux passages (bouton ou timer)";
    } else {
      btn.disabled = false;
      ic.textContent = "⟳";
      tx.textContent = "Rafraîchir";
      btn.title =
        "Relancer la collecte maintenant (NPM, Docker, sondes) · environ 1 min";
    }
  }

  function apply(d) {
    var running = !!d.running;
    st = d;
    waitUntil = Date.now() + (d.wait || 0) * 1000;
    if (wasRunning && !running) {
      if (d.result && d.result !== "success")
        err = "Échec du passage (" + d.result + ")";
      else {
        err = null;
        doneMsg = Date.now() + 5000;
      }
      window.dispatchEvent(
        new CustomEvent("myservices:refreshed", { detail: d }),
      );
    }
    wasRunning = running;
    paint();
    schedule(running ? 1000 : 30000);
  }

  function poll() {
    fetch(API + "status", { cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) location.href = "login.html?next=" + encodeURIComponent(location.pathname);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(apply)
      .catch(function () {
        // API absente (page ouverte hors LAN, service arrêté) : bouton masqué plutôt que cassé
        btn.style.display = "none";
        schedule(60000);
      });
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!document.hidden || (st && st.running)) poll();
      else schedule(ms);
    }, ms);
  }

  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    err = null;
    btn.disabled = true;
    st = {
      running: true,
      progress: null,
      started: Math.round(Date.now() / 1000),
    };
    paint();
    fetch(API + "refresh", { method: "POST", cache: "no-store", headers: { "X-CSRF-Token": csrf() } })
      .then(function (r) {
        return r
          .json()
          .catch(function () {
            return {};
          })
          .then(function (d) {
            if (r.status === 202 || r.status === 409) {
              apply(d);
              return;
            }
            st = d && "running" in d ? d : null;
            err =
              r.status === 429
                ? d.wait
                  ? "Trop tôt"
                  : "Trop de demandes, patiente"
                : d.error || "Erreur HTTP " + r.status;
            waitUntil =
              Date.now() + (d.wait || (r.status === 429 ? 10 : 0)) * 1000;
            paint();
            schedule(5000);
          });
      })
      .catch(function (e) {
        err = "API injoignable";
        st = null;
        paint();
        schedule(10000);
      });
  });

  // Compte à rebours fluide sans interroger le serveur
  setInterval(function () {
    if (!(st && st.running)) paint();
  }, 1000);
  poll();
})();
