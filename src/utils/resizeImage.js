import { analyseQuality, autoCropAndDeskew } from './documentScan.js';

// Resizes/compresses an image client-side before upload, entirely in the
// browser -- no server-side processing needed. WebP (not JPEG) so a logo
// with a transparent background stays transparent instead of getting a
// solid black fill baked in, which is what plain canvas->JPEG does since
// JPEG has no alpha channel.

async function fileToResizedCanvas(file, { maxWidth = 800, maxHeight = 800 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas;
}

function canvasToWebpBlob(canvas, { quality = 0.85, maxBytes = 250 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let q = quality;
    const attempt = () => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Couldn't process that image — try a different file."));
          return;
        }
        if (blob.size > maxBytes && q > 0.4) {
          q -= 0.1;
          attempt();
          return;
        }
        resolve(blob);
      }, 'image/webp', q);
    };
    attempt();
  });
}

// A logo is a good invert candidate when its opaque pixels are mostly
// white/grey (low colour spread, high brightness) and it sits on a
// transparent background -- the common "reversed for dark backgrounds"
// logo variant that's invisible against a white invoice page.
export function canvasLooksInvertible(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  let transparent = 0;
  let sumLuminance = 0;
  let sumSpread = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) {
      transparent++;
      continue;
    }
    opaque++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    sumLuminance += (r + g + b) / 3;
    sumSpread += Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (!opaque) return false;
  const avgLuminance = sumLuminance / opaque;
  const avgSpread = sumSpread / opaque;
  const transparentRatio = transparent / (width * height);
  return avgLuminance > 210 && avgSpread < 40 && transparentRatio > 0.05;
}

export function invertCanvasColours(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);
}

export async function resizeImageFile(file, opts = {}) {
  const canvas = await fileToResizedCanvas(file, opts);
  return canvasToWebpBlob(canvas, opts);
}

// Receipts are black text on white paper, so throwing away the colour
// channels costs nothing legibility-wise and roughly halves the encoded
// size -- which matters when these have to be kept for six years.
function greyscaleCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma -- weights the channels the way the eye does, so faint
    // thermal-print text stays readable instead of washing out the way a
    // flat (r+g+b)/3 average makes it.
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = y;
  }
  ctx.putImageData(imageData, 0, 0);
}

function scaleCanvas(canvas, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height);
  if (scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

// Deliberately not sharing resizeImageFile's defaults: those are tuned for
// square-ish avatars/logos at 800px, which renders a tall till receipt's
// small print unreadable. Portrait receipts need the height, and the OCR
// pass needs enough width to resolve the line-item text.
//
// The full pipeline is: load large enough to preserve detail for the warp ->
// score the photo -> find and flatten the paper -> scale to the OCR target ->
// greyscale -> encode. Quality is measured on the ORIGINAL frame, before
// cropping, so the verdict describes the photo the user actually took.
export async function prepareReceiptUpload(file, opts = {}) {
  // Detection and perspective correction both want more pixels than the
  // final upload keeps, so the source is loaded at a larger size first and
  // only scaled down to the OCR target afterwards.
  const source = await fileToResizedCanvas(file, { maxWidth: 2000, maxHeight: 2600 });

  const quality = analyseQuality(source);
  const { canvas: flattened, cropped } = autoCropAndDeskew(source);

  const sized = scaleCanvas(flattened, opts.maxWidth || 1200, opts.maxHeight || 1600);
  greyscaleCanvas(sized);

  const blob = await canvasToWebpBlob(sized, {
    quality: 0.7,
    maxBytes: 120 * 1024,
    ...opts,
  });

  return { blob, quality, cropped };
}

// Loads + resizes the file once, then lets the caller decide (after
// checking `invertible`, e.g. via a confirm dialog) whether to invert
// before the final compressed blob is produced.
export async function prepareLogoUpload(file, opts = {}) {
  const canvas = await fileToResizedCanvas(file, opts);
  const invertible = canvasLooksInvertible(canvas);
  return {
    invertible,
    toBlob(invert) {
      if (invert) invertCanvasColours(canvas);
      return canvasToWebpBlob(canvas, opts);
    },
  };
}
