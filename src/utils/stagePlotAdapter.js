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
   at all (backliners explicitly excludes role==="drums"). "other" gets
   an amp-box-and-wedge placement instead, which is a real stage position
   rather than an invisible one. Saxophone has no dedicated role either,
   so it lands in "other" too -- shown in the Gtr2/Key pool alongside a
   second guitarist/keys player, same as the gig grid's Gt2/Key column
   this session already established that convention for. */
const INSTRUMENT_TO_ROLE = {
  Drums: 'drums',
  Percussion: 'other',
  'Bass Guitar': 'bass',
  'Double Bass': 'bass',
  'Electric Guitar': 'guitar',
  'Acoustic Guitar': 'guitar',
  Keys: 'keys',
  Saxophone: 'other',
  'Lead Vocals': 'vocals',
  'Backing Vocals': 'vocals',
};

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
      return {
        id: stableId(row.id),
        name,
        role: roleFor(row),
        sings,
        lead,
        // A dep/session musician has placeholder_id set instead of
        // profile_id -- already the exact distinction this app draws
        // everywhere else (GigRoster, the day sheet, etc.).
        guest: row.placeholder_id != null,
        source: 'amp',
        monitor: 'wedge',
        kit: 'standard',
      };
    });

  // Exactly one lead vocal, even if the roster data disagrees (e.g. two
  // people both marked lead by mistake).
  let leadSeen = false;
  members.forEach((m) => {
    if (m.lead && leadSeen) m.lead = false;
    if (m.lead) leadSeen = true;
  });
  if (!leadSeen) {
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
