/* Cotecarte — trouve la carte dans une photo et la redresse (OpenCV.js).
   Même code dans le navigateur (window.CCDetect) et dans Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CCDetect = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const RATIO = 63 / 88;

  function order(pts) {
    // tl, tr, br, bl
    const s = pts.map(p => p.x + p.y), d = pts.map(p => p.y - p.x);
    const tl = pts[s.indexOf(Math.min(...s))], br = pts[s.indexOf(Math.max(...s))];
    const tr = pts[d.indexOf(Math.min(...d))], bl = pts[d.indexOf(Math.max(...d))];
    return [tl, tr, br, bl];
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* Cherche le quadrilatère de la carte. hint : rectangle attendu {x,y,w,h} (le cadre affiché), en pixels de l'image.
     Retourne 4 points ordonnés (dans les coordonnées de l'image d'origine) ou null. */
  function findCard(cv, rgba, w, h, hint) {
    const scale = Math.min(1, 640 / Math.max(w, h));
    const W = Math.round(w * scale), H = Math.round(h * scale);
    const src = cv.matFromImageData({ data: rgba, width: w, height: h });
    const small = new cv.Mat(), gray = new cv.Mat(), edges = new cv.Mat(), tmp = new cv.Mat();
    const contours = new cv.MatVector(), hier = new cv.Mat();
    let best = null;
    try {
      cv.resize(src, small, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const areaMin = W * H * 0.08;
      const hintC = hint ? { x: (hint.x + hint.w / 2) * scale, y: (hint.y + hint.h / 2) * scale } : { x: W / 2, y: H / 2 };
      // Plusieurs seuils : bord net sur fond clair, bord sombre sur fond sombre…
      for (const [lo, hi] of [[30, 90], [60, 160], [15, 45]]) {
        cv.Canny(gray, edges, lo, hi);
        cv.dilate(edges, tmp, cv.Mat.ones(3, 3, cv.CV_8U));
        cv.findContours(tmp, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i), area = cv.contourArea(c);
          if (area < areaMin) { c.delete(); continue; }
          const peri = cv.arcLength(c, true), ap = new cv.Mat();
          let quad = null;
          for (const eps of [0.02, 0.035, 0.05]) {
            cv.approxPolyDP(c, ap, eps * peri, true);
            if (ap.rows === 4 && cv.isContourConvex(ap)) { quad = []; for (let k = 0; k < 4; k++) quad.push({ x: ap.data32S[k * 2], y: ap.data32S[k * 2 + 1] }); break; }
          }
          if (!quad) { // coins arrondis ou un côté mal vu : rectangle minimal
            const r = cv.minAreaRect(c), pts = cv.RotatedRect.points(r);
            if (cv.contourArea(c) / (r.size.width * r.size.height) > 0.85) quad = pts.map(p => ({ x: p.x, y: p.y }));
          }
          ap.delete(); c.delete();
          if (!quad) continue;
          const o = order(quad), wq = (dist(o[0], o[1]) + dist(o[3], o[2])) / 2, hq = (dist(o[0], o[3]) + dist(o[1], o[2])) / 2;
          const ratio = Math.min(wq, hq) / Math.max(wq, hq);
          if (ratio < RATIO * 0.8 || ratio > RATIO * 1.2) continue;
          const qa = wq * hq, cx = o.reduce((s, p) => s + p.x, 0) / 4, cy = o.reduce((s, p) => s + p.y, 0) / 4;
          const off = Math.hypot(cx - hintC.x, cy - hintC.y) / Math.max(W, H);
          const score = qa / (W * H) * 1.5 - off * 0.6 - Math.abs(ratio - RATIO) * 2;
          if (qa > W * H * 0.92) continue; // le bord de l'image
          if (wq > hq * 1.05) continue; // le cadre affiché est vertical : un rectangle couché est l'illustration, pas la carte
          if (!best || score > best.score) best = { score, o, landscape: false };
        }
      }
    } finally { src.delete(); small.delete(); gray.delete(); edges.delete(); tmp.delete(); contours.delete(); hier.delete(); }
    if (!best) return null;
    let o = best.o.map(p => ({ x: p.x / scale, y: p.y / scale }));
    if (best.landscape) o = [o[3], o[0], o[1], o[2]]; // carte couchée : on la remet debout
    return o;
  }

  /* Redresse la carte vers outW×outH (RGBA). */
  function warp(cv, rgba, w, h, quad, outW, outH) {
    const src = cv.matFromImageData({ data: rgba, width: w, height: h }), dst = new cv.Mat();
    const a = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap(p => [p.x, p.y]));
    const b = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
    const M = cv.getPerspectiveTransform(a, b);
    try {
      cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_AREA, cv.BORDER_REPLICATE);
      return new Uint8ClampedArray(dst.data);
    } finally { src.delete(); dst.delete(); a.delete(); b.delete(); M.delete(); }
  }
  return { findCard, warp, order };
});
