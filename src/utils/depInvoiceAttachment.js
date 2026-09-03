import { supabase } from '../supabaseClient';

export const DEP_INVOICE_BUCKET = 'dep-invoices';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Deliberately NOT receipts.js's captureReceipt() -- that whole pipeline
// (AI OCR extraction, blur/quality checks, duplicate-photo detection) is
// built for "a musician photographs their own purchase", which doesn't fit
// "attach a copy of someone else's external invoice" at all. This just
// uploads the file exactly as given -- an image or a native PDF, never
// converted between the two (see the tasks_feature/claims migration
// comments for why rasterizing a PDF would make it both larger and less
// legible, not smaller).
export async function uploadDepInvoiceAttachment(file, bandId) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("That file isn't a photo or a PDF — pick an image or PDF of the invoice.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error('That file is too large (max 10MB).');
  }

  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
  const path = bandId + '/' + crypto.randomUUID() + '.' + ext;

  const { error } = await supabase.storage
    .from(DEP_INVOICE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error("Couldn't upload that file: " + error.message);

  return path;
}

// The bucket is private, like receipts -- every read goes through a
// short-lived signed URL rather than a public link.
export async function depInvoiceSignedUrl(path, expiresIn = 300) {
  const { data, error } = await supabase.storage
    .from(DEP_INVOICE_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function deleteDepInvoiceAttachment(path) {
  if (!path) return;
  await supabase.storage.from(DEP_INVOICE_BUCKET).remove([path]).catch(() => {});
}
