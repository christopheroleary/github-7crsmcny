import { supabase } from '../supabaseClient';
import { prepareReceiptUpload } from './resizeImage.js';

export const RECEIPT_BUCKET = 'receipts';

// Generous ceiling on the ORIGINAL camera file, before compression. This is
// a UX guard against someone picking a huge file and waiting -- the real
// boundary is the bucket's own 5MB limit and its mime whitelist, enforced
// server-side where a browser can't skip it.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Photograph -> compressed upload -> row -> OCR, in one call.
 *
 * The image is uploaded BEFORE the row is inserted: an orphaned blob is
 * harmless and cheap to sweep up later, whereas a row pointing at a file
 * that doesn't exist breaks every view that tries to render it.
 *
 * Extraction failing is deliberately NOT treated as the whole thing
 * failing. The photo is a complete, legally-valid record on its own -- if
 * the model can't read it the musician just types the fields in by hand, so
 * this always resolves with the receipt row and reports extraction trouble
 * separately in `extractionError`.
 */
export async function captureReceipt(file, profileId) {
  if (!file.type?.startsWith('image/')) {
    throw new Error('That file isn\'t an image — take a photo or pick a picture of the receipt.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That image is too large — try taking the photo again.');
  }

  const blob = await prepareReceiptUpload(file);

  // Generated client-side so the storage path can embed it before the row
  // exists -- the path has to start with the owning profile id for the
  // bucket's RLS policies to allow the write.
  const id = crypto.randomUUID();
  const storagePath = `${profileId}/${id}.webp`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(storagePath, blob, {
      upsert: false,
      // toBlob('image/webp') silently falls back to PNG on some iOS Safari
      // builds; hardcoding the type here made Storage reject the mismatch.
      contentType: blob.type || 'image/webp',
    });
  if (uploadError) throw new Error("Couldn't upload that photo: " + uploadError.message);

  const { data: receipt, error: insertError } = await supabase
    .from('receipts')
    .insert({ id, profile_id: profileId, storage_path: storagePath, byte_size: blob.size })
    .select()
    .single();
  if (insertError) {
    // Don't strand the blob if the row couldn't be written.
    await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error("Couldn't save that receipt: " + insertError.message);
  }

  const { data: result, error: fnError } = await supabase.functions
    .invoke('extract-receipt', { body: { receipt_id: id } });

  if (fnError || !result?.ok) {
    const { data: latest } = await supabase.from('receipts').select('*').eq('id', id).single();
    return {
      receipt: latest || receipt,
      extractionError:
        result?.error || fnError?.message || 'Couldn\'t read that receipt automatically.',
    };
  }

  return { receipt: result.receipt, extractionError: null };
}

// The bucket is private (unlike profile-pictures/band-logos), so there is no
// public URL -- every read goes through a short-lived signed URL.
export async function receiptSignedUrl(storagePath, expiresIn = 300) {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function deleteReceipt(receipt) {
  await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.storage_path]).catch(() => {});
  const { error } = await supabase.from('receipts').delete().eq('id', receipt.id);
  if (error) throw new Error(error.message);
}

export function poundsFromPence(p) {
  return p == null ? '' : (p / 100).toFixed(2);
}
