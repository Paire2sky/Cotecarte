/* Cotecarte — scan du numéro (Tesseract.js), cote via API publiques, classeur virtuel local. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = (n, cur = "EUR") => n == null || isNaN(n) ? "—" :
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
const num = v => (v == null || v === "" || isNaN(+v)) ? null : +v;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const wideMQ = matchMedia("(min-width: 900px)");
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } } };

const GAME = {
  pokemon: { label: "Pokémon", cls: "poke", cm: "Pokemon", cover: "#1F3A7A", hi: "#F5C83A", title: "Pokémon" },
  onepiece: { label: "One Piece", cls: "op", cm: "OnePiece", cover: "#6E1C2B", hi: "#F2C14E", title: "One Piece" },
  all: { cover: "#1E2433", hi: "#3CCBDD", title: "Ma collection" }
};
const LANGS = { FR: "Français", EN: "Anglais", JP: "Japonais", DE: "Allemand", IT: "Italien", ES: "Espagnol", PT: "Portugais" };
const LANGS_BY_GAME = { pokemon: ["FR", "EN", "JP", "DE", "IT", "ES", "PT"], onepiece: ["FR", "EN", "JP"] };
const USD_EUR = 0.92; // conversion approximative, sert uniquement au tri et aux tranches de valeur

const PK_TYPES = {
  Grass: ["Plante", "#4CAF50"], Fire: ["Feu", "#E4572E"], Water: ["Eau", "#2D7DD2"], Lightning: ["Électrique", "#E0AE14"],
  Psychic: ["Psy", "#9B5DE5"], Fighting: ["Combat", "#B5651D"], Darkness: ["Obscurité", "#4A4763"], Metal: ["Métal", "#7D8A9E"],
  Dragon: ["Dragon", "#B8962E"], Fairy: ["Fée", "#E87FB4"], Colorless: ["Incolore", "#A89F91"]
};
const OP_COLORS = { Red: ["Rouge", "#D7263D"], Green: ["Vert", "#2E9E5B"], Blue: ["Bleu", "#1F6FD1"], Purple: ["Violet", "#7B3FBF"], Black: ["Noir", "#3A3A3A"], Yellow: ["Jaune", "#D9B310"] };

/* ============ Navigation ============ */
const VIEWS = ["scan", "classeur", "sorties"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "scan";
  VIEWS.forEach(k => $("#v-" + k).hidden = k !== v);
  $$(".menu a").forEach(a => a.dataset.v === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (v !== "scan") stopReading();
  if (v === "classeur") { buildBinder(); autoEnrich(); }
}
window.addEventListener("hashchange", route);
function status(msg, err = false) { const s = $("#status"); s.textContent = msg; s.classList.toggle("err", err); }

/* ============ Caméra ============ */
let stream = null, track = null, cams = [], camIdx = 0;
const SIZE = { width: { ideal: 1920 }, height: { ideal: 1440 } };
const video = $("#video");
async function startCam() {
  try {
    stream?.getTracks().forEach(t => t.stop());
    const pick = cams.length ? { deviceId: { exact: cams[camIdx].deviceId } } : { facingMode: { ideal: "environment" } };
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...pick, ...SIZE } }); }
    catch (e) { if (e?.name === "NotAllowedError") throw e; stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: pick }); }
    video.srcObject = stream; await video.play();
    track = stream.getVideoTracks()[0];
    // Pas d'applyConstraints ici : sur iPhone, Safari repasse alors la caméra en 640×480 et le numéro devient illisible.
    showCamInfo();
    $("#camOff").hidden = true; $("#scanBtn").disabled = false;
    if (!cams.length) {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      const cur = track.getSettings().deviceId;
      camIdx = Math.max(0, cams.findIndex(c => c.deviceId === cur));
    }
    $("#flipCam").hidden = cams.length < 2;
    setupTools();
  } catch (e) {
    status(e?.name === "NotAllowedError" ? "Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, ou utilisez « Photo HD »."
      : !window.isSecureContext ? "La caméra exige une adresse en https."
      : "Caméra indisponible. Utilisez « Photo HD » ou tapez le numéro.", true);
  }
}
function setupTools() {
  const caps = track?.getCapabilities?.() || {};
  const hasTorch = !!caps.torch, hasZoom = !!caps.zoom && caps.zoom.max > caps.zoom.min;
  $("#camTools").hidden = !hasTorch && !hasZoom;
  $("#torch").hidden = !hasTorch; $("#torch").setAttribute("aria-pressed", "false");
  $("#zoomWrap").hidden = !hasZoom;
  if (hasZoom) {
    const z = $("#zoom"); z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 4); z.step = caps.zoom.step || 0.1;
    z.value = track.getSettings().zoom || caps.zoom.min;
  }
}
$("#torch").onclick = async () => {
  const on = $("#torch").getAttribute("aria-pressed") !== "true";
  try { await keepSize({ torch: on }); $("#torch").setAttribute("aria-pressed", on); } catch { }
};
$("#zoom").onchange = e => { keepSize({ zoom: +e.target.value }).catch(() => { }); };
/* Toujours renvoyer la résolution avec un réglage, sinon certains navigateurs la réduisent. */
async function keepSize(adv) {
  const s = track.getSettings();
  await track.applyConstraints({ width: { ideal: s.width || SIZE.width.ideal }, height: { ideal: s.height || SIZE.height.ideal }, advanced: [adv] });
  setTimeout(showCamInfo, 400);
}
function showCamInfo() {
  const w = video.videoWidth, h = video.videoHeight;
  $("#camInfo").textContent = w ? `Caméra ${w}×${h}${Math.min(w, h) < 1000 ? " · résolution faible, préférez « Photo HD »" : ""}` : "";
}
video.addEventListener("resize", showCamInfo);
$("#startCam").onclick = startCam;
$("#flipCam").onclick = () => { camIdx = (camIdx + 1) % cams.length; startCam(); };

