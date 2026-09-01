import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { notify } from '../utils/toastService.js';
import { resizeImageFile } from '../utils/resizeImage.js';
import { todayStr } from '../utils/formatDate.js';

const BUCKET = 'gig-photos';
const MAX_CAPTION_PHOTOS = 5;
const MAX_BATCH = 20; // UX nicety only -- the bucket's own 8MB-per-file limit is the real backstop.

function publicUrl(storagePath) {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

// Photos from the gig, shared with the band leader/admin so they can pull
// together a social media post. Same permission-inside-the-component
// pattern as GigMessages -- canView/canUpload/canManage all computed from
// props + useCurrentProfile, server-side RLS is the real boundary either
// way. No readOnly prop needed (unlike GigSuppliers): uploading is a
// genuine musician-facing capability here, not leader-only, so both
// GigDetail.jsx and GigDetailBandMember.jsx render this identically.
export default function GigPhotos({ gigId, bandId, gig, lineup = [], refreshSignal }) {
  const { profile, isAdmin, isBandLeader, ledBandIds } = useCurrentProfile();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [drafting, setDrafting] = useState(false);
  const [captionResult, setCaptionResult] = useState(null);
  const [captionError, setCaptionError] = useState(null);
  const fileInputRef = useRef(null);

  const myLineupRow = lineup.find((l) => l.profile_id === profile?.id);
  const isLeaderOfThisBand = Boolean(isBandLeader && bandId && ledBandIds.includes(bandId));
  const canView = Boolean(profile) && (isAdmin || isLeaderOfThisBand || Boolean(myLineupRow));
  const canUpload = Boolean(profile) && (isAdmin || isLeaderOfThisBand || Boolean(myLineupRow?.confirmed));
  const canManage = isAdmin || isLeaderOfThisBand;
  const gigHasHappened = gig?.gig_date ? gig.gig_date <= todayStr() : false;

  const visiblePhotos = canManage ? photos : photos.filter((p) => !p.hidden_at);

  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('gig_photos')
      // gig_photos has two FKs to profiles (uploaded_by AND hidden_by), so
      // a bare `profiles(full_name)` embed is ambiguous to PostgREST --
      // confirmed live (PGRST201) -- has to name which relationship.
      .select('id, uploaded_by, storage_path, byte_size, caption, hidden_at, created_at, profiles!gig_photos_uploaded_by_fkey(full_name)')
      .eq('gig_id', gigId)
      .order('created_at', { ascending: false });
    setPhotos(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId, canView]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  async function handleFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // lets re-selecting the same file(s) work later
    if (!files.length || !profile) return;

    const toUpload = files.slice(0, MAX_BATCH);
    if (files.length > MAX_BATCH) {
      notify(`Only the first ${MAX_BATCH} photos were selected — upload the rest in a second batch.`);
    }

    setUploading(true);
    setUploadProgress({ done: 0, total: toUpload.length });
    const uploadedIds = [];

    for (const file of toUpload) {
      if (!file.type.startsWith('image/')) {
        setUploadProgress((p) => ({ ...p, done: p.done + 1 }));
        continue;
      }
      try {
        // 1920px/900KB -- deliberately more generous than avatars (400px/
        // 60KB, always thumbnail-sized) or receipts (1200px/120KB, OCR
        // legibility is the constraint): these need to look good pasted
        // straight into a social post, while still being a real, visible
        // size reduction from a typical multi-MB phone photo.
        const blob = await resizeImageFile(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.82, maxBytes: 900 * 1024 });
        // Generated before upload -- the storage path has to exist before
        // the Storage RLS insert check runs (same ordering as
        // captureReceipt's id/storagePath).
        const id = crypto.randomUUID();
        const path = profile.id + '/' + gigId + '-' + id + '.webp';

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, blob, { upsert: false, contentType: blob.type || 'image/webp' });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase
          .from('gig_photos')
          .insert({ id, gig_id: gigId, uploaded_by: profile.id, storage_path: path, byte_size: blob.size });
        if (insertError) {
          // Don't strand the just-uploaded blob if the row never landed.
          await supabase.storage.from(BUCKET).remove([path]);
          throw insertError;
        }
        uploadedIds.push(id);
      } catch (err) {
        notify("Couldn't upload one of the photos: " + err.message);
      }
      setUploadProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    // Exactly ONE batch-marker insert for the whole selection, regardless
    // of how many photos it contained -- this is the single thing that
    // fires the leader/admin notification (see gig_photo_batches).
    if (uploadedIds.length > 0) {
      await supabase.from('gig_photo_batches').insert({
        gig_id: gigId,
        uploaded_by: profile.id,
        photo_count: uploadedIds.length,
        photo_ids: uploadedIds,
      });
    }

    setUploading(false);
    setUploadProgress(null);
    load();
  }

  async function handleDelete(photo) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([photo.storage_path]);
    if (storageError) { notify("Couldn't delete: " + storageError.message); return; }
    const { error } = await supabase.from('gig_photos').delete().eq('id', photo.id);
    if (error) { notify("Couldn't delete: " + error.message); return; }
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);
  }

  // Leader/admin moderation tool, separate from delete -- see the RLS
  // migration's comment for why leaders get hide, not delete, on other
  // people's photos (a leader has no Storage-level delete right, so a
  // leader-initiated row delete would orphan the storage object forever).
  async function handleToggleHide(photo) {
    const hiding = !photo.hidden_at;
    const { error } = await supabase
      .from('gig_photos')
      .update(hiding ? { hidden_at: new Date().toISOString(), hidden_by: profile.id } : { hidden_at: null, hidden_by: null })
      .eq('id', photo.id);
    if (error) { notify("Couldn't update: " + error.message); return; }
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, hidden_at: hiding ? new Date().toISOString() : null } : p)));
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-MAX_CAPTION_PHOTOS)));
  }

  async function handleDraftCaption() {
    const ids = selectedIds.length > 0 ? selectedIds : visiblePhotos.slice(0, MAX_CAPTION_PHOTOS).map((p) => p.id);
    if (ids.length === 0) return;
    setDrafting(true);
    setCaptionError(null);
    setCaptionResult(null);
    const { data, error } = await supabase.functions.invoke('generate-gig-caption', {
      body: { gig_id: gigId, photo_ids: ids },
    });
    setDrafting(false);
    if (error || data?.error) {
      setCaptionError(data?.error || error.message);
      return;
    }
    setCaptionResult(data.caption);
    setSelecting(false);
  }

  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(
      () => notify(label + ' copied'),
      () => notify("Couldn't copy — select and copy manually.")
    );
  }

  if (!canView) return null;

  return (
    <div className="day-sheet__section" id="gig-section-photos">
      <h3 className="day-sheet__section-title">Gig photos</h3>
      <p className="field__hint" style={{ marginTop: -6, marginBottom: 10 }}>
        {canManage
          ? "Anyone confirmed on this gig's roster can add photos here — you get notified when they do."
          : "Share your photos from the gig — your band leader gets notified so they can use them for a post."}
      </p>

      {canUpload && gigHasHappened && (
        <div style={{ marginBottom: 12 }}>
          <label className="btn btn--primary btn--small" style={{ cursor: 'pointer', display: 'inline-block' }}>
            {uploading ? `Uploading ${uploadProgress?.done ?? 0}/${uploadProgress?.total ?? 0}…` : '📷 Add photos'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesSelected}
              disabled={uploading}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      )}
      {canUpload && !gigHasHappened && (
        <p className="field__hint">You'll be able to add photos once this gig has happened.</p>
      )}

      {loading ? (
        <p className="field__hint">Loading photos…</p>
      ) : visiblePhotos.length === 0 ? (
        <p className="field__hint">No photos yet.</p>
      ) : (
        <div className="gig-photos__grid">
          {visiblePhotos.map((photo) => {
            const isMine = photo.uploaded_by === profile?.id;
            const canDeleteThis = isMine || isAdmin;
            return (
              <div key={photo.id} className={'gig-photos__thumb' + (photo.hidden_at ? ' gig-photos__thumb--hidden' : '')}>
                <img src={publicUrl(photo.storage_path)} alt="" loading="lazy" onClick={() => setLightboxPhoto(photo)} />
                {selecting ? (
                  <label className="gig-photos__select">
                    <input type="checkbox" checked={selectedIds.includes(photo.id)} onChange={() => toggleSelected(photo.id)} />
                  </label>
                ) : (
                  <>
                    {canDeleteThis && (
                      <button type="button" className="gig-photos__delete" title="Delete" onClick={() => handleDelete(photo)}>×</button>
                    )}
                    {canManage && !isMine && (
                      <button
                        type="button"
                        className="gig-photos__hide"
                        title={photo.hidden_at ? 'Unhide' : 'Hide'}
                        onClick={() => handleToggleHide(photo)}
                      >
                        {photo.hidden_at ? '👁' : '🙈'}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && visiblePhotos.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          {!selecting ? (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => { setSelecting(true); setSelectedIds([]); }}>
              ✨ Draft a social post
            </button>
          ) : (
            <div>
              <p className="field__hint" style={{ marginBottom: 8 }}>
                Pick up to {MAX_CAPTION_PHOTOS} photos ({selectedIds.length} selected — leave none picked to use the {MAX_CAPTION_PHOTOS} most recent).
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn--primary btn--small" onClick={handleDraftCaption} disabled={drafting}>
                  {drafting ? 'Drafting…' : 'Draft caption'}
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setSelecting(false)}>Cancel</button>
              </div>
            </div>
          )}
          {captionError && <p className="form-error" style={{ marginTop: 8 }}>{captionError}</p>}
        </div>
      )}

      {lightboxPhoto && (
        <div className="modal-overlay" onClick={() => setLightboxPhoto(null)}>
          <div className="modal-panel gig-photos__lightbox" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button type="button" className="link-button" onClick={() => setLightboxPhoto(null)}>Close</button>
            </div>
            <img src={publicUrl(lightboxPhoto.storage_path)} alt="" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />
            <p className="field__hint" style={{ marginTop: 8 }}>
              Uploaded by {lightboxPhoto.profiles?.full_name || 'someone'}
            </p>
          </div>
        </div>
      )}

      {captionResult && (
        <div className="modal-overlay" onClick={() => setCaptionResult(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Draft social post</h3>
              <button type="button" className="link-button" onClick={() => setCaptionResult(null)}>Close</button>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Caption</span>
              <textarea readOnly value={captionResult.caption} rows={4} />
              <button type="button" className="link-button" style={{ marginTop: 4 }} onClick={() => copyToClipboard(captionResult.caption, 'Caption')}>
                Copy caption
              </button>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <span className="field__label">Hashtags</span>
              <p style={{ margin: '4px 0' }}>{(captionResult.hashtags || []).map((h) => '#' + h).join(' ')}</p>
              <button
                type="button"
                className="link-button"
                onClick={() => copyToClipboard((captionResult.hashtags || []).map((h) => '#' + h).join(' '), 'Hashtags')}
              >
                Copy hashtags
              </button>
            </div>

            {captionResult.best_time_suggestion && (
              <div className="field" style={{ marginTop: 12 }}>
                <span className="field__label">When to post</span>
                <p style={{ margin: '4px 0' }}>{captionResult.best_time_suggestion}</p>
                <p className="field__hint">General posting-time guidance — not based on this band's actual audience data.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
