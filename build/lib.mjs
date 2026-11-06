/* Construction de l'index : empreintes de toutes les cartes, ACP, quantification. Utilisé par build-index.mjs et par les tests. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const FP = require("../vision/fp.js");
const sharp = require("sharp");
const { Matrix, EigenvalueDecomposition } = require("ml-matrix");

export const K = 128;

/* Décode une image (webp/png/jpg) en RGBA, coins transparents posés sur du gris. */
export async function decode(buf) {
  const { data, info } = await sharp(buf).flatten({ background: "#808080" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

/* ACP sur un échantillon, blanchiment partiel (λ^-1/4) pour équilibrer les composantes. */
export function fitPCA(descs, k = K, sample = 8000) {
  const D = FP.DIM, n = descs.length, step = Math.max(1, Math.floor(n / sample));
  const rows = []; for (let i = 0; i < n; i += step) rows.push(descs[i]);
  const mean = new Float64Array(D);
  for (const r of rows) for (let i = 0; i < D; i++) mean[i] += r[i];
  for (let i = 0; i < D; i++) mean[i] /= rows.length;
  const cov = new Float64Array(D * D), c = new Float64Array(D);
  for (const r of rows) {
    for (let i = 0; i < D; i++) c[i] = r[i] - mean[i];
    for (let i = 0; i < D; i++) { const ci = c[i]; if (!ci) continue; const off = i * D; for (let j = i; j < D; j++) cov[off + j] += ci * c[j]; }
  }
  const M = new Matrix(D, D);
  for (let i = 0; i < D; i++) for (let j = i; j < D; j++) { const v = cov[i * D + j] / rows.length; M.set(i, j, v); M.set(j, i, v); }
  const evd = new EigenvalueDecomposition(M, { assumeSymmetric: true });
  const vals = evd.realEigenvalues, V = evd.eigenvectorMatrix;
  const order = [...vals.keys()].sort((a, b) => vals[b] - vals[a]).slice(0, Math.min(k, D));
  const comps = new Float32Array(order.length * D);
  order.forEach((col, j) => { const sc = 1 / Math.pow(Math.max(vals[col], 1e-6), 0.25); for (let i = 0; i < D; i++) comps[j * D + i] = V.get(i, col) * sc; });
  return { mean: Float32Array.from(mean), comps, dim: D, k: order.length };
}

/* items : [{ meta, rgba, w, h }] déjà décodés → fichiers de l'index dans outDir. */
export function writeIndex(outDir, entries, extra = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const pca = fitPCA(entries.map(e => e.desc));
  const proj = entries.map(e => FP.project(e.desc, pca));
  const abs = []; for (const p of proj) for (let j = 0; j < pca.k; j += 7) abs.push(Math.abs(p[j]));
  abs.sort((a, b) => a - b);
  const scale = 127 / (abs[Math.floor(abs.length * 0.999)] || 1);
  const vec = new Int8Array(entries.length * pca.k), hash = new Uint8Array(entries.length * 8), bord = new Uint8Array(entries.length * FP.BORDER_BYTES);
  proj.forEach((p, r) => { for (let j = 0; j < pca.k; j++) vec[r * pca.k + j] = Math.max(-127, Math.min(127, Math.round(p[j] * scale))); hash.set(entries[r].hash, r * 8); bord.set(FP.packBorder(entries[r].border), r * FP.BORDER_BYTES); });
  const pcaBuf = new Float32Array(pca.dim + pca.dim * pca.k); pcaBuf.set(pca.mean, 0); pcaBuf.set(pca.comps, pca.dim);
  fs.writeFileSync(path.join(outDir, "vec.bin"), Buffer.from(vec.buffer));
  fs.writeFileSync(path.join(outDir, "hash.bin"), Buffer.from(hash.buffer));
  fs.writeFileSync(path.join(outDir, "border.bin"), Buffer.from(bord.buffer));
  fs.writeFileSync(path.join(outDir, "pca.bin"), Buffer.from(pcaBuf.buffer));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(entries.map(e => e.meta)));
  const info = { version: 1, n: entries.length, k: pca.k, dim: pca.dim, scale, built: new Date().toISOString(), ...extra };
  fs.writeFileSync(path.join(outDir, "info.json"), JSON.stringify(info, null, 1));
  return info;
}
export { FP };
