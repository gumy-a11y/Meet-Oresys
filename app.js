/* Meet'Oresys : carte des salles de séminaire, avis des consultants et note Google (Supabase). */
(function () {
  "use strict";
  const CFG = window.CONFIG;
  const ORIGIN = CFG.ORIGIN;

  const TYPES = { flex: { l: "Espace de travail premium", c: "--t-flex" }, atypique: { l: "Lieu atypique", c: "--t-atyp" }, affaires: { l: "Centre d'affaires", c: "--t-aff" }, hotel: { l: "Hôtel", c: "--t-hotel" } };
  const FMTS = { journee: "Journée d'étude", soiree: "Soirée / cocktail" };
  const STAT = { avisiter: "À visiter", visite: "Visité", retenu: "Retenu", ecarte: "Écarté" };
  const STAT_FILTER = Object.assign({ aucun: "Sans statut" }, STAT);
  const MODES = ["à pied", "métro", "RER", "train", "métro + RER", "train + bus", "voiture"];
  const TMAX = 60;

  const $ = (s) => document.querySelector(s);
  const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const frDate = (d) => new Date(d).toLocaleDateString("fr-FR");

  const state = { pmin: 0, tmax: TMAX, types: new Set(Object.keys(TYPES)), fmts: new Set(Object.keys(FMTS)), stats: new Set(Object.keys(STAT_FILTER)), sel: null, mode: "list", authTab: "login" };
  const live = { lieux: [], avis: [], photos: [], statuts: {}, urls: {}, loaded: false, err: "" };
  let V = [];
  let draft = 0;

  /* ---------- Supabase ---------- */
  const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("VOTRE-PROJET") && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("VOTRE-CLE");
  const sb = configured && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  let session = null;
  let member = false;
  let channel = null;
  const me = () => session?.user?.id || null;
  const DOMAIN = (CFG.ALLOWED_DOMAIN || "oresys.eu").toLowerCase();
  const isOresysEmail = (e) => (e || "").toLowerCase().endsWith("@" + DOMAIN);
  function displayName() {
    const n = session?.user?.user_metadata?.display_name;
    if (n) return n;
    const local = (session?.user?.email || "").split("@")[0];
    return local.split(/[._]/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || "Anonyme";
  }

  /* ---------- Utilitaires ---------- */
  function rowToVenue(r) {
    return { id: r.id, no: r.num, n: r.nom, t: r.type, f: r.formats || [], a: r.adresse, lat: r.lat, lng: r.lng, cap: r.capacite, capA: r.capacite_assis, capD: r.capacite_debout, px: r.tarif, d: r.description, tm: r.temps, mode: r.mode, r: r.trajet, link: r.lien, linkL: r.lien_libelle, by: r.created_by, gNote: r.google_note == null ? null : +r.google_note, gNb: r.google_nb, gMaj: r.google_maj, gUrl: r.google_url };
  }
  function dirUrl(v) {
    return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(ORIGIN.addr) + "&destination=" + encodeURIComponent(v.a) + "&travelmode=" + (v.mode === "à pied" ? "walking" : v.mode === "voiture" ? "driving" : "transit");
  }
  function kmFrom(lat, lng) {
    const R = 6371, rad = Math.PI / 180;
    const dl = (lat - ORIGIN.lat) * rad, dn = (lng - ORIGIN.lng) * rad;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(ORIGIN.lat * rad) * Math.cos(lat * rad) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function place(v) {
    const m = (v.a || "").match(/750(\d\d)/);
    if (m) return +m[1] + (m[1] === "01" ? "er" : "e");
    const c = (v.a || "").match(/\d{5} ([^(,]+)/);
    return c ? c[1].trim() : "";
  }
  function googleUrl(v) {
    return /^https:\/\/(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//i.test(v.gUrl || "") ? v.gUrl : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(v.n + ", " + v.a);
  }
  const nbFmt = (n) => Number(n).toLocaleString("fr-FR");
  function avg(id) {
    const r = live.avis.filter((a) => a.venue === id && a.note);
    if (!r.length) return null;
    return { m: r.reduce((s, a) => s + a.note, 0) / r.length, n: r.length };
  }
  const starStr = (m) => { const f = Math.round(m); return "★".repeat(f) + "☆".repeat(5 - f); };
  const statOf = (id) => live.statuts[id]?.statut || "";
  // Capacité utilisée par le filtre : assise, ou debout si seules les soirées sont filtrées.
  function capFor(v) {
    const soireeOnly = state.fmts.size === 1 && state.fmts.has("soiree");
    const a = v.capA || 0, d = v.capD || 0;
    return soireeOnly ? Math.max(a, d) : (a || d);
  }
  function capOk(v) {
    if (!state.pmin) return true;
    const c = capFor(v);
    return c === 0 ? false : c >= state.pmin;
  }
  function capLabel(v) {
    const p = [];
    if (v.capA) p.push(`${v.capA} assis`);
    if (v.capD && v.capD !== v.capA) p.push(`${v.capD} debout`);
    return p.length ? "jusqu'à " + p.join(" / ") : "";
  }
  function visible(v) {
    return capOk(v) && (state.tmax >= TMAX || v.tm <= state.tmax) && state.types.has(v.t) && v.f.some((f) => state.fmts.has(f)) && (!member || state.stats.has(statOf(v.id) || "aucun"));
  }
  function scoreLine(v) {
    const o = member ? avg(v.id) : null;
    const parts = [];
    if (o) parts.push(`<span class="stars">★</span> ${o.m.toFixed(1).replace(".", ",")} Oresys (${o.n})`);
    if (v.gNote) parts.push(`<span class="gstar">★</span> ${v.gNote.toFixed(1).replace(".", ",")} Google${v.gNb ? ` (${nbFmt(v.gNb)})` : ""}`);
    return parts.length ? `<div class="meta">${parts.join(" · ")}</div>` : "";
  }

  /* ---------- Filtres ---------- */
  function chips(el, obj, set, colorOf) {
    el.innerHTML = "";
    for (const [k, lab] of Object.entries(obj)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", set.has(k));
      b.innerHTML = (colorOf ? `<span class="sw" style="background:var(${colorOf(k)})"></span>` : "") + esc(typeof lab === "string" ? lab : lab.l);
      b.onclick = () => { if (set.has(k)) { if (set.size > 1) set.delete(k); } else set.add(k); chips(el, obj, set, colorOf); renderAll(); };
      el.appendChild(b);
    }
  }
  chips($("#ftype"), TYPES, state.types, (k) => TYPES[k].c);
  chips($("#ffmt"), FMTS, state.fmts);
  chips($("#fstat"), STAT_FILTER, state.stats);
  $("#pmin").oninput = (e) => { state.pmin = +e.target.value; $("#pout").textContent = state.pmin ? state.pmin + " pers. et +" : "Tous"; renderAll(); };
  $("#tmax").oninput = (e) => { state.tmax = +e.target.value; $("#tout").textContent = state.tmax >= TMAX ? "1 h et +" : state.tmax + " min"; renderAll(); };

  /* ---------- Carte ---------- */
  const map = L.map("map", { zoomSnap: 0.25 }).setView([ORIGIN.lat, ORIGIN.lng], 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  L.marker([ORIGIN.lat, ORIGIN.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: "", html: '<div class="opin"><b>OR</b></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) })
    .addTo(map).bindTooltip("Oresys · " + ORIGIN.addr, { direction: "top", offset: [0, -14] });

  let markers = {};
  let link = null;
  let draftMarker = null;
  let fitted = false;
  function pinIcon(v, sel, dim) {
    return L.divIcon({ className: "", html: `<div class="pin${sel ? " sel" : ""}${dim ? " dim" : ""}" style="background:var(${TYPES[v.t]?.c || "--muted"})"><b>${v.no}</b></div>`, iconSize: [26, 26], iconAnchor: [13, 30] });
  }
  function syncMarkers() {
    const ids = new Set(V.map((v) => v.id));
    for (const id of Object.keys(markers)) if (!ids.has(id)) { markers[id].remove(); delete markers[id]; }
    V.forEach((v) => {
      let m = markers[v.id];
      if (!m) {
        m = L.marker([v.lat, v.lng], { riseOnHover: true }).addTo(map);
        m.on("click", () => { if (state.mode !== "form") openVenue(v.id); });
        markers[v.id] = m;
      }
      m.setLatLng([v.lat, v.lng]);
      m.setIcon(pinIcon(v, state.sel === v.id, !visible(v)));
      m.unbindTooltip().bindTooltip(`${v.n} · ${v.tm} min`, { direction: "top", offset: [0, -26] });
    });
    if (!fitted && V.length) {
      map.fitBounds(L.latLngBounds(V.map((v) => [v.lat, v.lng])).extend([ORIGIN.lat, ORIGIN.lng]), { padding: [24, 24] });
      fitted = true;
    }
  }
  map.on("click", (e) => {
    if (state.mode !== "form") return;
    setDraftPoint(e.latlng.lat, e.latlng.lng, true);
  });

  /* ---------- Compte ---------- */
  function renderAccount() {
    const box = $("#account");
    $("#addbtn").hidden = !member;
    if (!sb) {
      box.innerHTML = `<p class="msg err">Site non configuré : renseignez l'adresse et la clé Supabase dans config.js.</p>`;
      return;
    }
    if (!session) {
      const login = state.authTab === "login";
      box.innerHTML = `<div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${login}" data-tab="login">Se connecter</button>
          <button type="button" role="tab" aria-selected="${!login}" data-tab="signup">Créer un compte</button>
        </div>
        <form id="auth" class="login">
          ${login ? "" : `<input id="aname" type="text" required maxlength="60" autocomplete="name" placeholder="Prénom Nom" aria-label="Prénom et nom">`}
          <input id="aemail" type="email" required autocomplete="email" placeholder="prenom.nom@${esc(DOMAIN)}" aria-label="Adresse e-mail Oresys">
          <input id="apass" type="password" required minlength="8" autocomplete="${login ? "current-password" : "new-password"}" placeholder="Mot de passe${login ? "" : " (8 caractères minimum)"}" aria-label="Mot de passe">
          <button class="btn primary" type="submit">${login ? "Se connecter" : "Créer mon compte"}</button>
          <div class="msg" id="authmsg">${login ? "" : `Réservé aux adresses @${esc(DOMAIN)}. Le compte est actif immédiatement.`}</div>
        </form>`;
      box.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.authTab = b.dataset.tab; renderAccount(); }));
      $("#auth").onsubmit = login ? doLogin : doSignup;
      return;
    }
    if (!member) {
      box.innerHTML = `<p class="msg err">${esc(session.user.email)} n'est pas une adresse @${esc(DOMAIN)}.</p><button class="linkbtn" type="button" id="logout">Se déconnecter</button>`;
      $("#logout").onclick = () => sb.auth.signOut();
      return;
    }
    box.innerHTML = `<div class="frow"><span class="msg">Connecté : <b>${esc(displayName())}</b></span><button class="linkbtn" type="button" id="logout">Se déconnecter</button></div>`;
    $("#logout").onclick = () => sb.auth.signOut();
  }
  async function doLogin(e) {
    e.preventDefault();
    const m = $("#authmsg");
    m.className = "msg"; m.textContent = "Connexion…";
    const { error } = await sb.auth.signInWithPassword({ email: $("#aemail").value.trim(), password: $("#apass").value });
    if (error) { m.className = "msg err"; m.textContent = /invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : "Connexion impossible : " + error.message; }
  }
  async function doSignup(e) {
    e.preventDefault();
    const m = $("#authmsg");
    const email = $("#aemail").value.trim();
    if (!isOresysEmail(email)) { m.className = "msg err"; m.textContent = `Utilisez votre adresse @${DOMAIN}.`; return; }
    m.className = "msg"; m.textContent = "Création du compte…";
    const { data, error } = await sb.auth.signUp({ email, password: $("#apass").value, options: { data: { display_name: $("#aname").value.trim() } } });
    if (error) {
      m.className = "msg err";
      m.textContent = /registered|exists/i.test(error.message) ? "Un compte existe déjà avec cette adresse. Utilisez « Se connecter »."
        : /database error/i.test(error.message) ? `Inscription refusée : réservée aux adresses @${DOMAIN}.`
        : "Création impossible : " + error.message;
      return;
    }
    if (!data.session) {
      m.className = "msg err";
      m.textContent = "Compte créé, mais Supabase demande encore une confirmation par e-mail. L'administrateur doit décocher « Confirm email » (voir le README).";
    }
  }
  function refreshMember() {
    member = !!session && isOresysEmail(session.user?.email);
  }

  /* ---------- Données ---------- */
  async function loadAll() {
    if (!sb) { renderAll(); return; }
    live.err = "";
    try {
      if (!member) clearTeam();
      await Promise.all([loadLieux(), member ? loadAvis() : null, member ? loadStatuts() : null, member ? loadPhotos() : null]);
      live.loaded = true;
    } catch (err) {
      live.err = "Chargement impossible. Vérifiez la connexion ou la configuration Supabase.";
      console.error(err);
    }
    renderAll();
    subscribe();
  }
  function clearTeam() { live.avis = []; live.statuts = {}; live.photos = []; live.urls = {}; }
  async function loadLieux() {
    const { data, error } = await sb.from("lieux").select("*").order("num", { ascending: true });
    if (error) throw error;
    live.lieux = data;
    V = data.map(rowToVenue);
  }
  async function loadAvis() {
    const { data, error } = await sb.from("avis").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    live.avis = data;
  }
  async function loadStatuts() {
    const { data, error } = await sb.from("statuts").select("*");
    if (error) throw error;
    live.statuts = Object.fromEntries(data.map((s) => [s.venue, s]));
  }
  async function loadPhotos() {
    const { data, error } = await sb.from("photos").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    live.photos = data;
    const missing = data.map((p) => p.path).filter((p) => !live.urls[p]);
    if (missing.length) {
      const { data: signed, error: e2 } = await sb.storage.from("photos").createSignedUrls(missing, 60 * 60 * 6);
      if (e2) throw e2;
      signed.forEach((s) => { if (s.signedUrl) live.urls[s.path] = s.signedUrl; });
    }
  }
  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    const reload = (fn) => () => fn().then(renderAll).catch(console.error);
    channel = sb.channel("meet-oresys")
      .on("postgres_changes", { event: "*", schema: "public", table: "lieux" }, reload(loadLieux));
    if (member) {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "avis" }, reload(loadAvis))
        .on("postgres_changes", { event: "*", schema: "public", table: "statuts" }, reload(loadStatuts))
        .on("postgres_changes", { event: "*", schema: "public", table: "photos" }, reload(loadPhotos));
    }
    channel.subscribe();
  }

  /* ---------- Rendu ---------- */
  function renderAll() {
    $("#statfilter").hidden = !member;
    syncMarkers();
    if (state.mode === "form") return;
    if (state.mode === "detail" && state.sel) renderDetail(); else renderList();
  }
  function showPanel(which) {
    $("#list").hidden = which !== "list";
    $("#detail").hidden = which === "list";
    $("#filters").hidden = which !== "list";
  }

  function renderList() {
    showPanel("list");
    const ul = $("#list");
    ul.innerHTML = "";
    const vis = V.filter(visible).sort((a, b) => a.tm - b.tm);
    $("#count").textContent = sb ? `${vis.length} lieu${vis.length > 1 ? "x" : ""} sur ${V.length} · temps estimés porte à porte` : "";
    if (!sb) return;
    if (!live.loaded && !live.err) { ul.innerHTML = '<li class="empty">Chargement des lieux…</li>'; return; }
    if (live.err) { ul.innerHTML = `<li class="empty err">${esc(live.err)}</li>`; return; }
    if (!vis.length) { ul.innerHTML = '<li class="empty">Aucun lieu ne correspond. Baissez le nombre de participants ou élargissez les filtres.</li>'; return; }
    for (const v of vis) {
      const li = document.createElement("li");
      const st = member ? statOf(v.id) : "";
      li.innerHTML = `<button class="row" type="button"><span class="num" style="background:var(${TYPES[v.t].c})">${v.no}</span><span><div class="nm">${esc(v.n)}</div><div class="meta">${esc(TYPES[v.t].l)} · ${esc(place(v))}${st ? ` · <b class="st-${st}">${esc(STAT[st])}</b>` : ""}</div>${capLabel(v) ? `<div class="meta capbadge">${esc(capLabel(v))}</div>` : ""}${scoreLine(v)}</span><span class="time">${v.tm} min<small>${esc(v.mode)}</small></span></button>`;
      const btn = li.firstChild;
      btn.onclick = () => openVenue(v.id);
      btn.onmouseenter = () => markers[v.id]?.openTooltip();
      btn.onmouseleave = () => markers[v.id]?.closeTooltip();
      ul.appendChild(li);
    }
  }

  function openVenue(id) {
    const v = V.find((x) => x.id === id);
    if (!v) return;
    state.sel = id;
    state.mode = "detail";
    draft = 0;
    if (link) link.remove();
    link = L.polyline([[ORIGIN.lat, ORIGIN.lng], [v.lat, v.lng]], { color: tok("--oresys"), weight: 3, dashArray: "6 6", interactive: false }).addTo(map);
    map.flyToBounds(L.latLngBounds([[ORIGIN.lat, ORIGIN.lng], [v.lat, v.lng]]), { padding: [70, 70], maxZoom: 16, duration: 0.6 });
    syncMarkers();
    renderDetail();
    $("#scroll").scrollTop = 0;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  }
  function backToList() {
    state.sel = null;
    state.mode = "list";
    if (link) { link.remove(); link = null; }
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    history.replaceState(null, "", location.pathname);
    renderAll();
  }

  function reviewForm() {
    return `<form class="rf" id="rf">
      <div class="lbl">Votre avis</div>
      <div class="rate" role="radiogroup" aria-label="Note sur 5">${[1, 2, 3, 4, 5].map((i) => `<button type="button" role="radio" aria-checked="${draft === i}" aria-label="${i} sur 5" data-n="${i}" class="${draft >= i ? "on" : ""}">★</button>`).join("")}</div>
      <textarea id="rtxt" maxlength="2000" placeholder="Accueil, acoustique, lumière, traiteur, accès PMR, budget, négociation…" aria-label="Commentaire"></textarea>
      <div class="frow"><label class="msg" for="rdate">Date de visite ou d'événement</label><input type="date" id="rdate" style="width:auto"><button class="btn primary" type="submit">Publier</button></div>
      <div class="msg" id="rmsg"></div>
    </form>`;
  }
  function reviewList(list) {
    if (!list.length) return `<li class="msg">Aucun avis pour l'instant. Si vous connaissez ce lieu, notez-le ci-dessous.</li>`;
    return list.map((a) => `<li class="rv"><div class="who"><b>${esc(a.author_name || "Un consultant")}</b>${a.note ? `<span class="stars">${starStr(a.note)}</span>` : ""}${a.visite ? `<span>· le ${frDate(a.visite)}</span>` : ""}<span>· publié le ${frDate(a.created_at)}</span>${a.author_id === me() ? `<button class="del" type="button" data-del-avis="${esc(a.id)}">Supprimer</button>` : ""}</div>${a.texte ? `<p>${esc(a.texte)}</p>` : ""}</li>`).join("");
  }
  function googleBlock(v) {
    const g = googleUrl(v);
    const has = v.gNote != null;
    return `<div class="gbox" id="gbox">
      <div class="lbl">Note Google</div>
      ${has ? `<div class="gscore"><b>${v.gNote.toFixed(1).replace(".", ",")}</b><span class="gstar">${starStr(v.gNote)}</span><span class="msg">${v.gNb ? nbFmt(v.gNb) + " avis" : ""}${v.gMaj ? ` · relevée le ${frDate(v.gMaj)}` : ""}</span></div>` : `<p class="msg">Pas encore renseignée.</p>`}
      <div class="frow"><a class="btn" href="${esc(g)}" target="_blank" rel="noopener">Voir sur Google Maps ↗</a>${member ? `<button class="linkbtn" type="button" id="gedit">${has ? "Mettre à jour" : "Renseigner la note"}</button>` : ""}</div>
      <form id="gform" class="gform" hidden>
        <div class="grid3">
          <label>Note<input id="g-note" type="text" inputmode="decimal" maxlength="3" value="${has ? v.gNote : ""}" placeholder="4,5"></label>
          <label>Nombre d'avis<input id="g-nb" type="number" min="0" step="1" value="${v.gNb ?? ""}" placeholder="1200"></label>
        </div>
        <label>Lien de la fiche Google (facultatif)<input id="g-url" type="url" value="${esc(v.gUrl || "")}" placeholder="https://maps.app.goo.gl/…"></label>
        <div class="frow"><button class="btn primary" type="submit">Enregistrer</button><button class="linkbtn" type="button" id="gcancel">Annuler</button><span class="msg" id="gmsg"></span></div>
      </form>
    </div>`;
  }

  function renderDetail() {
    const v = V.find((x) => x.id === state.sel);
    if (!v) { backToList(); return; }
    showPanel("detail");
    const box = $("#detail");
    const keep = {};
    box.querySelectorAll("textarea,input").forEach((el) => { if (el.id && el.type !== "file") keep[el.id] = el.value; });
    const gOpen = $("#gform") && !$("#gform").hidden;
    const focusId = document.activeElement?.id;

    const ao = avg(v.id);
    const avis = live.avis.filter((x) => x.venue === v.id);
    const photos = live.photos.filter((x) => x.venue === v.id);
    const st = statOf(v.id);
    const lk = safeUrl(v.link);

    const teamBlock = !sb ? "" : !member ? `<section class="team"><h3>Avis Oresys</h3><p class="msg">Connectez-vous avec votre adresse @${esc(DOMAIN)} (en haut de la liste) pour lire et donner les avis des consultants.</p></section>` : `
      <section class="team">
        <h3>Avis Oresys ${ao ? `<span class="msg"><span class="stars">${starStr(ao.m)}</span> ${ao.m.toFixed(1).replace(".", ",")} · ${ao.n} avis</span>` : ""}</h3>
        <ul class="reviews">${reviewList(avis)}</ul>
        ${reviewForm()}
        <div class="lbl" style="margin-top:14px">Statut ${live.statuts[v.id]?.updated_at ? `<span class="msg">· mis à jour le ${frDate(live.statuts[v.id].updated_at)}</span>` : ""}</div>
        <div class="status">${Object.entries(STAT).map(([k, l]) => `<button type="button" class="chip st" data-v="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>
        <div class="lbl" style="margin-top:14px">Photos ${photos.length ? `<span class="msg">· ${photos.length}</span>` : ""}</div>
        <div class="photos">${photos.map((p) => `<figure class="ph">${live.urls[p.path] ? `<img src="${esc(live.urls[p.path])}" alt="${esc(p.legende || v.n)}" loading="lazy">` : `<div class="msg" style="padding:10px">Photo indisponible</div>`}${p.legende ? `<figcaption>${esc(p.legende)}</figcaption>` : ""}${p.author_id === me() ? `<button class="x" type="button" data-del-photo="${esc(p.id)}" aria-label="Supprimer la photo">×</button>` : ""}</figure>`).join("")}</div>
        ${photos.length ? "" : `<p class="note">Pas encore de photo.</p>`}
        <div class="frow" style="margin-top:8px"><input type="text" id="phleg" maxlength="80" placeholder="Légende (facultatif)" aria-label="Légende de la photo"><label class="btn" for="phfile">Ajouter des photos</label><input type="file" id="phfile" accept="image/jpeg,image/png,image/webp" multiple hidden></div>
        <div class="msg" id="phmsg"></div>
      </section>`;

    box.innerHTML = `<div class="detail">
      <div class="frow" style="justify-content:space-between"><button class="back" type="button" id="back">← Tous les lieux</button>${member ? `<span class="frow"><button class="linkbtn" type="button" id="edit">Modifier</button>${v.by && v.by === me() ? `<button class="linkbtn danger" type="button" id="dellieu">Supprimer</button>` : ""}</span>` : ""}</div>
      <div class="dh">
        <div class="tags"><span class="tag type" style="background:var(${TYPES[v.t].c})">${esc(TYPES[v.t].l)}</span>${v.f.map((f) => `<span class="tag">${esc(FMTS[f] || f)}</span>`).join("")}</div>
        <h2>${v.no}. ${esc(v.n)}</h2>
        <div class="scores">
          ${member ? `<span><span class="stars">${ao ? starStr(ao.m) : "☆☆☆☆☆"}</span> <b>${ao ? ao.m.toFixed(1).replace(".", ",") : "–"}</b> <span class="msg">Oresys${ao ? ` (${ao.n})` : ""}</span></span>` : ""}
          <span><span class="gstar">${v.gNote ? starStr(v.gNote) : "☆☆☆☆☆"}</span> <b>${v.gNote ? v.gNote.toFixed(1).replace(".", ",") : "–"}</b> <span class="msg">Google${v.gNb ? ` (${nbFmt(v.gNb)})` : ""}</span></span>
        </div>
      </div>
      ${v.d ? `<p class="desc">${esc(v.d)}</p>` : ""}
      <div class="trip">
        <div class="lbl">Depuis Oresys</div>
        <div class="big">${v.tm} min <small>${esc(v.mode)} · ${kmFrom(v.lat, v.lng).toFixed(1).replace(".", ",")} km à vol d'oiseau</small></div>
        ${v.r ? `<div>${esc(v.r)}</div>` : ""}
        <div class="links" style="margin-top:6px"><a class="btn" href="${dirUrl(v)}" target="_blank" rel="noopener">Itinéraire en temps réel ↗</a></div>
      </div>
      <dl class="facts">
        <dt>Adresse</dt><dd>${esc(v.a)}</dd>
        ${v.cap || capLabel(v) ? `<dt>Capacité</dt><dd>${capLabel(v) ? `<b>${esc(capLabel(v))}</b>${v.cap ? "<br>" : ""}` : ""}${esc(v.cap || "")}</dd>` : ""}
        ${v.px ? `<dt>Tarif</dt><dd>${esc(v.px)}</dd>` : ""}
      </dl>
      ${lk ? `<div class="links"><a class="btn primary" href="${esc(lk)}" target="_blank" rel="noopener">${esc(v.linkL || "Site du lieu")} ↗</a></div>` : ""}
      ${googleBlock(v)}
      ${teamBlock}
    </div>`;

    $("#back").onclick = backToList;
    if ($("#edit")) $("#edit").onclick = () => openForm(v);
    if ($("#dellieu")) $("#dellieu").onclick = (e) => deleteLieu(v, e.currentTarget);
    if ($("#gedit")) {
      $("#gedit").onclick = () => { $("#gform").hidden = false; $("#gedit").hidden = true; $("#g-note").focus(); };
      $("#gcancel").onclick = () => { $("#gform").hidden = true; $("#gedit").hidden = false; };
      $("#gform").onsubmit = (e) => { e.preventDefault(); saveGoogle(v); };
      if (gOpen) { $("#gform").hidden = false; $("#gedit").hidden = true; }
    }
    box.querySelectorAll(".st").forEach((b) => (b.onclick = () => setStatut(v.id, b.dataset.v === st ? "" : b.dataset.v)));
    box.querySelectorAll(".ph img").forEach((i) => (i.onclick = () => { $("#lbimg").src = i.src; $("#lbimg").alt = i.alt; $("#lb").hidden = false; }));
    box.querySelectorAll("[data-del-photo]").forEach((b) => (b.onclick = () => delPhoto(b.dataset.delPhoto, b)));
    box.querySelectorAll("[data-del-avis]").forEach((b) => (b.onclick = () => delAvis(b.dataset.delAvis, b)));
    const pf = $("#phfile");
    if (pf) pf.onchange = () => uploadPhotos(v.id, pf.files).finally(() => (pf.value = ""));
    const rf = $("#rf");
    if (rf) {
      rf.querySelectorAll(".rate button").forEach((b) => (b.onclick = () => {
        draft = +b.dataset.n;
        rf.querySelectorAll(".rate button").forEach((x) => { x.classList.toggle("on", +x.dataset.n <= draft); x.setAttribute("aria-checked", +x.dataset.n === draft); });
      }));
      rf.onsubmit = (e) => { e.preventDefault(); postAvis(v.id); };
    }
    for (const [id, val] of Object.entries(keep)) { const el = document.getElementById(id); if (el && val) el.value = val; }
    if (focusId && keep[focusId] !== undefined) document.getElementById(focusId)?.focus();
  }
  async function saveGoogle(v) {
    const m = $("#gmsg");
    const note = $("#g-note").value === "" ? null : Math.round(parseFloat(String($("#g-note").value).replace(",", ".")) * 10) / 10;
    const nb = $("#g-nb").value === "" ? null : parseInt($("#g-nb").value, 10);
    const url = $("#g-url").value.trim();
    if (note !== null && !(note >= 1 && note <= 5)) { m.className = "msg err"; m.textContent = "La note doit être entre 1 et 5."; return; }
    if (nb !== null && !(nb >= 0)) { m.className = "msg err"; m.textContent = "Nombre d'avis invalide."; return; }
    if (url && !/^https:\/\/(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//i.test(url)) { m.className = "msg err"; m.textContent = "Collez un lien Google Maps (https://maps.app.goo.gl/… ou https://www.google.com/maps/…)."; return; }
    m.className = "msg"; m.textContent = "Enregistrement…";
    const { error } = await sb.from("lieux").update({ google_note: note, google_nb: nb, google_url: url, google_maj: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", v.id);
    if (error) { m.className = "msg err"; m.textContent = "Enregistrement impossible : " + error.message; return; }
    await loadLieux();
    $("#gform").hidden = true;
    renderAll();
  }

  /* ---------- Formulaire de lieu ---------- */
  function openForm(v) {
    state.mode = "form";
    state.sel = v ? v.id : null;
    if (link) { link.remove(); link = null; }
    showPanel("detail");
    const f = v || { n: "", t: "atypique", f: ["journee"], a: "", lat: null, lng: null, cap: "", capA: null, capD: null, px: "", d: "", tm: "", mode: "métro", r: "", link: "", linkL: "" };
    $("#detail").innerHTML = `<form class="detail lieuform" id="lf" novalidate>
      <button class="back" type="button" id="back">← ${v ? "Retour à la fiche" : "Tous les lieux"}</button>
      <h2>${v ? "Modifier le lieu" : "Ajouter un lieu"}</h2>
      <label>Nom<input id="f-nom" type="text" required maxlength="120" value="${esc(f.n)}"></label>
      <div class="grid2">
        <label>Type<select id="f-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${f.t === k ? "selected" : ""}>${t.l}</option>`).join("")}</select></label>
        <fieldset><legend>Formats</legend>${Object.entries(FMTS).map(([k, l]) => `<label class="check"><input type="checkbox" name="f-fmt" value="${k}" ${f.f.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</fieldset>
      </div>
      <label>Adresse<div class="frow"><input id="f-adr" type="text" required maxlength="200" value="${esc(f.a)}" placeholder="12 rue Exemple, 75009 Paris"><button class="btn" type="button" id="geo">Localiser</button></div></label>
      <p class="note" id="geomsg">${f.lat ? "Position enregistrée. Cliquez sur la carte ou déplacez le repère pour l'ajuster." : "Cliquez sur « Localiser », puis ajustez si besoin en cliquant sur la carte."}</p>
      <div class="grid2">
        <label>Temps de trajet depuis Oresys (min)<input id="f-tm" type="number" min="1" max="180" required value="${esc(f.tm)}"></label>
        <label>Mode<select id="f-mode">${MODES.map((m) => `<option ${f.mode === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      </div>
      <p class="note" id="tmhint"></p>
      <label>Trajet conseillé<input id="f-r" type="text" maxlength="300" value="${esc(f.r)}" placeholder="Ligne 14 Saint-Lazare → Gare de Lyon, puis 5 min à pied"></label>
      <div class="grid2">
        <label>Capacité assise max (plénière)<input id="f-capa" type="number" min="1" max="2000" value="${f.capA ?? ""}" placeholder="80"></label>
        <label>Capacité debout max (cocktail)<input id="f-capd" type="number" min="1" max="2000" value="${f.capD ?? ""}" placeholder="120"></label>
      </div>
      <label>Détail des capacités<input id="f-cap" type="text" maxlength="300" value="${esc(f.cap)}" placeholder="Salle plénière 80 en théâtre, 120 en cocktail, 3 sous-commissions"></label>
      <label>Tarif<input id="f-px" type="text" maxlength="200" value="${esc(f.px)}" placeholder="Dès 1 500 € HT la journée"></label>
      <label>Description<textarea id="f-d" maxlength="600">${esc(f.d)}</textarea></label>
      <div class="grid2">
        <label>Lien (site ou fiche)<input id="f-link" type="url" maxlength="500" value="${esc(f.link)}" placeholder="https://"></label>
        <label>Libellé du lien<input id="f-linkl" type="text" maxlength="80" value="${esc(f.linkL)}" placeholder="Site du lieu"></label>
      </div>
      <fieldset class="gfs"><legend>Note Google (facultatif)</legend>
        <p class="note">Ouvrez <a href="https://www.google.com/maps" target="_blank" rel="noopener">Google Maps</a>, cherchez le lieu et reportez sa note.</p>
        <div class="grid3">
          <label>Note<input id="f-gnote" type="text" inputmode="decimal" maxlength="3" value="${f.gNote ?? ""}" placeholder="4,5"></label>
          <label>Nombre d'avis<input id="f-gnb" type="number" min="0" step="1" value="${f.gNb ?? ""}" placeholder="1200"></label>
        </div>
        <label>Lien de la fiche Google<input id="f-gurl" type="url" value="${esc(f.gUrl || "")}" placeholder="https://maps.app.goo.gl/…"></label>
      </fieldset>
      <div class="frow"><button class="btn primary" type="submit">${v ? "Enregistrer" : "Ajouter le lieu"}</button><span class="msg" id="lfmsg"></span></div>
    </form>`;
    $("#scroll").scrollTop = 0;
    $("#back").onclick = () => { if (draftMarker) { draftMarker.remove(); draftMarker = null; } v ? openVenue(v.id) : backToList(); };
    $("#geo").onclick = geocode;
    $("#lf").onsubmit = (e) => { e.preventDefault(); saveLieu(v); };
    if (f.lat) setDraftPoint(f.lat, f.lng, false); else if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    syncMarkers();
  }
  function setDraftPoint(lat, lng, fly) {
    if (!draftMarker) {
      draftMarker = L.marker([lat, lng], { draggable: true, zIndexOffset: 2000, icon: L.divIcon({ className: "", html: '<div class="pin draft"><b>+</b></div>', iconSize: [26, 26], iconAnchor: [13, 30] }) }).addTo(map);
      draftMarker.on("dragend", () => { const p = draftMarker.getLatLng(); hintTime(p.lat, p.lng); });
    } else draftMarker.setLatLng([lat, lng]);
    if (fly) map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
    hintTime(lat, lng);
  }
  function hintTime(lat, lng) {
    const d = kmFrom(lat, lng);
    const walk = Math.round(d * 1.3 * 12);
    const transit = Math.round(10 + d * 3.2);
    const el = $("#tmhint");
    if (!el) return;
    el.textContent = `Distance à vol d'oiseau : ${d.toFixed(1).replace(".", ",")} km. Ordre de grandeur : ${d < 1.5 ? `${walk} min à pied` : `${transit} min en transports`}. Vérifiez avec l'itinéraire une fois le lieu enregistré.`;
    const tm = $("#f-tm");
    if (tm && !tm.value) { tm.value = d < 1.5 ? walk : transit; $("#f-mode").value = d < 1.5 ? "à pied" : "métro"; }
  }
  async function geocode() {
    const q = $("#f-adr").value.trim();
    const m = $("#geomsg");
    if (q.length < 5) { m.className = "note err"; m.textContent = "Saisissez une adresse complète."; return; }
    m.className = "note"; m.textContent = "Recherche de l'adresse…";
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&accept-language=fr&q=" + encodeURIComponent(q));
      const j = await r.json();
      if (!j.length) { m.className = "note err"; m.textContent = "Adresse introuvable. Cliquez directement sur la carte pour placer le lieu."; return; }
      setDraftPoint(+j[0].lat, +j[0].lon, true);
      m.textContent = "Adresse trouvée. Ajustez le repère sur la carte si besoin.";
    } catch (e) {
      m.className = "note err"; m.textContent = "Recherche indisponible. Cliquez directement sur la carte pour placer le lieu.";
    }
  }
  async function saveLieu(v) {
    const m = $("#lfmsg");
    const fmts = [...document.querySelectorAll('input[name="f-fmt"]:checked')].map((i) => i.value);
    const pos = draftMarker?.getLatLng();
    const linkVal = $("#f-link").value.trim();
    const row = {
      nom: $("#f-nom").value.trim(), type: $("#f-type").value, formats: fmts, adresse: $("#f-adr").value.trim(),
      temps: parseInt($("#f-tm").value, 10), mode: $("#f-mode").value, trajet: $("#f-r").value.trim(),
      capacite: $("#f-cap").value.trim(),
      capacite_assis: $("#f-capa").value === "" ? null : parseInt($("#f-capa").value, 10),
      capacite_debout: $("#f-capd").value === "" ? null : parseInt($("#f-capd").value, 10),
      tarif: $("#f-px").value.trim(), description: $("#f-d").value.trim(),
      lien: linkVal, lien_libelle: $("#f-linkl").value.trim()
    };
    const gn = $("#f-gnote").value, gb = $("#f-gnb").value, gu = $("#f-gurl").value.trim();
    const gNote = gn === "" ? null : Math.round(parseFloat(gn.replace(",", ".")) * 10) / 10;
    const gNb = gb === "" ? null : parseInt(gb, 10);
    if (gNote !== null && !(gNote >= 1 && gNote <= 5)) { m.className = "msg err"; m.textContent = "La note Google doit être entre 1 et 5."; return; }
    if (gu && !/^https:\/\/(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//i.test(gu)) { m.className = "msg err"; m.textContent = "Le lien Google doit être un lien Google Maps."; return; }
    const gChanged = !v || gNote !== v.gNote || gNb !== (v.gNb ?? null) || gu !== (v.gUrl || "");
    Object.assign(row, { google_note: gNote, google_nb: gNb, google_url: gu });
    if (gChanged && gNote !== null) row.google_maj = new Date().toISOString().slice(0, 10);
    const err = !row.nom ? "Indiquez le nom du lieu." : !row.adresse ? "Indiquez l'adresse." : !pos ? "Placez le lieu sur la carte (bouton « Localiser » ou clic sur la carte)." : !fmts.length ? "Cochez au moins un format." : !row.capacite_assis && !row.capacite_debout ? "Indiquez au moins une capacité (assise ou debout) pour le filtre par participants." : !(row.temps >= 1 && row.temps <= 180) ? "Indiquez un temps de trajet entre 1 et 180 minutes." : linkVal && !/^https?:\/\//i.test(linkVal) ? "Le lien doit commencer par https://" : "";
    if (err) { m.className = "msg err"; m.textContent = err; return; }
    row.lat = pos.lat; row.lng = pos.lng;
    m.className = "msg"; m.textContent = "Enregistrement…";
    let res;
    if (v) res = await sb.from("lieux").update({ ...row, updated_at: new Date().toISOString() }).eq("id", v.id).select().single();
    else res = await sb.from("lieux").insert(row).select().single();
    if (res.error) { m.className = "msg err"; m.textContent = "Enregistrement impossible : " + res.error.message; return; }
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    await loadLieux();
    openVenue(res.data.id);
  }
  async function deleteLieu(v, btn) {
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Confirmer : supprimer le lieu et ses avis"; return; }
    const { error } = await sb.from("lieux").delete().eq("id", v.id);
    if (error) { btn.textContent = "Suppression impossible"; return; }
    await loadLieux();
    backToList();
  }

  /* ---------- Avis, statuts, photos ---------- */
  async function postAvis(venue) {
    const m = $("#rmsg");
    const texte = $("#rtxt").value.trim();
    const visite = $("#rdate").value || null;
    if (!draft && !texte) { m.className = "msg err"; m.textContent = "Donnez une note ou écrivez un commentaire."; return; }
    m.className = "msg"; m.textContent = "Publication…";
    const { error } = await sb.from("avis").insert({ venue, note: draft, texte, visite, author_name: displayName().slice(0, 60) });
    if (error) { m.className = "msg err"; m.textContent = "Publication impossible : " + error.message; return; }
    $("#rtxt").value = "";
    $("#rdate").value = "";
    draft = 0;
    await loadAvis();
    renderAll();
  }
  async function delAvis(id, btn) {
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Confirmer la suppression"; return; }
    const { error } = await sb.from("avis").delete().eq("id", id);
    if (error) { btn.textContent = "Échec de la suppression"; return; }
    await loadAvis();
    renderAll();
  }
  async function setStatut(venue, val) {
    const q = val
      ? sb.from("statuts").upsert({ venue, statut: val, updated_by: me(), updated_at: new Date().toISOString() })
      : sb.from("statuts").delete().eq("venue", venue);
    const { error } = await q;
    if (error) { alert("Le statut n'a pas pu être enregistré : " + error.message); return; }
    await loadStatuts();
    renderAll();
  }
  function shrink(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * r);
        c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("conversion"))), "image/jpeg", 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("lecture")); };
      img.src = url;
    });
  }
  async function uploadPhotos(venue, files) {
    const m = $("#phmsg");
    const legende = ($("#phleg")?.value || "").trim().slice(0, 80);
    let n = 0;
    for (const f of files) {
      m.className = "msg"; m.textContent = `Envoi de ${f.name}…`;
      let blob;
      try { blob = await shrink(f); } catch (e) { m.className = "msg err"; m.textContent = `${f.name} n'est pas une image lisible (JPG, PNG ou WebP).`; return; }
      const path = `${venue}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { m.className = "msg err"; m.textContent = "Envoi impossible : " + up.error.message; return; }
      const ins = await sb.from("photos").insert({ venue, path, legende });
      if (ins.error) { await sb.storage.from("photos").remove([path]); m.className = "msg err"; m.textContent = "Enregistrement impossible : " + ins.error.message; return; }
      n++;
    }
    if ($("#phleg")) $("#phleg").value = "";
    await loadPhotos();
    renderAll();
    const mm = $("#phmsg");
    if (mm) mm.textContent = n ? `${n} photo${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.` : "";
  }
  async function delPhoto(id, btn) {
    if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "✓"; btn.title = "Cliquer pour confirmer"; return; }
    const p = live.photos.find((x) => x.id === id);
    if (!p) return;
    const { error } = await sb.from("photos").delete().eq("id", id);
    if (error) { btn.textContent = "!"; return; }
    await sb.storage.from("photos").remove([p.path]);
    delete live.urls[p.path];
    await loadPhotos();
    renderAll();
  }

  /* ---------- Divers ---------- */
  $("#addbtn").onclick = () => openForm(null);
  $("#lbx").onclick = () => { $("#lb").hidden = true; };
  $("#lb").onclick = (e) => { if (e.target.id === "lb") $("#lb").hidden = true; };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#lb").hidden) $("#lb").hidden = true;
    else if (state.mode === "detail") backToList();
  });
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (h && V.some((v) => v.id === h)) openVenue(h);
  });

  /* ---------- Bandeau de connexion repliable ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };
  function applyFold() {
    const folded = store.get("meet.compte.replie") === "1";
    $("#account").hidden = folded;
    const b = $("#acctfold");
    b.setAttribute("aria-expanded", String(!folded));
    b.title = folded ? "Afficher le bandeau de connexion" : "Masquer le bandeau de connexion";
    b.firstElementChild.textContent = folded ? "▼" : "▲";
    $("#accttitle").textContent = session ? (folded ? `Connecté : ${displayName()}` : "Mon compte") : (folded ? "Se connecter ou créer un compte" : "Connexion");
  }
  $("#acctfold").onclick = () => { store.set("meet.compte.replie", store.get("meet.compte.replie") === "1" ? "0" : "1"); applyFold(); };
  const renderAccountBase = renderAccount;
  renderAccount = function () { renderAccountBase(); applyFold(); };

  /* ---------- Panneau latéral redimensionnable (jusqu'à 60 % de l'écran) ---------- */
  const SIDE_MIN = 320;
  const sideMax = () => Math.max(SIDE_MIN, Math.round(window.innerWidth * 0.6));
  function setSide(px, save) {
    const w = Math.min(sideMax(), Math.max(SIDE_MIN, Math.round(px)));
    document.documentElement.style.setProperty("--side-w", w + "px");
    $("#resizer").setAttribute("aria-valuenow", String(w));
    if (save) store.set("meet.panneau.largeur", String(w));
    map.invalidateSize();
  }
  (function initResizer() {
    const r = $("#resizer");
    r.setAttribute("aria-valuemin", String(SIDE_MIN));
    const saved = parseInt(store.get("meet.panneau.largeur") || "", 10);
    setSide(saved || 400, false);
    let dragging = false;
    r.addEventListener("pointerdown", (e) => { dragging = true; r.classList.add("drag"); r.setPointerCapture(e.pointerId); e.preventDefault(); });
    r.addEventListener("pointermove", (e) => { if (dragging) setSide(e.clientX, false); });
    const stop = (e) => { if (!dragging) return; dragging = false; r.classList.remove("drag"); setSide(e.clientX, true); };
    r.addEventListener("pointerup", stop);
    r.addEventListener("pointercancel", stop);
    r.addEventListener("dblclick", () => setSide(400, true));
    r.addEventListener("keydown", (e) => {
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--side-w"), 10) || 400;
      if (e.key === "ArrowRight") { setSide(cur + 40, true); e.preventDefault(); }
      if (e.key === "ArrowLeft") { setSide(cur - 40, true); e.preventDefault(); }
    });
    window.addEventListener("resize", () => {
      r.setAttribute("aria-valuemax", String(sideMax()));
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--side-w"), 10) || 400;
      if (cur > sideMax()) setSide(sideMax(), false);
    });
    r.setAttribute("aria-valuemax", String(sideMax()));
  })();

  /* ---------- Démarrage ---------- */
  renderAccount();
  renderAll();
  if (sb) {
    sb.auth.getSession().then(async ({ data }) => {
      session = data.session;
      await refreshMember();
      renderAccount();
      await loadAll();
      const h = location.hash.slice(1);
      if (h && V.some((v) => v.id === h)) openVenue(h);
    });
    sb.auth.onAuthStateChange((_event, s) => {
      const changed = (s?.user?.id || null) !== me();
      session = s;
      if (!changed) return;
      // Différé : appeler Supabase directement dans ce rappel peut bloquer la session.
      setTimeout(async () => {
        await refreshMember();
        renderAccount();
        await loadAll();
      }, 0);
    });
  }
})();
