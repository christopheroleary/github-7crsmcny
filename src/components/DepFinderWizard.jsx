import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { notify } from '../utils/toastService.js';
import { fetchDrivingMiles } from '../utils/distance.js';
import { formatShortDate } from '../utils/formatDate.js';
import { toWhatsAppNumber } from '../utils/phone.js';
import EquipmentTags from './EquipmentTags.jsx';
import NumberInput from './NumberInput.jsx';
import Avatar from './Avatar.jsx';

const DAY_KEYS = ['avail_sun', 'avail_mon', 'avail_tue', 'avail_wed', 'avail_thu', 'avail_fri', 'avail_sat'];

function availKeyForDate(dateStr) {
  return DAY_KEYS[new Date(dateStr + 'T00:00:00').getDay()];
}

function distanceLabel(entry) {
  if (entry.lat == null || entry.lon == null) return 'No home address set';
  if (entry.distanceMiles == null) return 'Calculating…';
  return Math.round(entry.distanceMiles) + ' mi away';
}

// Admin-only: given a gig + instrument, ranks every musician/placeholder dep
// who plays it by whether they're free that day and how far they'd have to
// drive, so admin doesn't have to manually cross-check availability against
// a mental list of who lives where. Musicians who are busy elsewhere or have
// marked themselves unavailable are hidden by default but never fully
// removed — a collapsed section still surfaces them for the "everyone I'd
// normally ask is unavailable" case.
export default function DepFinderWizard({ gigId, instruments, initialInstrumentId, onClose, onAdded }) {
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId || instruments?.[0]?.id || '');
  const [loading, setLoading] = useState(true);
  const [gigDate, setGigDate] = useState(null);
  const [venue, setVenue] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [distancesReady, setDistancesReady] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [maxMiles, setMaxMiles] = useState('');
  const [setlistTotal, setSetlistTotal] = useState(0);

  const load = useCallback(async () => {
    if (!instrumentId) return;
    setLoading(true);
    setDistancesReady(false);

    const { data: gig } = await supabase
      .from('gigs')
      .select('gig_date, venues(name, latitude, longitude)')
      .eq('id', gigId)
      .single();

    const date = gig?.gig_date || null;
    setGigDate(date);
    setVenue(gig?.venues || null);

    const [{ data: lineup }, { data: profileLinks }, { data: placeholderLinks }] = await Promise.all([
      supabase.from('gig_lineup').select('profile_id, placeholder_id').eq('gig_id', gigId),
      supabase
        .from('profile_instruments')
        .select('profile_id, profiles(id, full_name, phone, is_active, home_latitude, home_longitude, home_address, avail_sun, avail_mon, avail_tue, avail_wed, avail_thu, avail_fri, avail_sat, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting, avatar_url)')
        .eq('instrument_id', instrumentId),
      supabase
        .from('placeholder_musician_instruments')
        .select('placeholder_id, placeholder_musicians(id, name, phone, latitude, longitude, address, merged_into, has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting)')
        .eq('instrument_id', instrumentId),
    ]);

    const bookedProfileIds = new Set((lineup || []).map((l) => l.profile_id).filter(Boolean));
    const bookedPlaceholderIds = new Set((lineup || []).map((l) => l.placeholder_id).filter(Boolean));

    const profileCandidates = (profileLinks || [])
      .map((l) => l.profiles)
      .filter((p) => p && p.is_active && !bookedProfileIds.has(p.id));
    const placeholderCandidates = (placeholderLinks || [])
      .map((l) => l.placeholder_musicians)
      .filter((p) => p && !p.merged_into && !bookedPlaceholderIds.has(p.id));

    // Which setlist(s) are attached to this gig, so candidates can be
    // ranked by how much of the actual setlist they already know -- not
    // just whether they're free and nearby.
    const { data: gigSetlists } = await supabase.from('gig_setlists').select('setlist_id').eq('gig_id', gigId);
    const setlistIds = (gigSetlists || []).map((gs) => gs.setlist_id);
    let setlistSongIds = [];
    if (setlistIds.length > 0) {
      const { data: items } = await supabase.from('setlist_items').select('song_id').in('setlist_id', setlistIds);
      setlistSongIds = [...new Set((items || []).map((i) => i.song_id).filter(Boolean))];
    }
    setSetlistTotal(setlistSongIds.length);

    let busyProfileIds = new Set();
    let busyPlaceholderIds = new Set();
    let blackedOutProfileIds = new Set();
    const knownByProfile = {};
    const knownByPlaceholder = {};
    const leadByProfile = {};
    const leadByPlaceholder = {};

    if (date && (profileCandidates.length > 0 || placeholderCandidates.length > 0)) {
      const { data: busyRows } = await supabase
        .from('gig_lineup')
        .select('profile_id, placeholder_id, gigs!inner(gig_date, status)')
        .eq('gigs.gig_date', date)
        .neq('gigs.status', 'cancelled')
        .neq('gig_id', gigId);
      busyProfileIds = new Set((busyRows || []).map((r) => r.profile_id).filter(Boolean));
      busyPlaceholderIds = new Set((busyRows || []).map((r) => r.placeholder_id).filter(Boolean));

      if (profileCandidates.length > 0) {
        const { data: blackouts } = await supabase
          .from('musician_unavailable_dates')
          .select('profile_id')
          .eq('date', date)
          .in('profile_id', profileCandidates.map((p) => p.id));
        blackedOutProfileIds = new Set((blackouts || []).map((b) => b.profile_id));
      }
    }

    if (setlistSongIds.length > 0) {
      const [{ data: ks }, { data: pks }] = await Promise.all([
        profileCandidates.length > 0
          ? supabase.from('known_songs').select('profile_id, song_id, can_sing_lead').in('song_id', setlistSongIds).in('profile_id', profileCandidates.map((p) => p.id))
          : Promise.resolve({ data: [] }),
        placeholderCandidates.length > 0
          ? supabase.from('placeholder_known_songs').select('placeholder_id, song_id, can_sing_lead').in('song_id', setlistSongIds).in('placeholder_id', placeholderCandidates.map((p) => p.id))
          : Promise.resolve({ data: [] }),
      ]);
      (ks || []).forEach((r) => {
        (knownByProfile[r.profile_id] ??= new Set()).add(r.song_id);
        if (r.can_sing_lead) (leadByProfile[r.profile_id] ??= new Set()).add(r.song_id);
      });
      (pks || []).forEach((r) => {
        (knownByPlaceholder[r.placeholder_id] ??= new Set()).add(r.song_id);
        if (r.can_sing_lead) (leadByPlaceholder[r.placeholder_id] ??= new Set()).add(r.song_id);
      });
    }

    const availKey = date ? availKeyForDate(date) : null;

    const built = [
      ...profileCandidates.map((p) => ({
        kind: 'profile',
        id: p.id,
        name: p.full_name,
        avatarUrl: p.avatar_url,
        phone: p.phone,
        lat: p.home_latitude,
        lon: p.home_longitude,
        busy: busyProfileIds.has(p.id),
        weekdayAvailable: availKey ? Boolean(p[availKey]) : null,
        blackedOut: blackedOutProfileIds.has(p.id),
        distanceMiles: null,
        songsKnown: setlistSongIds.length > 0 ? (knownByProfile[p.id]?.size || 0) : null,
        songsLead: setlistSongIds.length > 0 ? (leadByProfile[p.id]?.size || 0) : null,
        equipment: p,
      })),
      ...placeholderCandidates.map((p) => ({
        kind: 'placeholder',
        id: p.id,
        name: p.name,
        phone: p.phone,
        lat: p.latitude,
        lon: p.longitude,
        busy: busyPlaceholderIds.has(p.id),
        weekdayAvailable: null,
        blackedOut: false,
        distanceMiles: null,
        songsKnown: setlistSongIds.length > 0 ? (knownByPlaceholder[p.id]?.size || 0) : null,
        songsLead: setlistSongIds.length > 0 ? (leadByPlaceholder[p.id]?.size || 0) : null,
        equipment: p,
      })),
    ];

    setCandidates(built);
    setLoading(false);

    if (venueOk(gig?.venues)) {
      const withDistance = await Promise.all(
        built.map(async (c) => {
          if (c.lat == null || c.lon == null) return c;
          try {
            const miles = await fetchDrivingMiles(c.lat, c.lon, gig.venues.latitude, gig.venues.longitude);
            return { ...c, distanceMiles: miles };
          } catch {
            return c;
          }
        })
      );
      setCandidates(withDistance);
    }
    setDistancesReady(true);
  }, [gigId, instrumentId]);

  function venueOk(v) {
    return v && v.latitude != null && v.longitude != null;
  }

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(candidate) {
    setAddingId(candidate.id);
    const payload = {
      gig_id: gigId,
      instrument_id: instrumentId,
      confirmed: false,
      profile_id: candidate.kind === 'profile' ? candidate.id : null,
      placeholder_id: candidate.kind === 'placeholder' ? candidate.id : null,
    };
    const { error } = await supabase.from('gig_lineup').insert(payload);
    setAddingId(null);
    if (error) {
      notify("Couldn't add " + candidate.name + ': ' + error.message);
      return;
    }
    notify(candidate.name + ' added to the gig.');
    if (onAdded) onAdded();
    setCandidates((cs) => cs.filter((c) => c.id !== candidate.id));
  }

  function outsideRadius(c) {
    if (maxMiles === '') return false;
    const limit = Number(maxMiles);
    return !Number.isNaN(limit) && c.distanceMiles != null && c.distanceMiles > limit;
  }

  function isAvailable(c) {
    if (c.busy) return false;
    if (outsideRadius(c)) return false;
    if (c.kind === 'placeholder') return true;
    return c.weekdayAvailable !== false && !c.blackedOut;
  }

  function reasonLabel(c) {
    if (c.busy) return 'Already on another gig that day';
    if (outsideRadius(c)) return 'Outside ' + maxMiles + ' mi radius';
    if (c.blackedOut) return 'Marked unavailable this date';
    if (c.weekdayAvailable === false) return 'Not usually free that day of the week';
    return null;
  }

  const sorted = [...candidates].sort((a, b) => {
    // Setlist match is the primary sort when this gig has one attached --
    // knowing the actual songs matters more than being slightly closer.
    // Distance remains the tiebreaker, and the only sort key at all when
    // there's no setlist to compare against.
    if (setlistTotal > 0) {
      const aFrac = (a.songsKnown || 0) / setlistTotal;
      const bFrac = (b.songsKnown || 0) / setlistTotal;
      if (aFrac !== bFrac) return bFrac - aFrac;
    }
    if (a.distanceMiles == null && b.distanceMiles == null) return a.name.localeCompare(b.name);
    if (a.distanceMiles == null) return 1;
    if (b.distanceMiles == null) return -1;
    return a.distanceMiles - b.distanceMiles;
  });
  const available = sorted.filter(isAvailable);
  const unavailable = sorted.filter((c) => !isAvailable(c));

  function renderRow(c) {
    const wa = toWhatsAppNumber(c.phone);
    return (
      <li className="simple-list__item" key={c.kind + c.id}>
        <div className="simple-list__row">
          <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
            <Avatar url={c.avatarUrl} name={c.name} />
          <div>
            <span className="simple-list__title">
              {c.name}
              {c.kind === 'placeholder' && (
                <span className="status-tag" style={{ marginLeft: 8, background: 'rgba(107,99,87,0.12)', color: 'var(--text-muted)' }}>
                  dep
                </span>
              )}
              {wa && (
                <a
                  href={'https://wa.me/' + wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-button"
                  style={{ marginLeft: 8 }}
                  title={'WhatsApp ' + c.name}
                >
                  💬 WhatsApp
                </a>
              )}
            </span>
            <span className="simple-list__subtitle">
              {distanceLabel(c)}
              {c.kind === 'placeholder' && ' · no availability data'}
              {setlistTotal > 0 && ' · 🎵 ' + (c.songsKnown || 0) + '/' + setlistTotal + ' setlist songs known'}
              {setlistTotal > 0 && c.songsLead > 0 && ' (' + c.songsLead + ' as lead vocal)'}
              {reasonLabel(c) && ' · ' + reasonLabel(c)}
            </span>
            <EquipmentTags values={c.equipment} />
          </div>
          </div>
          <div className="simple-list__actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              style={{ width: 'auto' }}
              onClick={() => handleAdd(c)}
              disabled={addingId === c.id}
            >
              {addingId === c.id ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Find a dep</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>
        <p className="field__hint" style={{ marginBottom: 12 }}>
          {gigDate ? formatShortDate(gigDate) : ''}{venue?.name ? ' · ' + venue.name : ''}
          {!venueOk(venue) && ' · venue has no map pin, can\'t rank by distance'}
          {!loading && setlistTotal === 0 && ' · no setlist attached, can\'t rank by songs known'}
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <label className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <span className="field__label">Instrument</span>
            <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              {(instruments || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: '0 1 140px', marginBottom: 0 }}>
            <span className="field__label">Within (miles)</span>
            <NumberInput min={1} value={maxMiles} onChange={(e) => setMaxMiles(e.target.value)} placeholder="No limit" />
          </label>
        </div>

        {loading && <p className="state-message">Searching…</p>}

        {!loading && candidates.length === 0 && (
          <p className="field__hint">Nobody plays this instrument yet — add them under Musicians, or as a dep.</p>
        )}

        {!loading && available.length === 0 && candidates.length > 0 && (
          <p className="field__hint">Nobody who plays this is free — see below to invite anyway.</p>
        )}

        {available.length > 0 && (
          <ul className="simple-list" style={{ marginBottom: 12 }}>
            {available.map(renderRow)}
          </ul>
        )}

        {!distancesReady && candidates.length > 0 && (
          <p className="field__hint" style={{ marginTop: -6, marginBottom: 12 }}>Calculating distances…</p>
        )}

        {unavailable.length > 0 && (
          <>
            <button type="button" className="link-button" onClick={() => setShowUnavailable((v) => !v)}>
              {showUnavailable ? 'Hide' : 'Show'} {unavailable.length} busy or unavailable
            </button>
            {showUnavailable && (
              <ul className="simple-list" style={{ marginTop: 8 }}>
                {unavailable.map(renderRow)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
