/* Construit l'index de reconnaissance de toutes les cartes Pokémon (TCGdex) et One Piece (OPTCG API).
   Lancé chaque semaine par GitHub Actions : node build/build-index.mjs [--limit=N]
   Sortie : index/ (vec.bin, hash.bin, pca.bin, meta.json, sets.json, info.json) */
import fs from "node:fs";
import { decode, writeIndex, FP } from "./lib.mjs";

const LIMIT = +(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || 0);
const OUT = "index";
const UA = { "User-Agent": "Cotecarte-index-builder (github.com/Paire2sky/Cotecarte)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch { }
    await sleep(1000 * (t + 1));
  }
  return null;
}
async function getBuf(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return Buffer.from(await r.arrayBuffer()); if (r.status === 404) return null; } catch { }
    await sleep(800 * (t + 1));
  }
  return null;
}

/* ---------- Liste des cartes ---------- */
async function pokemonItems() {
  const items = [], sets = {};
  const en = (await getJSON("https://api.tcgdex.net/v2/en/sets")) || [];
  for (const s of en) sets[s.id] = { n: s.name, o: s.cardCount?.official ?? null, g: 0 };
  const enCards = (await getJSON("https://api.tcgdex.net/v2/en/cards")) || [];
  for (const c of enCards) if (c.image) items.push({ g: 0, id: c.id, name: c.name, set: c.id.slice(0, c.id.lastIndexOf("-")), local: c.localId, img: c.image, lang: "en" });
  // Sets japonais absents de la base anglaise (ex. sets exclusifs)
  const jaSets = (await getJSON("https://api.tcgdex.net/v2/ja/sets")) || [];
  const missing = new Set(jaSets.filter(s => !sets[s.id]).map(s => s.id));
  for (const s of jaSets) if (missing.has(s.id)) sets[s.id] = { n: s.name, o: s.cardCount?.official ?? null, g: 0, ja: 1 };
  if (missing.size) {
    const jaCards = (await getJSON("https://api.tcgdex.net/v2/ja/cards")) || [];
    for (const c of jaCards) { const sid = c.id.slice(0, c.id.lastIndexOf("-")); if (c.image && missing.has(sid)) items.push({ g: 0, id: c.id, name: c.name, set: sid, local: c.localId, img: c.image, lang: "ja" }); }
  }
  console.log(`Pokémon : ${items.length} cartes, ${Object.keys(sets).length} sets`);
  return { items, sets };
}
async function onePieceItems() {
  const items = [], sets = {}, seen = new Set();
  for (const ep of ["allSetCards", "allSTCards", "allPromoCards"]) {
    const rows = (await getJSON(`https://optcgapi.com/api/${ep}/`)) || [];
    for (const o of rows) {
      const code = o.card_set_id || o.card_id, img = o.card_image, imgId = o.card_image_id || code;
      if (!code || !img || seen.has(imgId)) continue; seen.add(imgId);
      const sid = String(code).split("-")[0];
      sets[sid] ??= { n: o.set_name || sid, o: null, g: 1 };
      items.push({ g: 1, id: imgId, name: o.card_name || code, set: sid, local: code, img, lang: "en" });
    }
  }
  console.log(`One Piece : ${items.length} cartes`);
  return { items, sets };
}

/* ---------- Empreintes ---------- */
async function main() {
  const pk = await pokemonItems(), op = await onePieceItems();
  let all = [...pk.items, ...op.items];
  if (LIMIT) all = all.slice(0, LIMIT);
  const entries = []; let done = 0, fail = 0;
  const queue = all.slice();
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      const url = it.g === 0 ? it.img + "/low.webp" : it.img;
      const buf = await getBuf(url);
      if (buf) {
        try {
          const { rgba, w, h } = await decode(buf);
          const d = FP.describe(rgba, w, h);
          entries.push({ desc: d.desc, hash: d.hash, border: d.border, meta: [it.g, it.id, it.name, it.set, it.local, it.img, it.lang, d.border.cls] });
        } catch { fail++; }
      } else fail++;
      if (++done % 500 === 0) console.log(`${done}/${all.length} (${fail} échecs)`);
    }
  }
  await Promise.all(Array.from({ length: 24 }, worker));
  if (entries.length < 100) throw new Error(`Trop peu d'images récupérées (${entries.length}) : index non remplacé.`);
  // Ordre stable : un index identique d'une semaine à l'autre ne crée pas de commit inutile
  entries.sort((a, b) => (a.meta[0] - b.meta[0]) || String(a.meta[1]).localeCompare(String(b.meta[1])));
  const info = writeIndex(OUT, entries, { pokemon: entries.filter(e => e.meta[0] === 0).length, onepiece: entries.filter(e => e.meta[0] === 1).length, failed: fail });
  fs.writeFileSync(`${OUT}/sets.json`, JSON.stringify({ ...pk.sets, ...op.sets }));
  console.log("Index écrit :", JSON.stringify(info));
}
main().catch(e => { console.error(e); process.exit(1); });
