/* Cotecarte — scanner de numéros (Tesseract.js), cote via API publiques, classeur local. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur = "EUR") => n == null || isNaN(n) ? "—" :
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
const GAME = {
  pokemon: { label: "Pokémon", cls: "poke", cm: "Pokemon" },
  onepiece: { label: "One Piece", cls: "op", cm: "OnePiece" }
};

/* ============ Navigation ============ */
const VIEWS = ["scan", "classeur", "sorties"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "scan";
  VIEWS.forEach(k => $("#v-" + k).hidden = k !== v);
  document.querySelectorAll(".menu a").forEach(a => a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (v !== "scan") stopReading();
  if (v === "classeur") renderColl();
}
window.addEventListener("hashchange", route);

/* ============ Statut ============ */
function status(msg, err = false) { const s = $("#status"); s.textContent = msg; s.classList.toggle("err", err); }

/* ============ Caméra ============ */
let stream = null, cams = [], camIdx = 0;
const video = $("#video");
async function startCam() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const constraints = cams.length
      ? { video: { deviceId: { exact: cams[camIdx].deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
      : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream; await video.play();
    $("#camOff").hidden = true; $("#scanBtn").disabled = false;
    if (!cams.length) {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      const cur = stream.getVideoTracks()[0].getSettings().deviceId;
      camIdx = Math.max(0, cams.findIndex(c => c.deviceId === cur));
    }
    $("#flip").hidden = cams.length < 2;
  } catch (e) {
    const why = e?.name === "NotAllowedError" ? "Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, ou tapez le numéro."
      : !window.isSecureContext ? "La caméra exige une adresse en https."
      : "Caméra indisponible sur cet appareil. Tapez le numéro ci-dessous.";
    status(why, true);
  }
}
$("#startCam").onclick = startCam;
$("#flip").onclick = () => { camIdx = (camIdx + 1) % cams.length; startCam(); };

/* ============ Lecture du numéro (OCR) ============ */
let worker = null, reading = false;
async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) throw new Error("ocr-missing");
  status("Préparation de la lecture (une seule fois, quelques secondes)…");
  worker = await Tesseract.createWorker("eng");
  await worker.setParameters({ tessedit_char_whitelist: "OPSTEBRC0123456789-/ ", tessedit_pageseg_mode: "6" });
  return worker;
}
/* Découpe la bande du bas du cadre-guide dans l'image vidéo, en tenant compte du object-fit: cover. */
function grabStrip() {
  const vw = video.videoWidth, vh = video.videoHeight, box = video.getBoundingClientRect();
  if (!vw || !vh) return null;
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (box.width - vw * scale) / 2, offY = (box.height - vh * scale) / 2;
  const gw = box.width * 0.68, gh = gw * 88 / 63, gx = (box.width - gw) / 2, gy = (box.height - gh) / 2;
  const sx = (gx - offX) / scale, sy = (gy + gh * 0.80 - offY) / scale;
  const sw = gw / scale, sh = (gh * 0.24) / scale;
  const out = document.createElement("canvas"), k = Math.min(3, 1400 / sw);
  out.width = Math.round(sw * k); out.height = Math.round(sh * k);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, out.width, out.height);
  // Niveaux de gris + étirement du contraste
  const img = ctx.getImageData(0, 0, out.width, out.height), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const g = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; d[i] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
  const r = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] - lo) * r; d[i] = d[i + 1] = d[i + 2] = g; }
  ctx.putImageData(img, 0, 0);
  return out;
}
function parseCode(text) {
  let t = (" " + text.toUpperCase() + " ").replace(/[|\\]/g, "/").replace(/[–—_]/g, "-").replace(/\s+/g, " ");
  t = t.replace(/([^A-Z])0P/g, "$1OP").replace(/([^A-Z])5T/g, "$1ST").replace(/([^A-Z])E8/g, "$1EB").replace(/PR8/g, "PRB");
  let m = t.match(/(OP|ST|EB|PRB)\s?-?\s?(\d{2})\s?-\s?(\d{3})/);
  if (m) return { game: "onepiece", code: `${m[1]}${m[2]}-${m[3]}` };
  m = t.match(/(?:^|\D)(\d{1,3})\s?\/\s?(\d{2,3})(?:\D|$)/);
  if (m && +m[2] >= 20) return { game: "pokemon", number: String(+m[1]), total: +m[2], code: `${m[1].padStart(3, "0")}/${m[2]}` };
  return null;
}
async function readLoop() {
  let tries = 0;
  try {
    const w = await getWorker();
    $("#cam").classList.add("reading");
    while (reading) {
      tries++;
      const strip = grabStrip();
      if (strip) {
        const { data } = await w.recognize(strip);
        const hit = parseCode(data.text || "");
        if (hit) { stopReading(); status(`Numéro lu : ${hit.code}`); if (navigator.vibrate) navigator.vibrate(60); lookup(hit); return; }
      }
      status(tries < 6 ? "Lecture en cours… tenez la carte immobile, sans reflet." : "Toujours rien : rapprochez-vous, ou tapez le numéro ci-dessous.");
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) {
    stopReading();
    status(e?.message === "ocr-missing" ? "Le module de lecture n'a pas pu se charger. Tapez le numéro." : "La lecture a échoué. Réessayez ou tapez le numéro.", true);
  }
}
function stopReading() {
  reading = false; $("#cam").classList.remove("reading");
  $("#scanBtn").textContent = "Lire le numéro";
}
$("#scanBtn").onclick = () => {
  if (reading) { stopReading(); status(""); return; }
  reading = true; $("#scanBtn").textContent = "Arrêter"; readLoop();
};

/* ============ Recherche manuelle ============ */
$("#search").addEventListener("submit", e => {
  e.preventDefault();
  const raw = $("#q").value.trim(); if (!raw) return;
  const hit = parseCode(raw);
  if (hit) return lookup(hit);
  if (raw.length >= 3) return lookup({ game: "pokemon", name: raw, code: raw });
  status("Format non reconnu. Exemples : OP05-119, ST10-005, 199/165 ou un nom de Pokémon.", true);
});

/* ============ Sources de prix ============ */
async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
const num = v => (v == null || v === "" || isNaN(+v)) ? null : +v;

async function fetchOnePiece(code) {
  const path = code.startsWith("ST") ? `decks/card/${code}/` : `sets/card/${code}/`;
  const data = await getJSON("https://optcgapi.com/api/" + path);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map((o, i) => {
    const imgId = o.card_image_id || o.image_id || `${code}_${i}`;
    const name = o.card_name || o.name || code;
    const parallel = /_p\d|parallel|alt/i.test(imgId + " " + name);
    return {
      vid: "op:" + imgId, game: "onepiece", code,
      name: name.replace(/\s*\((parallel|alternate art)\)\s*/i, ""),
      set: o.set_name || o.set || "", rarity: o.rarity || "",
      variant: parallel ? "Parallèle" : "Standard",
      img: o.card_image || o.image || "",
      price: num(o.market_price ?? o.inventory_price), currency: "USD", source: "TCGplayer"
    };
  });
}
async function fetchPokemon(hit) {
  const base = "https://api.pokemontcg.io/v2/cards?pageSize=30&select=id,name,number,rarity,set,images,cardmarket&q=";
  let data;
  if (hit.name) data = await getJSON(base + encodeURIComponent(`name:"${hit.name.replace(/"/g, "")}*"`) + "&orderBy=-set.releaseDate");
  else {
    data = await getJSON(base + encodeURIComponent(`number:${hit.number} set.printedTotal:${hit.total}`));
    if (!data.data?.length) data = await getJSON(base + encodeURIComponent(`number:${hit.number} set.total:${hit.total}`));
  }
  const out = [];
  for (const c of data.data || []) {
    const p = c.cardmarket?.prices || {};
    const common = { game: "pokemon", code: `${c.number}/${c.set?.printedTotal ?? "?"}`, name: c.name, set: c.set?.name || "", rarity: c.rarity || "", img: c.images?.small || "", currency: "EUR", source: "Cardmarket", apiId: c.id };
    out.push({ ...common, vid: "pk:" + c.id, variant: "Normale", price: num(p.trendPrice ?? p.averageSellPrice ?? p.avg30) });
    if (num(p.reverseHoloTrend)) out.push({ ...common, vid: "pk:" + c.id + ":rev", variant: "Reverse", price: num(p.reverseHoloTrend) });
  }
  return out;
}
const cmLink = c => `https://www.cardmarket.com/fr/${GAME[c.game].cm}/Products/Search?searchString=${encodeURIComponent(c.name + (c.game === "onepiece" ? " " + c.code : ""))}`;

/* ============ Résultats : choix de la version ============ */
let versions = [], chosen = null;
async function lookup(hit) {
  $("#results").innerHTML = ""; versions = []; chosen = null;
  status(`Recherche de ${hit.code}…`);
  try {
    versions = hit.game === "onepiece" ? await fetchOnePiece(hit.code) : await fetchPokemon(hit);
  } catch (e) {
    status("Source de prix injoignable pour le moment.", true);
    $("#results").innerHTML = `<p class="pick-sub">Vous pouvez vérifier la cote directement sur <a href="https://www.cardmarket.com/fr/${GAME[hit.game].cm}/Products/Search?searchString=${encodeURIComponent(hit.code)}" target="_blank" rel="noopener">Cardmarket</a>.</p>`;
    return;
  }
  if (!versions.length) { status(`Aucune carte trouvée pour ${hit.code}. Vérifiez le numéro.`, true); return; }
  status(versions.length === 1 ? "Carte trouvée." : `${versions.length} versions correspondent : choisissez la vôtre.`);
  if (versions.length === 1) chosen = versions[0];
  renderVersions();
}
function renderVersions() {
  const el = $("#results");
  const many = versions.length > 1;
  el.innerHTML = (many ? `<h2 class="pick-title">Quelle version avez-vous ?</h2><p class="pick-sub">Comparez l'illustration, le symbole d'extension et la brillance.</p>` : "")
    + `<div class="versions">${versions.map(v => `
      <button class="version" data-vid="${esc(v.vid)}" aria-pressed="${chosen?.vid === v.vid}">
        <img src="${esc(v.img)}" alt="${esc(v.name)}" loading="lazy">
        <span class="v-name">${esc(v.name)}</span>
        <span class="v-sub">${esc([v.variant, v.rarity, v.set].filter(Boolean).join(" · "))}</span>
        <span class="v-price">${money(v.price, v.currency)}</span>
      </button>`).join("")}</div>`
    + (chosen ? `<div class="row">
        <button class="btn primary" id="addBtn">Ajouter au classeur</button>
        <a class="btn" href="${cmLink(chosen)}" target="_blank" rel="noopener">Voir sur Cardmarket</a>
      </div><p class="pick-sub">Cote ${esc(chosen.source)}${chosen.currency === "USD" ? " (marché américain, en dollars)" : ""}.</p>` : "");
  el.querySelectorAll(".version").forEach(b => b.onclick = () => { chosen = versions.find(v => v.vid === b.dataset.vid); renderVersions(); $("#addBtn")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
  $("#addBtn")?.addEventListener("click", () => {
    addToColl(chosen);
    status(`${chosen.name} ajoutée au classeur.`);
    $("#results").innerHTML = ""; versions = []; chosen = null; $("#q").value = "";
  });
}

/* ============ Classeur (stockage local) ============ */
const KEY = "cotecarte.collection.v1";
let coll = [];
try { coll = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { coll = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(coll)); } catch { status("Stockage plein ou bloqué : exportez votre classeur.", true); } };
function addToColl(v) {
  const twin = coll.find(c => c.vid === v.vid);
  if (twin) twin.qty++; else coll.push({ ...v, qty: 1, added: Date.now(), priced: Date.now() });
  save(); renderColl();
}
let filter = "all";
document.querySelectorAll(".chip").forEach(b => b.onclick = () => {
  filter = b.dataset.f; document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b)); renderColl();
});
$("#sort").onchange = renderColl;
const RANK = ["sec", "sp", "special illustration", "hyper", "ultra", "illustration", "sr", "l", "leader", "double", "rare holo", "r", "rare", "uc", "uncommon", "c", "common", "p", "promo"];
const rRank = r => { r = (r || "").toLowerCase(); const i = RANK.findIndex(k => r === k || r.startsWith(k)); return i < 0 ? 99 : i; };
function cardEl(c) {
  const g = GAME[c.game];
  return `<article class="card">
    <img class="art" src="${esc(c.img)}" alt="" loading="lazy">
    <div class="info">
      <div class="tags"><span class="tag ${g.cls}">${g.label}</span>${c.rarity ? `<span class="tag">${esc(c.rarity)}</span>` : ""}${c.variant && !/^(standard|normale)$/i.test(c.variant) ? `<span class="tag">${esc(c.variant)}</span>` : ""}</div>
      <h3 class="name">${esc(c.name)}</h3>
      <p class="code">${esc([c.code, c.set].filter(Boolean).join(" · "))}</p>
      <div class="price">${money(c.price, c.currency)}<small>${esc(c.source)}${c.qty > 1 ? ` · ×${c.qty} = ${money((c.price || 0) * c.qty, c.currency)}` : ""}</small></div>
      <div class="actions">
        <div class="qty"><button data-q="-1" data-vid="${esc(c.vid)}" aria-label="Retirer un exemplaire">−</button><span>${c.qty}</span><button data-q="1" data-vid="${esc(c.vid)}" aria-label="Ajouter un exemplaire">+</button></div>
        <a href="${cmLink(c)}" target="_blank" rel="noopener">Cardmarket</a>
        <button class="del" data-del="${esc(c.vid)}">Retirer</button>
      </div>
    </div></article>`;
}
function renderColl() {
  const shown = coll.filter(c => filter === "all" || c.game === filter);
  $("#sCount").textContent = coll.reduce((s, c) => s + c.qty, 0);
  $("#sEur").textContent = money(coll.filter(c => c.currency === "EUR").reduce((s, c) => s + (c.price || 0) * c.qty, 0), "EUR");
  $("#sUsd").textContent = money(coll.filter(c => c.currency === "USD").reduce((s, c) => s + (c.price || 0) * c.qty, 0), "USD");
  const el = $("#coll");
  if (!shown.length) {
    el.innerHTML = `<div class="empty"><strong>${coll.length ? "Rien dans ce filtre" : "Votre classeur est vide"}</strong>${coll.length ? "Changez de filtre pour voir le reste." : `Scannez ou tapez le numéro d'une carte, choisissez sa version, puis « Ajouter au classeur ». <br><br><a class="btn primary small" href="#scan">Scanner une carte</a>`}</div>`;
    return;
  }
  const s = $("#sort").value;
  const val = c => (c.price || 0) * (c.currency === "USD" ? 0.92 : 1); // tri seulement, approximatif
  const sorted = [...shown].sort({
    value: (a, b) => val(b) - val(a),
    name: (a, b) => a.name.localeCompare(b.name, "fr"),
    recent: (a, b) => b.added - a.added,
    rarity: (a, b) => rRank(a.rarity) - rRank(b.rarity) || val(b) - val(a),
    set: (a, b) => (a.set || "~").localeCompare(b.set || "~", "fr") || a.code.localeCompare(b.code, "fr", { numeric: true })
  }[s]);
  if (s === "set" || s === "rarity") {
    const groups = new Map();
    sorted.forEach(c => { const k = (s === "set" ? c.set : c.rarity) || "Non renseigné"; groups.has(k) || groups.set(k, []); groups.get(k).push(c); });
    el.innerHTML = [...groups].map(([k, arr]) => `<div class="group"><span>${esc(k)}</span><span>${arr.reduce((t, c) => t + c.qty, 0)} carte(s)</span></div>` + arr.map(cardEl).join("")).join("");
  } else el.innerHTML = sorted.map(cardEl).join("");
}
let pendingDel = null;
$("#coll").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.q) {
    const c = coll.find(x => x.vid === b.dataset.vid); if (!c) return;
    c.qty = Math.max(1, c.qty + +b.dataset.q); save(); renderColl();
  } else if (b.dataset.del) {
    if (pendingDel === b.dataset.del) { coll = coll.filter(x => x.vid !== b.dataset.del); pendingDel = null; save(); renderColl(); }
    else { pendingDel = b.dataset.del; b.textContent = "Confirmer ?"; setTimeout(() => { if (pendingDel === b.dataset.del) { pendingDel = null; renderColl(); } }, 3000); }
  }
});

