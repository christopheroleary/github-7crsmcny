import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import InstrumentPicker from './InstrumentPicker.jsx';
import EquipmentFields from './EquipmentFields.jsx';
import { EQUIPMENT_ITEMS } from '../utils/equipment.js';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import ProfilePaymentDetails from './ProfilePaymentDetails';
import ConnectPayoutSetup from './ConnectPayoutSetup.jsx';
import ProSubscription from './ProSubscription.jsx';
import PwaSetupGuide from './PwaSetupGuide.jsx';
import CalendarFeed from './CalendarFeed.jsx';
import MyExpenses from './MyExpenses.jsx';
import MyIncome from './MyIncome.jsx';
import MyMileage from './MyMileage.jsx';
import OutstandingClaims from './OutstandingClaims.jsx';
import TaxRecords from './TaxRecords.jsx';
import MyAvailability from './MyAvailability.jsx';
import MyRepertoire from './MyRepertoire.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import Avatar from './Avatar.jsx';
import { forceRefreshApp } from '../utils/serviceWorker.js';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';
import { resizeImageFile } from '../utils/resizeImage.js';
import { APP_VERSION, APP_BUILD_TIME } from '../utils/buildInfo.js';

const AVATAR_BUCKET = 'profile-pictures';
const AUTOSAVE_DELAY = 700;

const UI_THEMES = [
  { id: 'default', label: 'Classic', swatch: '#c8862e' },
  { id: 'ocean', label: 'Ocean', swatch: '#2f6690' },
  { id: 'forest', label: 'Forest', swatch: '#4a7c59' },
  { id: 'rose', label: 'Rose', swatch: '#b5566f' },
];

