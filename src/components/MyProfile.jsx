import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import InstrumentPicker from './InstrumentPicker.jsx';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import NotificationSetup from './NotificationSetup.jsx';
import ProfilePaymentDetails from './ProfilePaymentDetails';
import MyExpenses from './MyExpenses.jsx';
import MyIncome from './MyIncome.jsx';
import MyMileage from './MyMileage.jsx';
import OutstandingClaims from './OutstandingClaims.jsx';
import TaxRecords from './TaxRecords.jsx';
import MyAvailability from './MyAvailability.jsx';
import InfoTooltip from './InfoTooltip.jsx';
import { forceRefreshApp } from '../utils/serviceWorker.js';
import { confirmAsync } from '../utils/confirmService.js';

const UI_THEMES = [
  { id: 'default', label: 'Classic', swatch: '#c8862e' },
  { id: 'ocean', label: 'Ocean', swatch: '#2f6690' },
  { id: 'forest', label: 'Forest', swatch: '#4a7c59' },
  { id: 'rose', label: 'Rose', swatch: '#b5566f' },
];

export default function MyProfile() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [sharePhoneOnDaysheet, setSharePhoneOnDaysheet] = useState(false);
  const [availableForDepWork, setAvailableForDepWork] = useState(false);
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

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      setUserId(uid);
      setEmail(userData.user.email || '');

      const [{ data: profile, error: profileError }, { data: instruments }, { data: links }] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, home_address, home_latitude, home_longitude, share_phone_on_daysheet, available_for_dep_work, ui_theme').eq('id', uid).single(),
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
      }
      setAllInstruments(instruments || []);
      const ids = (links || []).map((l) => l.instrument_id);
      setSelectedIds(ids);
      setOriginalIds(ids);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
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
    }
  }

  if (loading) return <p className="state-message">Loading profile…</p>;

  return (
    <>
      <form className="entity-form" onSubmit={handleSave}>
        <h2 className="section-header__title">My profile</h2>

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

        <div className="field">
          <span className="field__label">Notifications</span>
          <NotificationSetup />
        </div>

        <div className="field">
          <span className="field__label">App feels out of date?</span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={async () => {
              if (await confirmAsync('Refresh the app and clear its cache? Any unsaved changes will be lost.')) {
                forceRefreshApp();
              }
            }}
          >
            Refresh app
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-success">Saved.</p>}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      {userId && <ProfilePaymentDetails profileId={userId} />}
      {userId && <MyAvailability profileId={userId} />}
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
    </>
  );
}