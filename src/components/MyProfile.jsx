import { useEffect, useState } from 'react';
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

const UI_THEMES = [
  { id: 'default', label: 'Classic', swatch: '#c8862e' },
  { id: 'ocean', label: 'Ocean', swatch: '#2f6690' },
  { id: 'forest', label: 'Forest', swatch: '#4a7c59' },
  { id: 'rose', label: 'Rose', swatch: '#b5566f' },
];

export default function MyProfile() {
  const { refreshProfile } = useCurrentProfile();
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
  const [originalIds, setOriginalIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [userId, setUserId] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);
      setEmail(userData.user.email || '');

      const [{ data: profile, error: profileError }, { data: instruments }, { data: links }] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, home_address, home_latitude, home_longitude, share_phone_on_daysheet, available_for_dep_work, ui_theme, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, equipment_notes, avatar_url').eq('id', uid).single(),
        supabase.from('instruments').select('id, name').order('sort_order'),
        supabase.from('profile_instruments').select('instrument_id').eq('profile_id', uid),
      ]);

      if (profileError) setError(profileError.message);
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
      }
      setAllInstruments(instruments || []);
      const ids = (links || []).map((l) => l.instrument_id);
      setSelectedIds(ids);
      setOriginalIds(ids);
      setLoading(false);
    }
    load();
  }, []);

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
      setError("That doesn't look like an image file — please choose a photo.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('That image is too large (max 20MB) — please choose a smaller file.');
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    try {
      // Small and heavily compressed on purpose — this is shown at avatar/
      // thumbnail size almost everywhere (roster rows, day sheets, the
      // header icon), never full-screen, and storage is tight.
      const blob = await resizeImageFile(file, { maxWidth: 400, maxHeight: 400, quality: 0.85, maxBytes: 60 * 1024 });
      const path = userId + '/avatar.webp';
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/webp' });
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
      setError(err.message);
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

  async function handleSave(e) {
    e.preventDefault();

    // Guards against silently wiping every instrument on file -- e.g. the
    // picker not finishing its fetch before a fast Save click. Removing
    // some while keeping others needs no extra confirmation.
    if (originalIds.length > 0 && selectedIds.length === 0) {
      const ok = await confirmAsync('This removes every instrument on your profile (' + originalIds.length + '). Continue?');
      if (!ok) return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    const toAdd = selectedIds.filter((id) => !originalIds.includes(id));
    const toRemove = originalIds.filter((id) => !selectedIds.includes(id));

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        phone: phone || null,
        home_address: homeAddress || null,
        home_latitude: homeLat,
        home_longitude: homeLon,
        share_phone_on_daysheet: sharePhoneOnDaysheet,
        available_for_dep_work: availableForDepWork,
        ui_theme: uiTheme,
        ...equipment,
        equipment_notes: equipmentNotes || null,
      })
      .eq('id', userId);

    let writeError = profileError;

    if (!writeError && toAdd.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .insert(toAdd.map((instrument_id) => ({ profile_id: userId, instrument_id })));
      writeError = error;
    }
    if (!writeError && toRemove.length > 0) {
      const { error } = await supabase
        .from('profile_instruments')
        .delete()
        .eq('profile_id', userId)
        .in('instrument_id', toRemove);
      writeError = error;
    }

    setSaving(false);
    if (writeError) setError(writeError.message);
    else {
      setOriginalIds(selectedIds);
      setSaved(true);
      // Same reason as the avatar handlers above -- the header icon and any
      // other consumer of useCurrentProfile() has its own cached copy of
      // full_name/ui_theme that this write doesn't touch on its own.
      await refreshProfile();
    }
  }

  if (loading) return <p className="state-message">Loading profile…</p>;

  const buildTimeLabel = APP_BUILD_TIME
    ? new Date(APP_BUILD_TIME).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <>
      <form className="entity-form" onSubmit={handleSave}>
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
            Shown on the roster, gig day sheets and here in the app. Resized and compressed automatically — any reasonable photo works.
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
          <span className="field__label">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label className="field">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={sharePhoneOnDaysheet}
              onChange={(e) => setSharePhoneOnDaysheet(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span className="field__label" style={{ marginBottom: 0 }}>Share my phone number with bandmates</span>
            <InfoTooltip text="Shows your number to other confirmed musicians on the gig day sheet. Off by default." />
          </span>
        </label>

        <label className="field">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={availableForDepWork}
              onChange={(e) => setAvailableForDepWork(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span className="field__label" style={{ marginBottom: 0 }}>Available for dep work</span>
            <InfoTooltip text="Makes your profile visible to band leaders looking for deps/session musicians, even for bands you're not on. Off by default." />
          </span>
        </label>

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
                onClick={() => {
                  setUiTheme(t.id);
                  document.documentElement.setAttribute('data-theme', t.id);
                }}
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
          <InstrumentPicker allInstruments={allInstruments} selectedIds={selectedIds} onChange={setSelectedIds} />
        </label>


        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-success">Saved.</p>}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <div className="day-sheet__section">
        <h3 className="day-sheet__section-title">App setup</h3>
        <PwaSetupGuide showHeader={false} />
      </div>

      <ProSubscription />
      {userId && <ConnectPayoutSetup profileId={userId} />}
      {userId && <ProfilePaymentDetails profileId={userId} />}
      {userId && <MyAvailability profileId={userId} />}
      {userId && <MyRepertoire profileId={userId} />}
      {userId && <OutstandingClaims profileId={userId} />}
      {userId && <MyExpenses profileId={userId} />}
      {userId && <MyIncome profileId={userId} />}
      {userId && <MyMileage profileId={userId} />}
      {userId && <TaxRecords profileId={userId} />}

      <div className="field" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, margin: '24px 0 0' }}>
        <span className="field__label">Your data</span>
        <p className="field__hint" style={{ margin: 0 }}>
          When you use this app, we log basic technical info — device type, browser, screen size, whether
          you've installed it as a PWA, your notification permission, your IP address, and when you were
          last active. This is used only by the admin, to monitor app usage and troubleshoot problems
          — never shared outside the app, and not visible to band leaders or other musicians.
        </p>
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