/* Actualiser les prix : une requête par carte, espacées, pour ménager les API gratuites */
$("#refresh").onclick = async () => {
  const btn = $("#refresh"); if (!coll.length) return;
  btn.disabled = true; let done = 0, fails = 0;
  for (const c of coll) {
    btn.textContent = `Actualisation ${++done}/${coll.length}…`;
    try {
      const list = c.game === "onepiece" ? await fetchOnePiece(c.code)
        : await fetchPokemon({ number: c.code.split("/")[0], total: +c.code.split("/")[1] });
      const fresh = list.find(v => v.vid === c.vid);
      if (fresh && fresh.price != null) { c.price = fresh.price; c.priced = Date.now(); } else fails++;
    } catch { fails++; }
    await new Promise(r => setTimeout(r, 400));
  }
  save(); renderColl(); btn.disabled = false; btn.textContent = "Actualiser les prix";
  status(fails ? `Prix actualisés, ${fails} carte(s) sans réponse.` : "Tous les prix sont à jour.", !!fails);
};
$("#export").onclick = () => {
  const blob = new Blob([JSON.stringify(coll, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `cotecarte-classeur-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#import").onchange = async e => {
  const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
  try {
    const rows = JSON.parse(await f.text()); if (!Array.isArray(rows)) throw 0;
    let n = 0;
    for (const r of rows) if (r?.vid && GAME[r.game]) { const t = coll.find(c => c.vid === r.vid); if (t) t.qty = Math.max(t.qty, r.qty || 1); else { coll.push({ ...r, qty: r.qty || 1 }); n++; } }
    save(); renderColl(); status(`${n} carte(s) importée(s).`);
  } catch { status("Fichier illisible : choisissez un export Cotecarte (.json).", true); }
};

/* ============ Sorties ============ */
const RELEASES = [
  { d: "2026-10-24", g: "pokemon", t: "Avant-premières Règne Delta", n: "Tournois en boutique avant la sortie de ME06.", s: "ok" },
  { d: "2026-10-30", g: "pokemon", t: "Decks de combat Mentali-ex et Noctali-ex", n: "Decks prêts à jouer.", s: "tbc" },
  { d: "2026-11-06", g: "pokemon", t: "Méga-Évolution — Règne Delta (ME06)", n: "Nouvelle extension : boosters, ETB, displays.", s: "ok" },
  { d: "2026-11-06", g: "pokemon", t: "Collection Ultra Premium 30e Anniversaire", n: "Versions Jour et Nuit.", s: "tbc" },
  { d: "2026-11-20", g: "onepiece", t: "OP-18 — The Dominance of God", n: "Date de la version anglaise. Date française pas encore annoncée.", s: "tbc" },
  { d: "2026-12-04", g: "pokemon", t: "Dernière vague 30e Anniversaire", n: "Produits pas encore détaillés.", s: "tbc" }
];
function renderRel() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  $("#rels").innerHTML = RELEASES.map(r => {
    const d = new Date(r.d + "T00:00:00"), days = Math.round((d - today) / 864e5), g = GAME[r.g];
    if (days < -7) return "";
    const when = days > 1 ? `dans ${days} jours` : days === 1 ? "demain" : days === 0 ? "aujourd'hui" : "en cours";
    return `<article class="rel"><div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span></div>
      <div class="info"><div class="tags"><span class="tag ${g.cls}">${g.label}</span><span class="state ${r.s}">${r.s === "ok" ? "Confirmé" : "Annoncé"}</span></div>
      <h3 class="name">${esc(r.t)}</h3><p>${esc(r.n)}</p><span class="when">${when}</span></div></article>`;
  }).join("");
}

/* ============ Démarrage ============ */
route(); renderRel(); renderColl();
if (!navigator.mediaDevices?.getUserMedia) {
  $("#camOff").innerHTML = "<p>Ce navigateur ne donne pas accès à la caméra.</p><p class='fine'>Tapez le numéro de la carte ci-dessous.</p>";
}