/* ============ Lecture du numéro (OCR) ============ */
let worker = null, reading = false, reads = [];
async function getWorker() {
  if (worker) return worker;
  if (!window.Tesseract) throw new Error("ocr-missing");
  status("Préparation de la lecture (la première fois seulement)…");
  worker = await Tesseract.createWorker("eng");
  await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/- ", tessedit_pageseg_mode: "11" });
  return worker;
}
/* Découpe, agrandit et nettoie une zone d'image. mode 0 : contraste étiré ; 1 : noir et blanc (Otsu) ; 2 : idem inversé. */
function prep(src, sx, sy, sw, sh, mode, maxW = 1800) {
  const k = Math.min(3, maxW / sw);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length / 4;
  const g = new Uint8ClampedArray(n), hist = new Uint32Array(256);
  let lo = 255, hi = 0;
  for (let i = 0; i < n; i++) { const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++; if (v < lo) lo = v; if (v > hi) hi = v; }
  let thr = 128;
  if (mode > 0) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
      sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2;
      if (b > best) { best = b; thr = t; }
    }
  }
  const r = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    let v = mode === 0 ? (g[i] - lo) * r : (g[i] > thr ? 255 : 0);
    if (mode === 2) v = 255 - v;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function validPk(n, tot) {
  const t = +tot, v = parseInt(String(n).replace(/^(TG|GG|SV)/, ""), 10);
  return t >= 20 && t <= 400 && v >= 1 && v <= 500;
}
function pkHit(n, tot, setCode, lang, strong) {
  const number = /^\d+$/.test(n) ? String(+n) : n;
  return { game: "pokemon", number, total: +tot, setCode, lang, strong, code: (setCode ? setCode + " " : "") + (lang ? lang + " " : "") + `${n}/${tot}` };
}
const digits = s => s.replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
function parseCode(text) {
  let t = (" " + String(text).toUpperCase() + " ").replace(/[|\\]/g, "/").replace(/[–—_]/g, "-").replace(/[^A-Z0-9\/\- ]/g, " ").replace(/\s+/g, " ");
  // Confusions fréquentes de l'OCR : 0P→OP, 5T→ST, E8→EB, lettres lues à la place des chiffres
  t = t.replace(/(^|[^A-Z])0P(?=\s?[0-9O]{2})/g, "$1OP").replace(/(^|[^A-Z])5T(?=\s?[0-9O]{2})/g, "$1ST")
       .replace(/(^|[^A-Z])E8(?=\s?[0-9O]{2})/g, "$1EB").replace(/PR8/g, "PRB");
  t = t.replace(/(OP|ST|EB|PRB)(\s?-?\s?)([0-9OISB]{2})(\s?-?\s?)([0-9OISBZ]{3})/g, (_, a, b, c, d, e) => a + b + digits(c) + d + digits(e));
  t = t.replace(/(\s[A-Z]{3}\s?(?:EN|FR|DE|IT|ES|PT)\s?)([0-9OISBZ]{1,3}\s?\/?\s?[0-9OISBZ]{2,3})(?=[ \-]|$)/g, (_, a, b) => a + digits(b));
  t = t.replace(/(^|[ \-])([0-9OISBZ]{1,3})(\s?\/\s?)([0-9OISBZ]{2,3})(?=[ \-]|$)/g, (_, p, a, sl, b) => p + digits(a) + sl + digits(b));
  // One Piece : « OP05-119 » (le tiret est parfois perdu)
  let m = t.match(/(OP|ST|EB|PRB)\s?-?\s?(\d{2})\s?-?\s?(\d{3})(?!\d)/);
  if (m) return { game: "onepiece", code: `${m[1]}${m[2]}-${m[3]}`, strong: true };
  // Pokémon récent : « SVI FR 199/198 » (la barre est souvent perdue : « 199198 »)
  m = t.match(/(?:^|\s)([A-Z]{3})\s?(EN|FR|DE|IT|ES|PT)\s?((?:TG|GG|SV)?\d{1,3})\s?\/\s?(?:TG|GG|SV)?(\d{2,3})(?=\D|$)/)
    || t.match(/(?:^|\s)([A-Z]{3})\s?(EN|FR|DE|IT|ES|PT)\s?(\d{3})\s?(\d{3})(?=\D|$)/);
  if (m && validPk(m[3], m[4])) return pkHit(m[3], m[4], m[1], m[2], true);
  m = t.match(/(?:^|[^A-Z0-9])((?:TG|GG|SV)?\d{1,3})\s?\/\s?(?:TG|GG|SV)?(\d{2,3})(?=\D|$)/);
  if (m && validPk(m[1], m[2])) return pkHit(m[1], m[2], "", "", false);
  return null;
}
/* Un numéro « fort » (One Piece, ou Pokémon avec code d'extension) est accepté tout de suite ; sinon il doit être lu deux fois. */
function confirmRead(hit) {
  if (hit.strong) return true;
  const key = hit.game + hit.code; reads.push(key); reads = reads.slice(-6);
  return reads.filter(k => k === key).length >= 2;
}
function showRaw(raw, clear) { const r = String(raw || "").replace(/\s+/g, " ").trim(); if (r || clear) $("#ocrRaw").textContent = r ? "Lu : " + r.slice(0, 60) : ""; }
function guideInVideo() {
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
  const vb = video.getBoundingClientRect(), gb = $("#guide").getBoundingClientRect();
  const scale = Math.max(vb.width / vw, vb.height / vh);
  const offX = (vb.width - vw * scale) / 2, offY = (vb.height - vh * scale) / 2;
  return { x: (gb.left - vb.left - offX) / scale, y: (gb.top - vb.top - offY) / scale, w: gb.width / scale, h: gb.height / scale, vw, vh };
}
async function readLoop() {
  let tries = 0, mode = 0; reads = [];
  try {
    const w = await getWorker();
    $("#cam").classList.add("reading");
    while (reading) {
      tries++;
      const g = guideInVideo();
      if (g) {
        // 4 passages sur 5 : bande du bas du cadre. 1 sur 5 : toute la moitié basse de l'image, si la carte n'est pas bien placée.
        const wideZone = tries % 5 === 0;
        const sx = wideZone ? 0 : Math.max(0, g.x - g.w * 0.05), sw = wideZone ? g.vw : Math.min(g.vw - sx, g.w * 1.1);
        const sy = wideZone ? Math.max(0, g.y + g.h * 0.35) : Math.max(0, g.y + g.h * 0.72), sh = Math.min(g.vh - sy, wideZone ? g.h * 0.8 : g.h * 0.34);
        if (sw > 10 && sh > 10) {
          const { data } = await w.recognize(prep(video, sx, sy, sw, sh, wideZone ? 0 : mode, wideZone ? 1600 : 1800));
          if (!wideZone) mode = (mode + 1) % 3;
          if (!reading) return;
          showRaw(data.text);
          const hit = parseCode(data.text || "");
          if (hit && confirmRead(hit)) return found(hit);
        }
      }
      status(tries < 10 ? "Lecture en cours… tenez la carte immobile." : "Toujours rien : rapprochez-vous, essayez le zoom, ou prenez une « Photo HD ».");
      await sleep(100);
    }
  } catch (e) {
    stopReading();
    status(e?.message === "ocr-missing" ? "Le module de lecture n'a pas pu se charger. Tapez le numéro." : "La lecture a échoué. Réessayez ou tapez le numéro.", true);
  }
}
function stopReading() { reading = false; $("#cam").classList.remove("reading"); $("#scanBtn").textContent = "Lire le numéro"; }
$("#scanBtn").onclick = () => {
  if (reading) { stopReading(); status(""); return; }
  reading = true; $("#scanBtn").textContent = "Arrêter"; readLoop();
};
function found(hit) {
  stopReading(); showRaw("", true);
  if (navigator.vibrate) navigator.vibrate(60);
  status(`Numéro lu : ${hit.code}`);
  lookup(hit);
}
/* Photo HD : l'appareil photo natif donne une image bien plus nette que le flux vidéo. */
$("#photo").onchange = async e => {
  const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
  stopReading();
  try {
    const w = await getWorker();
    status("Analyse de la photo… (quelques secondes)");
    const bmp = await createImageBitmap(f);
    const W = bmp.width, H = bmp.height;
    const zones = [[0, H * 0.5, W, H * 0.5, 2400], [0, 0, W, H, 2200]];
    for (const [sx, sy, sw, sh, mw] of zones) for (const mode of [0, 1, 2]) {
      const { data } = await w.recognize(prep(bmp, sx, sy, sw, sh, mode, mw));
      showRaw(data.text);
      const hit = parseCode(data.text || "");
      if (hit) return found(hit);
    }
    status("Numéro introuvable sur la photo. Reprenez la carte de plus près, bien à plat, ou tapez le numéro.", true);
  } catch { status("Impossible de lire cette photo. Tapez le numéro.", true); }
};

