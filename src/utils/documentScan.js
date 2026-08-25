// Document detection, quality scoring and perspective correction for receipt
// photos -- the preprocessing a dedicated receipt scanner does before OCR
// ever sees the image. Pure canvas/typed arrays, no OpenCV, no dependencies.
//
// Two jobs, both worth doing BEFORE spending money on an extraction call:
//   1. Score the photo. A blurred or near-black frame will not read, so
//      catching it here means the user retakes it instead of paying for a
//      result that was never going to be usable.
//   2. Find the paper and flatten it. A receipt shot at an angle on a pub
//      table wastes most of its pixels on carpet and reads badly; cropping
//      to the paper and squaring it up is the single biggest accuracy lever
//      available client-side.
//
// Every step here fails SAFE: if detection isn't confident, the original
// image is passed through untouched. A wrong crop is far worse than no crop.

const DETECT_WIDTH = 320; // detection runs on a small copy; the warp uses the full-res source

function toGrey(imageData) {
  const { data, width, height } = imageData;
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { grey, width, height };
}

function downscaledGrey(canvas, targetWidth = DETECT_WIDTH) {
  const scale = Math.min(1, targetWidth / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  small.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return toGrey(small.getContext('2d').getImageData(0, 0, w, h));
}

// ── Quality ──────────────────────────────────────────────────────────────────

// Variance of the Laplacian: the standard cheap sharpness measure. A sharp
// photo has lots of rapid intensity change (text edges) and so a high
// variance; a blurred one smears those edges away and the variance collapses.
function laplacianVariance({ grey, width, height }) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function meanBrightness({ grey }) {
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  return sum / grey.length;
}

// Glare is better measured by how much of the frame is actually BLOWN than
// by average brightness. Clean white paper sits around 240-246 and is
// perfectly readable; mean brightness alone flagged that as washed out.
// Pixels pinned at ~255 are where detail has genuinely been destroyed.
function blownFraction({ grey }) {
  let blown = 0;
  for (let i = 0; i < grey.length; i++) if (grey[i] >= 252) blown++;
  return blown / grey.length;
}

// Thresholds are deliberately permissive -- these exist to catch photos that
// are obviously unusable (a pocket shot, a dark blur), not to nag someone
// over a merely-mediocre one. A false "retake this" on a readable receipt is
// more annoying than an occasional wasted extraction.
const BLUR_FLOOR = 60;
const DARK_FLOOR = 45;
const BLOWN_CEILING = 0.35;

export function analyseQuality(canvas) {
  const small = downscaledGrey(canvas);
  const sharpness = laplacianVariance(small);
  const brightness = meanBrightness(small);
  const blown = blownFraction(small);

  const warnings = [];
  if (sharpness < BLUR_FLOOR) {
    warnings.push({
      code: 'blurry',
      message: 'That photo looks blurred — hold still and try again for a better read.',
    });
  }
  if (brightness < DARK_FLOOR) {
    warnings.push({
      code: 'dark',
      message: 'That photo looks very dark — more light will read a lot better.',
    });
  } else if (blown > BLOWN_CEILING) {
    warnings.push({
      code: 'washed_out',
      message: 'There\'s a lot of glare on that photo — try again without the flash, or at a slight angle to the light.',
    });
  }

  return { sharpness, brightness, blown, warnings };
}

// ── Document detection ───────────────────────────────────────────────────────

// Otsu's method: pick the grey level that best splits the histogram into two
// groups. Receipts are dark text on light paper against (usually) a darker
// surface, so this separates "paper" from "everything else" without needing
// a hardcoded threshold that would break under different lighting.
function otsuThreshold(grey) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  const total = grey.length;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function isConvex(quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Finds the paper's four corners, in source-image coordinates.
 *
 * Corners come from the extremes of (x+y) and (x-y) across the thresholded
 * paper mask -- the standard trick, and far cheaper than contour tracing.
 * Returns null whenever the result doesn't look like a plausible document,
 * which is the common case for a receipt photographed on white paper or
 * filling the whole frame; both are fine left alone.
 */
export function detectDocumentQuad(canvas) {
  const { grey, width, height } = downscaledGrey(canvas);
  const threshold = otsuThreshold(grey);

  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  let tl = null, br = null, tr = null, bl = null;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grey[y * width + x] <= threshold) continue; // background
      count++;
      const s = x + y;
      const d = x - y;
      if (s < minSum) { minSum = s; tl = { x, y }; }
      if (s > maxSum) { maxSum = s; br = { x, y }; }
      if (d > maxDiff) { maxDiff = d; tr = { x, y }; }
      if (d < minDiff) { minDiff = d; bl = { x, y }; }
    }
  }

  if (!tl || !tr || !br || !bl) return null;

  // Too little "paper" to trust, or so much that there's nothing to crop.
  const coverage = count / (width * height);
  if (coverage < 0.12 || coverage > 0.97) return null;

  const quad = [tl, tr, br, bl];
  if (!isConvex(quad)) return null;

  const area = quadArea(quad);
  const frac = area / (width * height);
  if (frac < 0.15 || frac > 0.98) return null;

  // Reject slivers -- a degenerate quad warps into garbage.
  const w1 = dist(tl, tr), w2 = dist(bl, br);
  const h1 = dist(tl, bl), h2 = dist(tr, br);
  const minSide = Math.min(w1, w2, h1, h2);
  if (minSide < Math.min(width, height) * 0.2) return null;
  // Opposite sides wildly different means the detection latched onto noise.
  if (Math.max(w1, w2) / Math.max(1, Math.min(w1, w2)) > 2.5) return null;
  if (Math.max(h1, h2) / Math.max(1, Math.min(h1, h2)) > 2.5) return null;

  // Back to full-resolution coordinates.
  const sx = canvas.width / width;
  const sy = canvas.height / height;
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

