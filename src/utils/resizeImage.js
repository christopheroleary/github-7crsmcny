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
