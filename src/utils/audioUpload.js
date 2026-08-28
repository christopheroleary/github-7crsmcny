// Client-side validation before an MP3 backing-track upload -- same shape
// as resizeImage.js's prepareLogoUpload/prepareReceiptUpload (fast, friendly
// rejection before the file ever reaches the network), backed by the real
// enforcement in the backing-tracks storage bucket's own file_size_limit/
// allowed_mime_types (see 20260828150000_band_backing_tracks.sql) -- this
// check can be bypassed by anyone calling the Storage API directly, same
// caveat as the equivalent image-upload comment in BandForm.jsx.

const MAX_BYTES = 30 * 1024 * 1024;

export function validateAudioFile(file) {
  if (file.type !== 'audio/mpeg') {
    return { ok: false, error: "That doesn't look like an MP3 file — please choose an .mp3." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That file is too large (max 30MB) — try a lower bitrate export.' };
  }
  return { ok: true };
}

// Reads duration via a temporary <audio> element rather than decoding the
// whole file through the Web Audio API -- much cheaper, and duration is
// all that's needed for display before the player itself does a real
// decodeAudioData() on demand.
export function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener('loadedmetadata', () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    });
    audio.addEventListener('error', () => {
      cleanup();
      resolve(null);
    });
    audio.src = url;
  });
}
