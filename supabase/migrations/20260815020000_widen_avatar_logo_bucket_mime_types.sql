-- Both buckets only allowed image/webp, but canvas.toBlob('image/webp') falls
-- back to image/png on any browser/OS that can't encode WebP (some iOS
-- Safari versions among them) -- the upload code declared contentType:
-- 'image/webp' regardless of what was actually produced, so Storage's
-- content-type validation correctly rejected the mismatch. Widening to also
-- accept image/png is the safety net; the app-side fix makes the declared
-- type match the real blob type instead of hardcoding it.
update storage.buckets set allowed_mime_types = array['image/webp', 'image/png']
where id in ('profile-pictures', 'band-logos');