/**
 * Flattens the detected quad into an upright rectangle.
 *
 * Uses a bilinear corner map rather than a true projective homography --
 * for a sheet of paper photographed from roughly in front, the two are
 * visually near-identical, and this avoids hand-rolling matrix inversion for
 * no practical gain in readability.
 */
export function warpToRectangle(canvas, quad, maxDim = 1600) {
  const [tl, tr, br, bl] = quad;
  const outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  if (outW < 8 || outH < 8) return canvas;

  const scale = Math.min(1, maxDim / Math.max(outW, outH));
  const W = Math.max(1, Math.round(outW * scale));
  const H = Math.max(1, Math.round(outH * scale));

  const srcCtx = canvas.getContext('2d');
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const sd = src.data;
  const sw = src.width;
  const sh = src.height;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const outCtx = out.getContext('2d');
  const dst = outCtx.createImageData(W, H);
  const dd = dst.data;

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1 || 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1 || 1);
      const topX = tl.x + (tr.x - tl.x) * u;
      const topY = tl.y + (tr.y - tl.y) * u;
      const botX = bl.x + (br.x - bl.x) * u;
      const botY = bl.y + (br.y - bl.y) * u;
      const fx = topX + (botX - topX) * v;
      const fy = topY + (botY - topY) * v;

      // Bilinear sample -- nearest-neighbour visibly chews small print.
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const di = (y * W + x) * 4;

      if (x0 < 0 || y0 < 0 || x0 >= sw || y0 >= sh) {
        dd[di] = dd[di + 1] = dd[di + 2] = 255;
        dd[di + 3] = 255;
        continue;
      }

      for (let c = 0; c < 3; c++) {
        const p00 = sd[(y0 * sw + x0) * 4 + c];
        const p10 = sd[(y0 * sw + x1) * 4 + c];
        const p01 = sd[(y1 * sw + x0) * 4 + c];
        const p11 = sd[(y1 * sw + x1) * 4 + c];
        dd[di + c] =
          p00 * (1 - ax) * (1 - ay) + p10 * ax * (1 - ay) + p01 * (1 - ax) * ay + p11 * ax * ay;
      }
      dd[di + 3] = 255;
    }
  }

  outCtx.putImageData(dst, 0, 0);
  return out;
}

/**
 * Crop to the receipt and square it up, or return the original untouched.
 * `cropped` tells the caller which happened, so the UI can say so.
 */
export function autoCropAndDeskew(canvas) {
  try {
    const quad = detectDocumentQuad(canvas);
    if (!quad) return { canvas, cropped: false };
    return { canvas: warpToRectangle(canvas, quad), cropped: true };
  } catch {
    // Detection is an optimisation, never a requirement.
    return { canvas, cropped: false };
  }
}

// ── Duplicate detection ──────────────────────────────────────────────────────

// SHA-256 of the encoded bytes. Only catches the identical file being
// submitted twice (re-picking from the gallery, a double-tap, a retry) --
// two separate photos of the same receipt differ in every byte. That case is
// caught after extraction instead, by comparing merchant/date/total.
export async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
