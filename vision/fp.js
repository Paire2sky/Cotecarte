/* Cotecarte — empreinte visuelle d'une carte.
   Le même fichier tourne dans le navigateur (window.CCFP) et dans Node (script de construction de l'index),
   pour que les empreintes des photos et celles de l'index soient calculées exactement de la même façon. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CCFP = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const GW = 16, GH = 22;          // grille de couleurs (proportions 63×88)
  const DIM = GW * GH * 3;         // 1056 valeurs avant réduction

  /* Moyenne par zone (box filter à poids fractionnaires) : déterministe et identique partout. */
  function resizeArea(rgba, w, h, W, H, x0 = 0, y0 = 0, cw = w, ch = h) {
    const out = new Float32Array(W * H * 3), sx = cw / W, sy = ch / H;
    for (let Y = 0; Y < H; Y++) {
      const ya = y0 + Y * sy, yb = ya + sy;
      for (let X = 0; X < W; X++) {
        const xa = x0 + X * sx, xb = xa + sx;
        let r = 0, g = 0, b = 0, a = 0;
        for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
          const wy = Math.min(yb, y + 1) - Math.max(ya, y); if (wy <= 0 || y < 0 || y >= h) continue;
          for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
            const wx = Math.min(xb, x + 1) - Math.max(xa, x); if (wx <= 0 || x < 0 || x >= w) continue;
            const k = wx * wy, i = (y * w + x) * 4;
            r += rgba[i] * k; g += rgba[i + 1] * k; b += rgba[i + 2] * k; a += k;
          }
        }
        const o = (Y * W + X) * 3; a = a || 1;
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a;
      }
    }
    return out;
  }

  /* Grille de couleurs en espace « opposé » (luminance + 2 axes de couleur), normalisée canal par canal :
     insensible à la balance des blancs, à l'exposition et au contraste. Les reflets sont écrêtés. */
  function colorLayout(rgba, w, h) {
    const g = resizeArea(rgba, w, h, GW, GH), n = GW * GH;
    // Balance des blancs (von Kries) : chaque canal ramené à la même moyenne, ce qui annule une dominante de couleur.
    const mc = [0, 0, 0]; for (let i = 0; i < n; i++) { mc[0] += g[i * 3]; mc[1] += g[i * 3 + 1]; mc[2] += g[i * 3 + 2]; }
    const avg = (mc[0] + mc[1] + mc[2]) / 3; for (let c = 0; c < 3; c++) mc[c] = mc[c] ? avg / mc[c] : 1;
    for (let i = 0; i < n; i++) { g[i * 3] *= mc[0]; g[i * 3 + 1] *= mc[1]; g[i * 3 + 2] *= mc[2]; }
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const r = g[i * 3], gg = g[i * 3 + 1], b = g[i * 3 + 2];
      ch[0][i] = (r + gg + b) / 1.732;
      ch[1][i] = (r - gg) / 1.414;
      ch[2][i] = (r + gg - 2 * b) / 2.449;
    }
    // Centrage par canal, mais une seule échelle (celle de la luminance) : une carte peu colorée le reste,
    // au lieu de voir son bruit de couleur gonflé jusqu'à inverser la comparaison.
    const out = new Float32Array(DIM), means = [0, 0, 0];
    for (let c = 0; c < 3; c++) { for (let i = 0; i < n; i++) means[c] += ch[c][i]; means[c] /= n; }
    let v = 0; for (let i = 0; i < n; i++) v += (ch[0][i] - means[0]) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    for (let c = 0; c < 3; c++) { const wgt = c === 0 ? 1 : 1.4; for (let i = 0; i < n; i++) out[c * n + i] = Math.max(-3, Math.min(3, (ch[c][i] - means[c]) / sd)) * wgt; }
    return out;
  }

  /* pHash : DCT de l'image en gris 32×32, 64 bits de basses fréquences. */
  const C32 = (() => { const c = new Float32Array(32 * 32); for (let u = 0; u < 32; u++) for (let x = 0; x < 32; x++) c[u * 32 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64); return c; })();
  function phash(rgba, w, h) {
    const g = resizeArea(rgba, w, h, 32, 32), p = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) p[i] = g[i * 3] * 0.299 + g[i * 3 + 1] * 0.587 + g[i * 3 + 2] * 0.114;
    const coef = [];
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 32; y++) { const cy = C32[u * 32 + y]; for (let x = 0; x < 32; x++) s += p[y * 32 + x] * cy * C32[v * 32 + x]; }
      coef.push(s);
    }
    const med = coef.slice(1).sort((a, b) => a - b)[31];
    const bytes = new Uint8Array(8);
    for (let i = 1; i < 64; i++) if (coef[i] > med) bytes[i >> 3] |= 1 << (i & 7);
    return bytes;
  }
  const POP = new Uint8Array(256).map((_, i) => { let c = 0, x = i; while (x) { c += x & 1; x >>= 1; } return c; });
  function hamming(a, ao, b, bo) { let d = 0; for (let i = 0; i < 8; i++) d += POP[a[ao + i] ^ b[bo + i]]; return d; }

  /* Bordure : anneau entre 1,5 % et 4,5 % de la largeur, hors coins. Classe : 0 jaune, 1 dorée, 2 argentée, 3 blanche, 4 noire, 5 autre. */
  const BORDER_NAMES = ["jaune", "or", "argent", "blanc", "noir", "autre"];
  function borderInfo(rgba, w, h) {
    const a = Math.max(1, Math.round(w * 0.012)), b = Math.max(a + 1, Math.round(w * 0.03)), m = Math.round(w * 0.1);
    const k = [1, 1, 1]; // couleur brute : une correction globale fausse la bordure des cartes très colorées
    let r = 0, g = 0, bl = 0, n = 0; const lum = [];
    const add = (x, y) => { const i = (y * w + x) * 4, R = rgba[i] * k[0], G = rgba[i + 1] * k[1], B = rgba[i + 2] * k[2]; r += R; g += G; bl += B; n++; lum.push(R * 0.299 + G * 0.587 + B * 0.114); };
    for (let y = m; y < h - m; y++) for (let q = a; q < b; q++) { add(q, y); add(w - 1 - q, y); }
    for (let x = m; x < w - m; x++) for (let q = a; q < b; q++) { add(x, q); add(x, h - 1 - q); }
    r /= n; g /= n; bl /= n;
    // Reflet métallique : un bord doré varie en éclat le long de la carte, un bord jaune reste uni.
    const lm = lum.reduce((s2, v) => s2 + v, 0) / lum.length;
    const cv = Math.min(1, Math.sqrt(lum.reduce((s2, v) => s2 + (v - lm) ** 2, 0) / lum.length) / (lm || 1));
    const mx = Math.min(1, Math.max(r, g, bl) / 255), mn = Math.min(1, Math.min(r, g, bl) / 255), d = mx - mn;
    let hue = 0;
    if (d) { const R = r / 255, G = g / 255, B = bl / 255; hue = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; hue = (hue * 60 + 360) % 360; }
    const s = mx ? d / mx : 0, v = mx;
    let cls = 5;
    if (v < 0.28) cls = 4;
    else if (s < 0.16) cls = v > 0.86 ? 3 : 2;
    else if (hue >= 28 && hue <= 66) cls = (s > 0.62 && hue > 42 && cv < 0.12) ? 0 : 1;
    return { h: hue, s, v, cv, cls };
  }
  /* Distance entre deux bordures (teinte, saturation, luminosité). */
  function borderDist(a, b) {
    const dh = Math.min(1, Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 30);
    return Math.abs(a.s - b.s) + Math.abs(a.v - b.v) * 0.2 + (a.s > 0.18 && b.s > 0.18 ? dh : 0) + Math.abs((a.cv || 0) - (b.cv || 0)) * 2;
  }
  /* Bordure compactée sur 4 octets pour l'index. */
  const BORDER_BYTES = 4;
  const packBorder = b => [Math.round(b.h / 360 * 255), Math.round(b.s * 255), Math.round(b.v * 255), Math.round(Math.min(1, b.cv * 2) * 255)];
  const unpackBorder = (a, o = 0) => ({ h: a[o] / 255 * 360, s: a[o + 1] / 255, v: a[o + 2] / 255, cv: a[o + 3] / 255 / 2 });

  /* Réduction par ACP (moyenne + matrice fournies par l'index), normalisation L2. */
  function project(desc, pca) {
    const { mean, comps, dim, k } = pca, out = new Float32Array(k);
    for (let j = 0; j < k; j++) {
      let s = 0; const off = j * dim;
      for (let i = 0; i < dim; i++) s += (desc[i] - mean[i]) * comps[off + i];
      out[j] = s;
    }
    let nn = 0; for (let j = 0; j < k; j++) nn += out[j] * out[j]; nn = Math.sqrt(nn) || 1;
    for (let j = 0; j < k; j++) out[j] /= nn;
    return out;
  }

  /* Recherche des plus proches voisins (produit scalaire sur vecteurs int8). */
  function search(q, vecs, k, n, top = 40, filter) {
    const best = [];
    let worst = -Infinity;
    for (let r = 0; r < n; r++) {
      if (filter && !filter(r)) continue;
      let s = 0; const off = r * k;
      for (let j = 0; j < k; j++) s += q[j] * vecs[off + j];
      if (best.length < top) { best.push([s, r]); if (best.length === top) { best.sort((a, b) => a[0] - b[0]); worst = best[0][0]; } }
      else if (s > worst) { best[0] = [s, r]; best.sort((a, b) => a[0] - b[0]); worst = best[0][0]; }
    }
    return best.sort((a, b) => b[0] - a[0]).map(([s, r]) => ({ row: r, score: s }));
  }

  /* Coins arrondis : ce qui est hors de la carte est peint en gris neutre, des deux côtés (photo et index). */
  function maskCorners(rgba, w, h) {
    const r = w * 0.045;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x < r ? r - x : x >= w - r ? x - (w - 1 - r) : 0, dy = y < r ? r - y : y >= h - r ? y - (h - 1 - r) : 0;
      if (dx && dy && dx * dx + dy * dy > r * r) { const i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 128; rgba[i + 3] = 255; }
    }
    return rgba;
  }
  /* Empreinte complète d'une image de carte déjà redressée. */
  function describe(rgba, w, h) {
    maskCorners(rgba, w, h);
    return { desc: colorLayout(rgba, w, h), hash: phash(rgba, w, h), border: borderInfo(rgba, w, h) };
  }

  /* Rotation de 180° (carte posée à l'envers). */
  function rotate180(rgba, w, h) {
    const o = new Uint8ClampedArray(rgba.length), n = w * h;
    for (let i = 0; i < n; i++) { const j = (n - 1 - i) * 4, k = i * 4; o[k] = rgba[j]; o[k + 1] = rgba[j + 1]; o[k + 2] = rgba[j + 2]; o[k + 3] = rgba[j + 3]; }
    return o;
  }

  return { GW, GH, DIM, resizeArea, colorLayout, phash, hamming, borderInfo, BORDER_NAMES, project, search, rotate180, maskCorners, describe, borderDist, packBorder, unpackBorder, BORDER_BYTES };
});