/* ============ Recherche manuelle ============ */
$("#search").addEventListener("submit", e => {
  e.preventDefault();
  const raw = $("#q").value.trim(); if (!raw) return;
  const hit = parseCode(raw);
  if (hit) return lookup(hit);
  if (raw.length >= 3 && /[a-zà-ÿ]/i.test(raw)) return lookup({ game: "pokemon", name: raw, code: raw });
  status("Format non reconnu. Exemples : OP05-119, ST10-005, SVI FR 199/198, 25/102 ou un nom de Pokémon.", true);
});

/* ============ Sources de cotes ============ */
async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
async function fetchOnePiece(code) {
  const path = code.startsWith("ST") ? `decks/card/${code}/` : `sets/card/${code}/`;
  const data = await getJSON("https://optcgapi.com/api/" + path);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.map((o, i) => {
    const imgId = o.card_image_id || o.image_id || `${code}_${i}`;
    const name = o.card_name || o.name || code;
    const parallel = /_p\d|parallel|alt/i.test(imgId + " " + name);
    return {
      vid: "op:" + imgId, game: "onepiece", code, setCode: code.split("-")[0],
      name: name.replace(/\s*\((parallel|alternate art)\)\s*/i, ""),
      set: o.set_name || o.set || "", setDate: "", setSymbol: "", rarity: o.rarity || "",
      variant: parallel ? "Parallèle" : "Standard",
      img: o.card_image || o.image || "", imgLarge: o.card_image || o.image || "",
      refPrice: num(o.market_price ?? o.inventory_price), refCurrency: "USD", source: "TCGplayer",
      opColor: o.card_color || o.color || "", opType: o.card_type || o.type || "", cmUrl: ""
    };
  });
}
async function fetchPokemon(hit) {
  const sel = "id,name,number,rarity,set,images,cardmarket,supertype,types";
  const base = `https://api.pokemontcg.io/v2/cards?pageSize=36&select=${sel}&q=`;
  const q = s => getJSON(base + encodeURIComponent(s));
  let data = null;
  if (hit.name) data = await getJSON(base + encodeURIComponent(`name:"${hit.name.replace(/"/g, "")}*"`) + "&orderBy=-set.releaseDate");
  else {
    if (hit.setCode) data = await q(`number:${hit.number} set.ptcgoCode:${hit.setCode}`).catch(() => null);
    if (!data?.data?.length) data = await q(`number:${hit.number} set.printedTotal:${hit.total}`);
    if (!data?.data?.length) data = await q(`number:${hit.number} set.total:${hit.total}`);
  }
  const out = [];
  for (const c of data?.data || []) {
    const p = c.cardmarket?.prices || {};
    const common = {
      game: "pokemon", code: `${c.number}/${c.set?.printedTotal ?? "?"}`, number: c.number, total: c.set?.printedTotal,
      name: c.name, set: c.set?.name || "", setCode: c.set?.ptcgoCode || c.set?.id || "", setDate: (c.set?.releaseDate || "").replace(/\//g, "-"),
      setSymbol: c.set?.images?.symbol || "", rarity: c.rarity || "", img: c.images?.small || "", imgLarge: c.images?.large || c.images?.small || "",
      refCurrency: "EUR", source: "Cardmarket", cmUrl: c.cardmarket?.url || "", pkTypes: c.types || [], pkSuper: c.supertype || "", apiId: c.id
    };
    out.push({ ...common, vid: "pk:" + c.id, variant: "Normale", refPrice: num(p.trendPrice ?? p.averageSellPrice ?? p.avg30) });
    if (num(p.reverseHoloTrend)) out.push({ ...common, vid: "pk:" + c.id + ":rev", variant: "Reverse", refPrice: num(p.reverseHoloTrend) });
  }
  return out;
}
const cmLink = c => c.cmUrl || `https://www.cardmarket.com/fr/${GAME[c.game].cm}/Products/Search?searchString=${encodeURIComponent(c.name + (c.game === "onepiece" ? " " + c.code : ""))}`;

/* ============ Propositions : version, langue, prix ============ */
let versions = [], chosen = null, pick = { lang: "FR" };
async function lookup(hit) {
  $("#results").innerHTML = ""; versions = []; chosen = null;
  pick = { lang: hit.lang || "FR" };
  status(`Recherche de ${hit.code}…`);
  try {
    versions = hit.game === "onepiece" ? await fetchOnePiece(hit.code) : await fetchPokemon(hit);
  } catch {
    status("Source de cote injoignable pour le moment.", true);
    $("#results").innerHTML = `<p class="note">Vous pouvez vérifier la cote directement sur <a href="https://www.cardmarket.com/fr/${GAME[hit.game].cm}/Products/Search?searchString=${encodeURIComponent(hit.number || hit.code)}" target="_blank" rel="noopener">Cardmarket</a>.</p>`;
    return;
  }
  if (!versions.length) { status(`Aucune carte trouvée pour ${hit.code}. Vérifiez le numéro.`, true); return; }
  status(versions.length === 1 ? "Carte trouvée." : `${versions.length} versions correspondent : choisissez la vôtre.`);
  if (versions.length === 1) chosen = versions[0];
  renderVersions();
  $("#results").scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
}
function renderVersions() {
  const el = $("#results");
  el.innerHTML = (versions.length > 1 ? `<h2 class="pick-title">Quelle version avez-vous ?</h2><p class="pick-sub">Comparez l'illustration, le symbole d'extension et la brillance.</p>` : "")
    + `<div class="versions">${versions.map(v => `
      <button class="version" type="button" data-vid="${esc(v.vid)}" aria-pressed="${chosen?.vid === v.vid}">
        <img class="art" src="${esc(v.img)}" alt="${esc(v.name)}" loading="lazy">
        <span class="v-name">${esc(v.name)}</span>
        <span class="v-set">${v.setSymbol ? `<img src="${esc(v.setSymbol)}" alt="">` : ""}${esc(v.set || v.setCode)}</span>
        <span class="v-set">${esc([v.code, v.variant, v.rarity].filter(Boolean).join(" · "))}</span>
        <span class="v-price">${money(v.refPrice, v.refCurrency)}</span>
      </button>`).join("")}</div><div id="config"></div>`;
  $$(".version", el).forEach(b => b.onclick = () => {
    chosen = versions.find(v => v.vid === b.dataset.vid);
    $$(".version", el).forEach(x => x.setAttribute("aria-pressed", x === b));
    renderConfig(); $("#config").scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
  });
  renderConfig();
}
function langNote(game, lang) {
  if (lang === "JP") return "Les cartes japonaises ont leur propre marché, souvent très différent : vérifiez le prix.";
  if (game === "onepiece" && lang !== "EN") return "Cote du marché anglophone : ajustez si votre version se vend autrement.";
  return "La cote de référence vaut pour toutes les langues. Ajustez si votre version se vend plus ou moins cher.";
}
function langChips(game, current) {
  return LANGS_BY_GAME[game].map(l => `<button type="button" class="chip mono" data-lang="${l}" aria-pressed="${l === current}" title="${LANGS[l]}">${l}</button>`).join("");
}
function priceFields(prefix, price, cur) {
  return `<div class="price-in"><input type="number" id="${prefix}Price" inputmode="decimal" step="0.01" min="0" value="${price ?? ""}" placeholder="0,00">
    <select id="${prefix}Cur" aria-label="Devise"><option value="EUR"${cur === "EUR" ? " selected" : ""}>€</option><option value="USD"${cur === "USD" ? " selected" : ""}>$</option></select></div>`;
}
function renderConfig() {
  const box = $("#config"); if (!box) return;
  if (!chosen) { box.innerHTML = ""; return; }
  const c = chosen;
  box.innerHTML = `<div class="config">
    <div class="cfg-row"><span class="cfg-label">Langue de votre carte</span><div class="chips" id="pLang">${langChips(c.game, pick.lang)}</div></div>
    <div class="cfg-row"><label class="cfg-label" for="pPrice">Prix de votre exemplaire</label>${priceFields("p", c.refPrice, c.refCurrency)}
      <p class="note">Cote ${esc(c.source)} : <b>${money(c.refPrice, c.refCurrency)}</b>. <span id="pNote">${langNote(c.game, pick.lang)}</span></p></div>
    <div class="row"><button class="btn primary" id="addBtn" type="button">Ajouter au classeur</button>
      <a class="btn" href="${esc(cmLink(c))}" target="_blank" rel="noopener">Comparer sur Cardmarket</a></div>
  </div>`;
  $$("#pLang .chip").forEach(b => b.onclick = () => {
    pick.lang = b.dataset.lang;
    $$("#pLang .chip").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("#pNote").textContent = langNote(c.game, pick.lang);
    $("#pNote").parentElement.classList.toggle("warn", pick.lang === "JP");
  });
  $("#addBtn").onclick = () => {
    const price = num(String($("#pPrice").value).replace(",", "."));
    const cur = $("#pCur").value;
    const { ...base } = c;
    addToColl({ ...base, lang: pick.lang, price, currency: cur, priceManual: price !== c.refPrice || cur !== c.refCurrency });
    status(`${c.name} (${pick.lang}) rangée dans le classeur.`);
    $("#results").innerHTML = ""; versions = []; chosen = null; $("#q").value = "";
  };
}

/* ============ Collection (stockage local) ============ */
const KEY = "cotecarte.collection.v1";
let coll = store.get(KEY, []);
function migrate(c) {
  if (c.refPrice === undefined) { c.refPrice = c.price ?? null; c.refCurrency = c.currency || "EUR"; c.priceManual = false; }
  if (!c.currency) c.currency = c.refCurrency || "EUR";
  if (c.lang === undefined) c.lang = null;
  if (!c.id) c.id = c.vid + "|" + (c.lang || "?");
  if (!c.qty) c.qty = 1;
  return c;
}
coll = Array.isArray(coll) ? coll.filter(c => c && c.vid && GAME[c.game]).map(migrate) : [];
function save() { if (!store.set(KEY, coll)) status("Stockage plein ou bloqué : exportez votre classeur.", true); }
function addToColl(v) {
  const id = v.vid + "|" + (v.lang || "?");
  const twin = coll.find(c => c.id === id);
  if (twin) { twin.qty++; if (v.priceManual) { twin.price = v.price; twin.currency = v.currency; twin.priceManual = true; } }
  else coll.push({ ...v, id, qty: 1, added: Date.now(), priced: Date.now() });
  save(); renderStats();
}
const eurValue = c => c.price == null ? 0 : c.price * (c.currency === "USD" ? USD_EUR : 1);
function renderStats() {
  $("#sCount").textContent = coll.reduce((s, c) => s + c.qty, 0);
  $("#sEur").textContent = money(coll.filter(c => c.currency !== "USD").reduce((s, c) => s + (c.price || 0) * c.qty, 0), "EUR");
  $("#sUsd").textContent = money(coll.filter(c => c.currency === "USD").reduce((s, c) => s + (c.price || 0) * c.qty, 0), "USD");
}

/* ============ Classement ============ */
const RANK = ["sec", "manga", "special illustration", "hyper", "sp", "ultra", "illustration", "double", "sr", "l", "leader", "rare holo", "r", "rare", "uc", "uncommon", "c", "common", "p", "promo"];
const rRank = r => { r = (r || "").toLowerCase(); const i = RANK.findIndex(k => r === k || r.startsWith(k + " ") || r.startsWith(k)); return i < 0 ? 99 : i; };
function hueColor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 55% 48%)`; }
function typeOf(c) {
  if (c.game === "pokemon") {
    if (/trainer/i.test(c.pkSuper)) return { label: "Dresseur", color: "#6F7C8A", order: 20 };
    if (/energy/i.test(c.pkSuper)) return { label: "Énergie", color: "#95A0AE", order: 21 };
    const t = (c.pkTypes || [])[0];
    if (t && PK_TYPES[t]) return { label: PK_TYPES[t][0], color: PK_TYPES[t][1], order: Object.keys(PK_TYPES).indexOf(t) };
    return { label: "Type à compléter", color: "#7A8299", order: 99 };
  }
  const cols = String(c.opColor || "").split(/[\s\/,;]+/).filter(w => OP_COLORS[w]);
  if (!cols.length) return { label: "Couleur à compléter", color: "#7A8299", order: 99 };
  return { label: cols.map(w => OP_COLORS[w][0]).join(" / "), color: OP_COLORS[cols[0]][1], order: 30 + Object.keys(OP_COLORS).indexOf(cols[0]) + (cols.length > 1 ? 0.5 : 0) };
}
const opSetSort = code => { const m = /^(OP|EB|ST|PRB)(\d+)/.exec(code || ""); return m ? ({ OP: 1, EB: 2, PRB: 3, ST: 4 }[m[1]]) + String(m[2]).padStart(3, "0") : "9"; };
const VALUE_BUCKETS = [[100, "100 € et plus"], [20, "De 20 à 100 €"], [5, "De 5 à 20 €"], [1, "De 1 à 5 €"], [0.0001, "Moins de 1 €"], [-1, "Sans prix"]];
function groupOf(c, by) {
  switch (by) {
    case "type": { const t = typeOf(c); return { key: "t" + t.label, label: t.label, sort: String(t.order).padStart(5, "0"), color: t.color }; }
    case "rarete": return { key: "r" + (c.rarity || "?"), label: c.rarity || "Rareté inconnue", sort: String(rRank(c.rarity)).padStart(3, "0") + (c.rarity || ""), color: hueColor(c.rarity || "?") };
    case "valeur": { const v = c.price == null ? -1 : eurValue(c); const i = VALUE_BUCKETS.findIndex(([min]) => v >= min); return { key: "v" + i, label: VALUE_BUCKETS[i][1], sort: String(i), color: ["#E8B931", "#3CCBDD", "#4CC38A", "#8B7CF6", "#8E98B0", "#5A6378"][i] }; }
    case "langue": return { key: "l" + (c.lang || "?"), label: LANGS[c.lang] || "Langue à préciser", sort: String(Object.keys(LANGS).indexOf(c.lang) + 1 || 99).padStart(2, "0"), color: hueColor("lang" + c.lang) };
    case "jeu": return { key: "g" + c.game, label: GAME[c.game].label, sort: c.game, color: c.game === "pokemon" ? "#E0AE14" : "#D7263D" };
    default: return { key: "s" + (c.setCode || c.set), label: c.set || c.setCode || "Série inconnue", sort: c.game === "pokemon" ? "1" + (c.setDate || "9999") : "2" + opSetSort(c.setCode), color: hueColor(c.set || c.setCode) };
  }
}
const numPart = c => {
  const s = c.game === "onepiece" ? String(c.code || "").split("-").pop() : String(c.number ?? String(c.code || "").split("/")[0]);
  return parseInt(s.replace(/\D/g, ""), 10) || 0;
};
function withinGroup(by) {
  if (by === "valeur") return (a, b) => eurValue(b) - eurValue(a);
  return (a, b) => (a.game.localeCompare(b.game)) || String(a.setDate || a.setCode || "").localeCompare(String(b.setDate || b.setCode || "")) || (numPart(a) - numPart(b)) || a.name.localeCompare(b.name, "fr");
}

/* ============ Classeur virtuel ============ */
const bState = Object.assign({ game: "all", groupBy: "serie", showPrices: true }, store.get("cotecarte.binder", {}));
let seq = [], groups = [], pos = 0, flipping = false, contentOffset = 1, wasWide = wideMQ.matches;
const PER_PAGE = 9;
function saveBState() { store.set("cotecarte.binder", { game: bState.game, groupBy: bState.groupBy, showPrices: bState.showPrices }); }
function buildPages() {
  const items = coll.filter(c => bState.game === "all" || c.game === bState.game);
  const map = new Map();
  for (const c of items) { const g = groupOf(c, bState.groupBy); if (!map.has(g.key)) map.set(g.key, { ...g, items: [] }); map.get(g.key).items.push(c); }
  groups = [...map.values()].sort((a, b) => a.sort.localeCompare(b.sort, "fr", { numeric: true }) || a.label.localeCompare(b.label, "fr"));
  const pages = [];
  groups.forEach((g, gi) => {
    g.items.sort(withinGroup(bState.groupBy));
    g.count = g.items.reduce((s, c) => s + c.qty, 0);
    g.value = g.items.reduce((s, c) => s + eurValue(c) * c.qty, 0);
    g.firstPage = pages.length;
    for (let i = 0; i < g.items.length; i += PER_PAGE) pages.push({ kind: "page", g, gi, first: i === 0, items: g.items.slice(i, i + PER_PAGE) });
  });
  pages.forEach((p, i) => { p.num = i + 1; p.total = pages.length; });
  return pages;
}
function buildBinder(keep = false) {
  const wide = wideMQ.matches;
  const prevContent = keep ? currentContentIndex() : null;
  const pages = buildPages();
  const content = pages.length ? pages : [{ kind: "empty" }];
  seq = wide ? [{ kind: "void" }, { kind: "cover" }, { kind: "inner" }, ...content] : [{ kind: "cover" }, ...content];
  if (wide && seq.length % 2) seq.push({ kind: "blank" });
  contentOffset = wide ? 3 : 1;
  if (prevContent != null && prevContent >= 0) pos = posForSeq(contentOffset + Math.min(prevContent, content.length - 1));
  else pos = Math.min(pos, maxPos());
  wasWide = wide;
  renderSpread(); renderDividers(); renderStats();
}
const maxPos = () => wideMQ.matches ? seq.length / 2 - 1 : seq.length - 1;
const posForSeq = i => wideMQ.matches ? Math.floor(i / 2) : i;
function currentContentIndex() { const i = (wasWide ? pos * 2 + 1 : pos) - (wasWide ? 3 : 1); return i < 0 ? -1 : i; }
function coverHTML() {
  const g = GAME[bState.game], items = coll.filter(c => bState.game === "all" || c.game === bState.game);
  const n = items.reduce((s, c) => s + c.qty, 0);
  return `<div class="pg cover" style="--cv:${g.cover};--cv-hi:${g.hi}" role="button" tabindex="0" aria-label="Ouvrir le classeur">
    <div class="cover-in"><span class="cover-brand">Cotecarte</span><span class="cover-title">${esc(g.title)}</span>
    <span class="cover-sub">${n} carte${n > 1 ? "s" : ""} · ${groups.length} intercalaire${groups.length > 1 ? "s" : ""}</span><span class="cover-open">Toucher pour ouvrir</span></div><div class="strap"></div></div>`;
}
function innerHTML() {
  const g = GAME[bState.game];
  return `<div class="pg inner" style="--cv:${g.cover}"><h3>Sommaire</h3><ol class="toc">${groups.slice(0, 18).map(x =>
    `<li style="--c:${x.color}"><i></i><span>${esc(x.label)}</span><b>p. ${x.firstPage + 1}</b></li>`).join("") || "<li><span>Aucune carte pour l'instant.</span></li>"}
    ${groups.length > 18 ? `<li><span>… et ${groups.length - 18} autres</span></li>` : ""}</ol></div>`;
}
function pocketHTML(c) {
  const price = c.price == null ? "" : money(c.price, c.currency);
  return `<button class="pocket" type="button" data-id="${esc(c.id)}" aria-label="${esc(c.name)}${c.lang ? " " + c.lang : ""}${price ? ", " + price : ""}">
    <span class="pname">${esc(c.name)}</span><img src="${esc(c.img)}" alt="" loading="lazy" draggable="false" onerror="this.remove()">
    ${c.qty > 1 ? `<span class="qtyb">×${c.qty}</span>` : ""}${bState.showPrices && price ? `<span class="pp">${price}${c.lang && c.lang !== "FR" ? " · " + c.lang : ""}</span>` : ""}</button>`;
}
function pageHTML(p, side = "right") {
  if (!p || p.kind === "blank") return `<div class="pg sheet ${side}"><div></div><div class="pockets">${'<div class="pocket empty"></div>'.repeat(PER_PAGE)}</div><div></div></div>`;
  if (p.kind === "void") return `<div class="pg void"></div>`;
  if (p.kind === "cover") return coverHTML();
  if (p.kind === "inner") return innerHTML();
  if (p.kind === "back") return backHTML(p.of);
  if (p.kind === "empty") return `<div class="pg sheet ${side} empty-page"><strong>Classeur vide</strong><p>Scannez une carte, choisissez sa version et sa langue, puis « Ajouter au classeur ».</p><a class="btn primary small" href="#scan">Scanner une carte</a></div>`;
  const g = p.g, slots = [...p.items.map(pocketHTML)];
  while (slots.length < PER_PAGE) slots.push('<div class="pocket empty"></div>');
  return `<div class="pg sheet ${side}" style="--tab:${g.color}">
    ${p.first ? `<div class="tab" style="top:${6 + (p.gi % 5) * 18}%"><span>${esc(g.label)}</span></div>` : ""}
    <header class="pg-head"><b>${esc(g.label)}</b><span>${p.first ? `${g.count} carte${g.count > 1 ? "s" : ""}${g.value ? " · " + money(g.value) : ""}` : "suite"}</span></header>
    <div class="pockets">${slots.join("")}</div>
    <footer class="pg-foot">${p.num} / ${p.total}</footer></div>`;
}
/* Verso d'une feuille : on voit le dos des cartes, en miroir. */
function backHTML(p) {
  if (!p) return pageHTML({ kind: "blank" }, "left");
  if (p.kind === "cover") return innerHTML();
  if (p.kind !== "page") return pageHTML({ kind: "blank" }, "left");
  const cells = [];
  for (let r = 0; r < 3; r++) for (let col = 2; col >= 0; col--) cells.push(p.items[r * 3 + col] ? '<div class="pocket cb"></div>' : '<div class="pocket empty"></div>');
  return `<div class="pg sheet left"><div></div><div class="pockets">${cells.join("")}</div><div></div></div>`;
}
function renderSpread() {
  const sp = $("#spread"), wide = wideMQ.matches;
  if (wide) {
    sp.className = "spread wide" + (pos === 0 ? " closed" : "");
    sp.innerHTML = `<div class="slot left">${pageHTML(seq[2 * pos], "left")}</div><div class="slot right">${pageHTML(seq[2 * pos + 1], "right")}</div><div class="spine"></div><div class="rings"><i></i><i></i><i></i></div>`;
  } else {
    sp.className = "spread";
    sp.innerHTML = `<div class="slot right">${pageHTML(seq[pos], "right")}</div>${pos > 0 ? '<div class="rings"><i></i><i></i><i></i></div>' : ""}`;
  }
  updatePager();
}
function updatePager() {
  const wide = wideMQ.matches, max = maxPos();
  $("#prev").disabled = pos <= 0 || flipping; $("#next").disabled = pos >= max || flipping;
  const total = seq.filter(p => p.kind === "page").length;
  const shown = (wide ? [seq[2 * pos], seq[2 * pos + 1]] : [seq[pos]]).filter(p => p?.kind === "page").map(p => p.num);
  let label;
  if (pos === 0) label = "Couverture";
  else if (!shown.length) label = total ? "Fin du classeur" : "Classeur vide";
  else label = (wide && pos === 1 ? "Sommaire · " : "") + (shown.length > 1 ? `Pages ${shown[0]}–${shown[1]}` : `Page ${shown[0]}`) + ` / ${total}`;
  $("#pageNum").textContent = label;
  const cur = currentGroupIndex();
  $$(".dv").forEach(d => d.setAttribute("aria-current", +d.dataset.gi === cur));
}
function currentGroupIndex() {
  const wide = wideMQ.matches;
  const p = wide ? (seq[2 * pos + 1]?.kind === "page" ? seq[2 * pos + 1] : seq[2 * pos]) : seq[pos];
  return p?.kind === "page" ? p.gi : -1;
}
function renderDividers() {
  const nav = $("#dividers");
  nav.innerHTML = groups.map((g, gi) => `<button class="dv" type="button" data-gi="${gi}" style="--c:${g.color}">${esc(g.label)} <span>${g.count}</span></button>`).join("");
  nav.hidden = !groups.length;
  $$(".dv", nav).forEach(b => b.onclick = () => jumpTo(contentOffset + groups[+b.dataset.gi].firstPage));
  updatePager();
}
function jumpTo(seqIndex) {
  if (flipping) return;
  pos = posForSeq(seqIndex); renderSpread();
  const sp = $("#spread"); sp.classList.add("jump"); setTimeout(() => sp.classList.remove("jump"), 300);
  $(".dv[aria-current=true]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
}
function rectOf(el) { return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }; }
function makeLeaf(r, front, back, origin) {
  const layer = document.createElement("div"); layer.className = "flip-layer";
  const leaf = document.createElement("div"); leaf.className = "leaf";
  leaf.style.cssText = `left:${r.left}px;top:${r.top + 90}px;width:${r.width}px;height:${r.height}px;transform-origin:${origin}`;
  leaf.innerHTML = `<div class="face front">${front}<i class="shade"></i></div><div class="face back">${back}<i class="shade"></i></div>`;
  layer.append(leaf); $("#spread").append(layer);
  return { layer, leaf };
}
async function turn(leaf, from, to) {
  const o = { duration: 720, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" };
  const mid = (from + to) / 2;
  const a = leaf.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${mid}deg) translateZ(18px)` }, { transform: `rotateY(${to}deg)` }], o);
  const opening = Math.abs(to) < Math.abs(from);
  leaf.querySelector(".front .shade").animate([{ opacity: opening ? .5 : 0 }, { opacity: opening ? 0 : .5 }], o);
  leaf.querySelector(".back .shade").animate([{ opacity: opening ? 0 : .5 }, { opacity: opening ? .5 : 0 }], o);
  await a.finished;
}
async function flip(dir) {
  if (flipping) return;
  const target = pos + dir;
  if (target < 0 || target > maxPos()) return;
  if (reduceMotion.matches) { pos = target; renderSpread(); return; }
  flipping = true; updatePager();
  const sp = $("#spread");
  try {
    if (wideMQ.matches) {
      const L = $(".slot.left", sp), R = $(".slot.right", sp);
      if (dir > 0) {
        const { layer, leaf } = makeLeaf(rectOf(R), pageHTML(seq[2 * pos + 1], "right"), pageHTML(seq[2 * pos + 2], "left"), "left center");
        R.innerHTML = pageHTML(seq[2 * pos + 3], "right");
        if (pos === 0) sp.classList.remove("closed");
        await turn(leaf, 0, -180); layer.remove();
      } else {
        const { layer, leaf } = makeLeaf(rectOf(L), pageHTML(seq[2 * pos], "left"), pageHTML(seq[2 * pos - 1], "right"), "right center");
        L.innerHTML = pageHTML(seq[2 * pos - 2], "left");
        if (pos === 1) sp.classList.add("closed");
        await turn(leaf, 0, 180); layer.remove();
      }
    } else {
      const S = $(".slot.right", sp);
      if (dir > 0) {
        const { layer, leaf } = makeLeaf(rectOf(S), pageHTML(seq[pos], "right"), backHTML(seq[pos]), "left center");
        S.innerHTML = pageHTML(seq[pos + 1], "right");
        await turn(leaf, 0, -180); layer.remove();
      } else {
        const { layer, leaf } = makeLeaf(rectOf(S), pageHTML(seq[pos - 1], "right"), backHTML(seq[pos - 1]), "left center");
        await turn(leaf, -180, 0); layer.remove();
      }
    }
    pos = target;
  } finally { flipping = false; renderSpread(); }
}
$("#prev").onclick = () => flip(-1);
$("#next").onclick = () => flip(1);
document.addEventListener("keydown", e => {
  if ($("#v-classeur").hidden || $("#sheet").open || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === "ArrowRight") flip(1); else if (e.key === "ArrowLeft") flip(-1);
});
/* Glisser pour tourner les pages */
const binderEl = $("#binder");
let sx = null, sy = null, dragged = false;
binderEl.addEventListener("pointerdown", e => { sx = e.clientX; sy = e.clientY; dragged = false; });
binderEl.addEventListener("pointermove", e => { if (sx != null && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) dragged = true; });
binderEl.addEventListener("pointercancel", () => { sx = null; });
binderEl.addEventListener("pointerup", e => {
  if (sx == null) return;
  const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) flip(dx < 0 ? 1 : -1);
});
binderEl.addEventListener("click", e => {
  if (dragged) { dragged = false; return; }
  const pk = e.target.closest(".pocket[data-id]");
  if (pk) return openSheet(pk.dataset.id);
  if (e.target.closest(".cover")) flip(1);
});
binderEl.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.closest(".cover")) { e.preventDefault(); flip(1); } });

