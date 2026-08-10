// Resizes/compresses an image client-side before upload, entirely in the
// browser -- no server-side processing needed. WebP (not JPEG) so a logo
// with a transparent background stays transparent instead of getting a
// solid black fill baked in, which is what plain canvas->JPEG does since
// JPEG has no alpha channel.
export async function resizeImageFile(file, { maxWidth = 800, maxHeight = 800, quality = 0.85, maxBytes = 250 * 1024 } = {}) {
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

  let q = quality;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', q));
  while (blob && blob.size > maxBytes && q > 0.4) {
    q -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', q));
  }
  if (!blob) throw new Error("Couldn't process that image — try a different file.");
  return blob;
}
