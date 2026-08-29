/**
 * stagePlotAdapter.js
 *
 * Turns this app's own rows (a gig, its venue, its gig_lineup) into the
 * config object <StagePlot initialConfig={...} /> expects. Pure mapping,
 * no network calls -- everything it needs is already loaded by the caller
 * (GigStagePlot.jsx passes through gig/venue/lineup it already has from
 * useOfflineGigData, no separate fetch here).
 */

import { displayBandName } from './bandName.js';

/* ---- instrument name -> StagePlot role ---------------------------------
   This app's real instrument set (confirmed via `select name from
   instruments`): Drums, Percussion, Bass Guitar, Double Bass, Electric
   Guitar, Acoustic Guitar, Keys, Saxophone, Lead Vocals, Backing Vocals.

   Percussion is NOT mapped to "drums" -- StagePlot only ever draws a kit
   for the first member found with role==="drums" (buildItems in
   StagePlot.jsx); a second one wouldn't get a kit, it would get nothing
   at all. It also isn't "other" any more (that role assumes an amp/DI
   rig) -- hand percussion needs a mic on a stand, not a backline choice,
   so it gets its own "percussion" role (backline: "mic"). Saxophone gets
   its own "horn" role for the same reason -- almost always just miked,
   never an amp. Both default their `source` to "mic" below. */
const INSTRUMENT_TO_ROLE = {
  Drums: 'drums',
  Percussion: 'percussion',
  'Bass Guitar': 'bass',
  'Double Bass': 'bass',
  'Electric Guitar': 'guitar',
  'Acoustic Guitar': 'guitar',
  Keys: 'keys',
  Saxophone: 'horn',
  'Lead Vocals': 'vocals',
  'Backing Vocals': 'vocals',
};

/* ---- instrument name -> default source ----------------------------------
   Real-world defaults, not a blanket guess: an acoustic-electric is DI'd,
   not mic'd/amp'd, so Acoustic Guitar seeds "di" while Electric Guitar and
   Bass Guitar/Double Bass seed "amp". Percussion/Saxophone seed "mic" via
   their role's own default, handled in roleFor's caller below. */
function sourceFor(instrumentName) {
  if (instrumentName === 'Acoustic Guitar') return 'di';
  return 'amp';
}

function roleFor(row) {
  // is_dj is an independent boolean on gig_lineup (someone can be a pure
  // DJ with no instrument_id at all) -- it wins over whatever instrument
  // is set, since StagePlot needs exactly one role per member and "dj"
  // is the one that actually needs its own booth on the plot.
  if (row.is_dj) return 'dj';
  const name = row.instruments?.name;
  return (name && INSTRUMENT_TO_ROLE[name]) || 'other';
}

/* ---- venue -> StagePlot stage preset ------------------------------------
   venues.stage_width_m/stage_depth_m/has_stage_riser are optional columns
   (added alongside this feature) -- unset falls back to the "club" preset,
   StagePlot's middle-ground size, rather than a guess from unreliable
   text. A venue used repeatedly only needs measuring once, in VenueForm,
   for every future gig there to size correctly from here on. */
function stagePresetFromVenue(venue) {
  const hasCustomDims = venue && (venue.stage_width_m || venue.stage_depth_m);
  return { hasCustomDims };
}

let n = 0;
const stableId = (seed) => `sp_${seed || 'm'}_${(n++).toString(36)}`;

/**
 * buildStagePlotSeed({ gig, venue, lineup, hasBackingTracks })
 *
 *   gig     a gigs row -- reads gig_date, roadie_stage_layout, band_id
 *           (via bands(name), already joined by useOfflineGigData)
 *   venue   a venues row (or null) -- reads name, stage_width_m,
 *           stage_depth_m, has_stage_riser
 *   lineup  gig_lineup rows, joined to profiles(full_name),
 *           placeholder_musicians(name), instruments(name) -- same shape
 *           GigRoster.jsx/BandLeaderGigGrid.jsx already fetch
 *   hasBackingTracks  boolean, computed by the caller from whether this
 *           gig's setlist has any song with a backing track for this band
 *           (see useBandBackingTrackSongIds.js) -- real automation
 *           instead of a manual flag nobody remembers to tick
 */
export function buildStagePlotSeed({ gig = {}, venue = null, lineup = [], hasBackingTracks = false } = {}) {
  const members = lineup
    // A roadie-only row (no instrument, not the DJ) isn't a performer --
    // no stage position, no input-list channel.
    .filter((row) => row.instrument_id || row.is_dj || row.is_captain)
    .map((row) => {
      const name = row.profiles?.full_name || row.placeholder_musicians?.name || 'Member';
      // vocal_role is 'lead' | 'backing' | 'none' | null -- confirmed by
      // reading real rows: 'none' is a genuine explicit value distinct
      // from null (GigRoster's own picker has a "No vocals" option),
      // so `!= null` alone would wrongly count a "none" row as singing.
      // Separately, someone whose *instrument itself* is Lead/Backing
      // Vocals can have vocal_role sitting null (also confirmed against
      // real data) -- vocal_role there is really "does a non-singing
      // instrument ALSO cover vocals", not the only source of truth, so
      // the instrument name is checked independently and OR'd in.
      const instrumentName = row.instruments?.name;
      const instrumentSings = instrumentName === 'Lead Vocals' || instrumentName === 'Backing Vocals';
      const sings = instrumentSings || row.vocal_role === 'lead' || row.vocal_role === 'backing';
      const lead = instrumentName === 'Lead Vocals' || row.vocal_role === 'lead';
      const role = roleFor(row);
      return {
        id: stableId(row.id),
        name,
        role,
        sings,
        // Real bands do have co-leads -- two singers trading verses,
        // nobody the sole "frontperson". StagePlot centres every member
        // flagged lead (spread across the front centre-line if there's
        // more than one) rather than forcing a single winner, so every
        // `vocal_role === 'lead'` row comes through as-is here.
        lead,
        // A dep/session musician has placeholder_id set instead of
        // profile_id -- already the exact distinction this app draws
        // everywhere else (GigRoster, the day sheet, etc.).
        guest: row.placeholder_id != null,
        source: role === 'percussion' || role === 'horn' ? 'mic' : sourceFor(instrumentName),
        // IEMs are the default now, not wedges -- most function bands
        // this app books run in-ears; wedges are the exception, one tap
        // away per person (or "Everyone on Wedges" in the panel).
        monitor: 'iem',
        kit: 'standard',
      };
    });

  if (!members.some((m) => m.lead)) {
    const firstSinger = members.find((m) => m.sings);
    if (firstSinger) firstSinger.lead = true;
  }

  const { hasCustomDims } = stagePresetFromVenue(venue);

  return {
    band: displayBandName(gig.bands?.name) || '',
    strap: '',
    venue: venue?.name || '',
    date: gig.gig_date || '',
    stage: hasCustomDims ? 'custom' : 'club',
    custom: {
      w: Number(venue?.stage_width_m) || 8,
      d: Number(venue?.stage_depth_m) || 5,
    },
    riser: Boolean(venue?.has_stage_riser),
    lefty: false,
    tracks: Boolean(hasBackingTracks),
    members: members.length ? members : undefined, // mergeIntoDefaults() supplies a placeholder trio if the roster is still empty
    gear: [],
    power: { on: true, hidden: [], extra: [] },
    overrides: {},
    // Seeded from the existing roadie stage-layout brief when one already
    // exists for this gig, rather than starting from a blank box.
    notes: gig.roadie_stage_layout || '',
  };
}