$$(".binder-head .chip").forEach(b => b.onclick = () => {
  bState.game = b.dataset.game; saveBState();
  $$(".binder-head .chip").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#groupBy").querySelector('[value="jeu"]').hidden = bState.game !== "all";
  if (bState.game !== "all" && bState.groupBy === "jeu") { bState.groupBy = "serie"; $("#groupBy").value = "serie"; }
  pos = 0; buildBinder();
});
$("#groupBy").onchange = e => { bState.groupBy = e.target.value; saveBState(); buildBinder(); pos = Math.min(posForSeq(contentOffset), maxPos()); renderSpread(); };
$("#showPrices").onchange = e => { bState.showPrices = e.target.checked; saveBState(); renderSpread(); };
wideMQ.addEventListener("change", () => { if (!$("#v-classeur").hidden) buildBinder(true); });

/* ============ Fiche d'une carte ============ */
function openSheet(id) {
  const c = coll.find(x => x.id === id); if (!c) return;
  const d = $("#sheet"), t = typeOf(c);
  let lang = c.lang, qty = c.qty, confirmDel = false;
  d.innerHTML = `<form method="dialog" class="sheet-in">
    <button class="x" value="close" aria-label="Fermer">×</button>
    <img class="big" src="${esc(c.imgLarge || c.img)}" alt="${esc(c.name)}">
    <div class="sheet-body">
      <div class="tags"><span class="tag ${GAME[c.game].cls}">${GAME[c.game].label}</span>${t.order < 99 ? `<span class="tag"><i style="background:${t.color}"></i>${esc(t.label)}</span>` : ""}${c.rarity ? `<span class="tag">${esc(c.rarity)}</span>` : ""}${c.variant && !/^(standard|normale)$/i.test(c.variant) ? `<span class="tag">${esc(c.variant)}</span>` : ""}</div>
      <h2>${esc(c.name)}</h2><p class="code">${esc([c.code, c.set].filter(Boolean).join(" · "))}</p>
      <div class="cfg-row"><span class="cfg-label">Langue</span><div class="chips" id="sLang">${langChips(c.game, lang)}</div></div>
      <div class="cfg-row"><label class="cfg-label" for="sPrice">Prix de votre exemplaire</label>${priceFields("s", c.price, c.currency)}
        <p class="note">Cote ${esc(c.source)} : <b>${money(c.refPrice, c.refCurrency)}</b>${c.priced ? ` · relevée le ${new Date(c.priced).toLocaleDateString("fr-FR")}` : ""}. <button type="button" class="del" id="sRef" style="color:var(--accent);padding:0">Reprendre la cote</button></p></div>
      <div class="cfg-row"><span class="cfg-label">Exemplaires</span><div class="qty"><button type="button" id="sMinus" aria-label="Retirer un exemplaire">−</button><span id="sQty">${qty}</span><button type="button" id="sPlus" aria-label="Ajouter un exemplaire">+</button></div></div>
      <div class="row"><button type="button" class="btn primary" id="sSave">Enregistrer</button><a class="btn" href="${esc(cmLink(c))}" target="_blank" rel="noopener">Comparer sur Cardmarket</a></div>
      <button type="button" class="del" id="sDel">Retirer du classeur</button>
    </div></form>`;
  $$("#sLang .chip", d).forEach(b => b.onclick = () => { lang = b.dataset.lang; $$("#sLang .chip", d).forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("#sMinus", d).onclick = () => { qty = Math.max(1, qty - 1); $("#sQty", d).textContent = qty; };
  $("#sPlus", d).onclick = () => { qty++; $("#sQty", d).textContent = qty; };
  $("#sRef", d).onclick = () => { $("#sPrice", d).value = c.refPrice ?? ""; $("#sCur", d).value = c.refCurrency || "EUR"; };
  $("#sSave", d).onclick = () => {
    const price = num(String($("#sPrice", d).value).replace(",", ".")), cur = $("#sCur", d).value;
    const newId = c.vid + "|" + (lang || "?");
    const twin = newId !== c.id ? coll.find(x => x.id === newId) : null;
    Object.assign(c, { lang, price, currency: cur, priceManual: price !== c.refPrice || cur !== c.refCurrency, qty });
    if (twin) { twin.qty += c.qty; coll = coll.filter(x => x !== c); } else c.id = newId;
    save(); d.close(); buildBinder(true);
  };
  $("#sDel", d).onclick = e => {
    if (!confirmDel) { confirmDel = true; e.target.textContent = "Confirmer : retirer cette carte"; return; }
    coll = coll.filter(x => x !== c); save(); d.close(); buildBinder(true);
  };
  d.showModal();
}
$("#sheet").addEventListener("click", e => { if (e.target === $("#sheet")) $("#sheet").close(); });

/* ============ Mise à jour des cotes et des infos ============ */
async function freshVersions(c) {
  return c.game === "onepiece" ? fetchOnePiece(c.code)
    : fetchPokemon({ number: c.number || String(c.code).split("/")[0], total: +(c.total || String(c.code).split("/")[1]), setCode: "" });
}
function applyFresh(c, f) {
  for (const k of ["set", "setCode", "setDate", "setSymbol", "rarity", "img", "imgLarge", "cmUrl", "pkTypes", "pkSuper", "opColor", "opType", "number", "total"]) if (f[k] !== undefined && f[k] !== "") c[k] = f[k];
  if (f.refPrice != null) { c.refPrice = f.refPrice; c.refCurrency = f.refCurrency; c.priced = Date.now(); if (!c.priceManual) { c.price = f.refPrice; c.currency = f.refCurrency; } }
}
$("#refresh").onclick = async () => {
  const btn = $("#refresh"); if (!coll.length) return;
  btn.disabled = true; let done = 0, fails = 0;
  for (const c of coll) {
    btn.textContent = `Actualisation ${++done}/${coll.length}…`;
    try { const f = (await freshVersions(c)).find(v => v.vid === c.vid); if (f) applyFresh(c, f); else fails++; } catch { fails++; }
    await sleep(350);
  }
  save(); buildBinder(true); btn.disabled = false; btn.textContent = "Actualiser les prix";
  status(fails ? `Cotes actualisées, ${fails} carte(s) sans réponse.` : "Toutes les cotes sont à jour.", !!fails);
};
/* Complète en arrière-plan les cartes ajoutées avant l'arrivée des types et couleurs. */
let enriching = false;
async function autoEnrich() {
  if (enriching) return;
  const todo = coll.filter(c => (c.game === "pokemon" && c.pkSuper === undefined) || (c.game === "onepiece" && c.opColor === undefined));
  if (!todo.length) return;
  enriching = true;
  for (const c of todo) {
    try { const f = (await freshVersions(c)).find(v => v.vid === c.vid); if (f) applyFresh(c, f); else { c.pkSuper ??= ""; c.opColor ??= ""; } } catch { }
    await sleep(500);
  }
  save(); enriching = false;
  if (!$("#v-classeur").hidden && !flipping) buildBinder(true);
}
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
    for (const r of rows) if (r?.vid && GAME[r.game]) {
      const it = migrate({ ...r }); const t = coll.find(c => c.id === it.id);
      if (t) t.qty = Math.max(t.qty, it.qty); else { coll.push(it); n++; }
    }
    save(); buildBinder(true); autoEnrich(); status(`${n} carte(s) importée(s).`);
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
      <h3>${esc(r.t)}</h3><p>${esc(r.n)}</p><span class="when">${when}</span></div></article>`;
  }).join("");
}

/* ============ Démarrage ============ */
$$(".binder-head .chip").forEach(x => x.setAttribute("aria-pressed", x.dataset.game === bState.game));
$("#groupBy").value = bState.groupBy;
$("#groupBy").querySelector('[value="jeu"]').hidden = bState.game !== "all";
$("#showPrices").checked = bState.showPrices;
route(); renderRel(); renderStats();
if (!navigator.mediaDevices?.getUserMedia) {
  $("#camOff").innerHTML = "<p>Ce navigateur ne donne pas accès à la caméra en direct.</p><p class='fine'>Utilisez « Photo HD » ou tapez le numéro.</p>";
}
