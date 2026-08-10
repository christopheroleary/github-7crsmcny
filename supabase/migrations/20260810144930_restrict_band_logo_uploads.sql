-- Enforce upload restrictions server-side on the band-logos bucket so they
-- can't be bypassed by calling the Storage API directly (with a valid
-- band-leader/admin session) instead of going through the app's own
-- client-side resize/re-encode pipeline. RLS on storage.objects already
-- restricts WHO can upload to a band's folder; this restricts WHAT they
-- can upload -- our own client only ever produces WebP under ~250KB, so
-- there's no legitimate reason to accept anything else in this bucket.
update storage.buckets
set file_size_limit = 2 * 1024 * 1024, -- 2MB, well above our own ~250KB target
    allowed_mime_types = array['image/webp']
where id = 'band-logos';