export default function MyProfile() {
  const { refreshProfile, isAdmin } = useCurrentProfile();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [sharePhoneOnDaysheet, setSharePhoneOnDaysheet] = useState(false);
  const [availableForDepWork, setAvailableForDepWork] = useState(false);
  const [equipment, setEquipment] = useState({});
  const [equipmentNotes, setEquipmentNotes] = useState('');
  const [uiTheme, setUiTheme] = useState('default');
  const [homeAddress, setHomeAddress] = useState('');
  const [homeLat, setHomeLat] = useState(null);
  const [homeLon, setHomeLon] = useState(null);
  const [allInstruments, setAllInstruments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [userId, setUserId] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [usageLoggingOptOut, setUsageLoggingOptOut] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);
      setEmail(userData.user.email || '');

      const [{ data: profile, error: profileError }, { data: instruments }, { data: links }] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, home_address, home_latitude, home_longitude, share_phone_on_daysheet, available_for_dep_work, ui_theme, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, equipment_notes, avatar_url, usage_logging_opt_out').eq('id', uid).single(),
        supabase.from('instruments').select('id, name').order('sort_order'),
        supabase.from('profile_instruments').select('instrument_id').eq('profile_id', uid),
      ]);

      if (profileError) notify("Couldn't load profile: " + profileError.message);
      else {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
        setHomeAddress(profile.home_address || '');
        setHomeLat(profile.home_latitude ?? null);
        setHomeLon(profile.home_longitude ?? null);
        setSharePhoneOnDaysheet(Boolean(profile.share_phone_on_daysheet));
        setAvailableForDepWork(Boolean(profile.available_for_dep_work));
        setUiTheme(profile.ui_theme || 'default');
        setEquipment(Object.fromEntries(EQUIPMENT_ITEMS.map((item) => [item.key, Boolean(profile[item.key])])));
        setEquipmentNotes(profile.equipment_notes || '');
        setAvatarUrl(profile.avatar_url || '');
        setUsageLoggingOptOut(Boolean(profile.usage_logging_opt_out));
      }
      setAllInstruments(instruments || []);
      setSelectedIds((links || []).map((l) => l.instrument_id));
      setLoading(false);
    }
    load();
  }, []);

  // Every text/checkbox/theme field below saves itself as the user edits it
  // -- no Save button. `readyRef` stops the very first render (the initial
  // load populating these fields from the DB) from immediately re-saving
  // the same values back; it flips true in the effect declared last below,
  // which -- since effects in one commit run in declaration order -- always
  // runs after every field-autosave effect on that same load-triggered
  // commit, so the guard is still false when each of them checks it.
  const readyRef = useRef(false);

  async function persist(patch, onFail) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) {
      notify("Couldn't save: " + error.message);
      onFail?.();
    }
  }

  useEffect(() => {
    if (!readyRef.current || !userId) return;
    if (!fullName.trim()) return; // never autosave a blank name mid-edit
    const t = setTimeout(() => persist({ full_name: fullName }), AUTOSAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullName]);

  useEffect(() => {
    if (!readyRef.current || !userId) return;
    const t = setTimeout(() => persist({ phone: phone || null }), AUTOSAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => {
    if (!readyRef.current || !userId) return;
    const t = setTimeout(
      () => persist({ home_address: homeAddress || null, home_latitude: homeLat, home_longitude: homeLon }),
      AUTOSAVE_DELAY
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeAddress, homeLat, homeLon]);

  useEffect(() => {
    if (!readyRef.current || !userId) return;
    const t = setTimeout(() => persist({ ...equipment, equipment_notes: equipmentNotes || null }), AUTOSAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, equipmentNotes]);

  useEffect(() => {
    if (!loading) readyRef.current = true;
  }, [loading]);

  async function handleSharePhoneToggle(checked) {
    setSharePhoneOnDaysheet(checked);
    await persist({ share_phone_on_daysheet: checked }, () => setSharePhoneOnDaysheet(!checked));
  }

  async function handleDepToggle(checked) {
    setAvailableForDepWork(checked);
    await persist({ available_for_dep_work: checked }, () => setAvailableForDepWork(!checked));
  }

  // Takes effect from the NEXT sign-in / app open onward -- maybeLogSession
  // only runs once per load in ProfileContext.jsx, so a session already in
  // progress when this is flipped doesn't retroactively un-log anything,
  // there's simply nothing further to opt out of until the next one fires.
  async function handleUsageLoggingOptOutToggle(checked) {
    setUsageLoggingOptOut(checked);
    await persist({ usage_logging_opt_out: checked }, () => setUsageLoggingOptOut(!checked));
  }

  async function handleThemeChange(themeId) {
    const previous = uiTheme;
    setUiTheme(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    await persist({ ui_theme: themeId }, () => {
      setUiTheme(previous);
      document.documentElement.setAttribute('data-theme', previous);
    });
  }

  // Each button click adds/removes exactly one known id -- using React's
  // functional setState form (rather than computing a full next-array from
  // a closured `selectedIds` snapshot, as this used to) means two clicks
  // landing in the same render tick still apply correctly in order instead
  // of the second clobbering the first. That clobbering was a real, live
  // bug: both deletes would actually succeed in the database, but the
  // second click's optimistic state overwrote the first click's, leaving a
  // just-deleted instrument still showing as selected on screen until the
  // next reload -- which then looked exactly like removing one instrument
  // had silently also removed another.
  async function handleAddInstrument(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const { error } = await supabase.from('profile_instruments').insert({ profile_id: userId, instrument_id: id });
    if (error) {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      notify("Couldn't save: " + error.message);
    }
  }

  async function handleRemoveInstrument(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    const { error } = await supabase.from('profile_instruments').delete().eq('profile_id', userId).eq('instrument_id', id);
    if (error) {
      setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      notify("Couldn't save: " + error.message);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId) return;
    // Fast, friendly rejection before we hand the file to createImageBitmap --
    // a huge or maliciously crafted "decompression bomb" image (tiny on disk,
    // enormous once decoded) can otherwise hang or crash the tab. This isn't
    // the real security boundary (a determined attacker can call the Storage
    // API directly, bypassing the browser entirely) -- that's enforced
    // server-side by the profile-pictures bucket's own file size/mime type
    // limits, set in the add_profile_avatar migration.
    if (!file.type.startsWith('image/')) {
      notify("That doesn't look like an image file — please choose a photo.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notify('That image is too large (max 20MB) — please choose a smaller file.');
      return;
    }
    setUploadingAvatar(true);
    try {
      // Small and heavily compressed on purpose — this is shown at avatar/
      // thumbnail size almost everywhere (roster rows, day sheets, the
      // header icon), never full-screen, and storage is tight.
      const blob = await resizeImageFile(file, { maxWidth: 400, maxHeight: 400, quality: 0.85, maxBytes: 60 * 1024 });
      const path = userId + '/avatar.webp';
      // canvas.toBlob('image/webp') silently falls back to image/png on any
      // browser/OS that can't encode WebP (some iOS Safari versions among
      // them) -- declaring contentType: 'image/webp' regardless of what blob
      // actually is causes Storage to reject the mismatch outright. The path
      // keeps its .webp name either way; browsers render off the real
      // Content-Type header, not the URL extension, so this is safe.
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp' });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      // Cache-bust so replacing an existing photo shows immediately instead
      // of the browser/CDN serving the old cached image at the same URL.
      const publicUrl = urlData.publicUrl + '?v=' + Date.now();
      const { error: dbError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
      if (dbError) throw dbError;
      setAvatarUrl(publicUrl);
      // The header icon (and anything else reading useCurrentProfile()) has
      // its own separate, cached copy of the profile that this write doesn't
      // touch -- without this it'd keep showing the old photo (or no photo)
      // until the next full reload.
      await refreshProfile();
    } catch (err) {
      notify("Couldn't upload photo: " + err.message);
    }
    setUploadingAvatar(false);
  }

  async function handleRemoveAvatar() {
    const ok = await confirmAsync('Remove your profile picture?');
    if (!ok) return;
    setRemovingAvatar(true);
    const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([userId + '/avatar.webp']);
    if (removeError) { notify("Couldn't remove photo: " + removeError.message); setRemovingAvatar(false); return; }
    const { error: dbError } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
    if (dbError) { notify("Couldn't remove photo: " + dbError.message); setRemovingAvatar(false); return; }
    setAvatarUrl('');
    await refreshProfile();
    setRemovingAvatar(false);
  }

  if (loading) return <p className="state-message">Loading profile…</p>;

  const buildTimeLabel = APP_BUILD_TIME
    ? new Date(APP_BUILD_TIME).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <>
      <div className="entity-form">
        <h2 className="section-header__title">My profile</h2>

        <div className="field">
          <span className="field__label">Profile picture</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar url={avatarUrl} name={fullName} size="large" />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn--ghost btn--small" style={{ cursor: 'pointer' }}>
                {uploadingAvatar ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploadingAvatar || removingAvatar} style={{ display: 'none' }} />
              </label>
              {avatarUrl && (
                <button type="button" className="link-button link-button--danger" onClick={handleRemoveAvatar} disabled={uploadingAvatar || removingAvatar}>
                  {removingAvatar ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          </div>
          <span className="field__hint" style={{ display: 'block', marginTop: 4 }}>
            Shown on the roster, gig day sheets and here in the app. Resized and compressed automatically — any reasonable photo works. Saves as soon as it's uploaded.
          </span>
        </div>

        <label className="field">
          <span className="field__label">Email</span>
          <input value={email} disabled />
          <span className="field__hint">Login email — changing it needs its own confirmation step.</span>
        </label>

        <label className="field">
          <span className="field__label">Name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>

        <label className="field">
          <span className="field__label">
            Home address
            <InfoTooltip text="Used for travel cost calculations, and to rank you by distance when admin is looking for a dep." />
          </span>
          <AddressAutocomplete
            value={homeAddress}
            onChange={(text) => {
              setHomeAddress(text);
              setHomeLat(null);
              setHomeLon(null);
            }}
            onCoordinatesChange={(lat, lon) => {
              setHomeLat(lat);
              setHomeLon(lon);
            }}
            placeholder="Start typing your home address…"
          />
          {homeLat != null && <span className="field__hint">Location set ✓</span>}
          {homeLat == null && homeAddress && (
            <span className="field__hint" style={{ color: 'var(--rust)' }}>
              Pick a suggestion from the dropdown to set the map pin — needed for distance calculation.
            </span>
          )}
        </label>

        <label className="field">
          <span className="field__label">Instruments</span>
          <InstrumentPicker allInstruments={allInstruments} selectedIds={selectedIds} onAdd={handleAddInstrument} onRemove={handleRemoveInstrument} />
        </label>

        <div className="field">
          <span className="field__label">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              padding: '9px 12px',
              background: sharePhoneOnDaysheet ? 'rgba(47,125,79,0.1)' : 'var(--paper-raised)',
              border: '1px solid ' + (sharePhoneOnDaysheet ? 'rgba(47,125,79,0.4)' : 'var(--line)'),
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={sharePhoneOnDaysheet}
              onChange={(e) => handleSharePhoneToggle(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>📱 Share this number with bandmates on the day sheet</span>
            <InfoTooltip text="Shows the phone number above to other confirmed musicians on the gig day sheet, so they can reach you on the day. Off by default." />
          </label>
        </div>

        <label className="field">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={availableForDepWork}
              onChange={(e) => handleDepToggle(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span className="field__label" style={{ marginBottom: 0 }}>Available for dep work</span>
            <InfoTooltip text="Makes your profile visible to band leaders looking for deps/session musicians, even for bands you're not on. Off by default." />
          </span>
        </label>

        {availableForDepWork && (
          <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: '2px 14px 14px', margin: '4px 0 18px' }}>
            <p className="field__hint" style={{ marginTop: 12, marginBottom: 0 }}>
              Band leaders looking for a dep see these three things together — fill them in so they can tell if you're a good fit.
            </p>

            <div className="field">
              <span className="field__label">
                Equipment you can bring
                <InfoTooltip text="Deps who can turn up with their own PA, monitors and lights are in high demand — this shows up wherever bands are looking for a dep, so tick anything you own and can bring." />
              </span>
              <EquipmentFields
                values={equipment}
                onToggle={(key, checked) => setEquipment((prev) => ({ ...prev, [key]: checked }))}
                notes={equipmentNotes}
                onNotesChange={setEquipmentNotes}
              />
            </div>

            <MyAvailability profileId={userId} />
            <MyRepertoire profileId={userId} />
          </div>
        )}

        <div className="field">
          <span className="field__label">
            App colour theme
            <InfoTooltip text="Changes the app's own colours (nav, buttons) — not your invoices/quotes/contracts, which use each band's own document theme instead (set on the band, under Bands)." />
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            {UI_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleThemeChange(t.id)}
                title={t.label}
                aria-label={t.label}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: t.swatch,
                  border: uiTheme === t.id ? '3px solid var(--ink)' : '1px solid var(--line)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">App setup</h3>
        <PwaSetupGuide showHeader={false} />
      </div>

      {userId && <CalendarFeed profileId={userId} />}

      <ProSubscription />
      {userId && <ConnectPayoutSetup profileId={userId} />}
      {userId && <ProfilePaymentDetails profileId={userId} />}
      {userId && <OutstandingClaims profileId={userId} />}
      {userId && <MyExpenses profileId={userId} />}
      {userId && <MyIncome profileId={userId} />}
      {userId && <MyMileage profileId={userId} />}
      {userId && <TaxRecords profileId={userId} />}

      <div className="field" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '24px 0 0' }}>
        <span className="field__label">Your data</span>
        <p className="field__hint" style={{ margin: 0 }}>
          So the admin can sort things out when something breaks, we note a few basics: your device,
          browser, screen size, IP address and when you last used the app. That's all — no adverts,
          no tracking, and nothing handed to analytics companies.
        </p>
        {/* Receipt scanning is the one place data leaves this app, so it's
            called out separately rather than folded into the paragraph
            above -- a receipt photo can carry your name and part of a card
            number, and people should see that plainly before they use it. */}
        <p className="field__hint" style={{ margin: '10px 0 0' }}>
          <strong>Scanned receipts.</strong> Your receipt photo is sent to Anthropic's Claude to read
          the shop, date and amounts off it. It isn't used to train their AI. The photo stays private
          here — only you and the admin can open it — and we keep it for about six years, because
          that's what HMRC asks for. A receipt can show your name or part of a card number, so scan
          what you're happy to keep; typing an expense in by hand always works too.
        </p>
        {/* Admins never have this logging happen at all (see
            ProfileContext.jsx), so showing them a toggle for it would just
            be confusing -- it'd already look "off" with nothing to opt out of. */}
        {!isAdmin && (
          <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, margin: '10px 0 0' }}>
            <input
              type="checkbox"
              checked={usageLoggingOptOut}
              onChange={(e) => handleUsageLoggingOptOutToggle(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Don't log my device and usage info</span>
          </label>
        )}
      </div>

      <div className="field" style={{ textAlign: 'center', margin: '16px 0 0' }}>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={async () => {
            if (await confirmAsync('Refresh the app and clear its cache? Any unsaved changes will be lost.')) {
              forceRefreshApp();
            }
          }}
        >
          App feels out of date? Refresh app
        </button>
      </div>

      <p style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
        Version {APP_VERSION}{buildTimeLabel ? ' · built ' + buildTimeLabel : ''}
      </p>
    </>
  );
}
