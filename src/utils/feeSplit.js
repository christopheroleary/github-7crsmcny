// Shared fee-split math, used both for the pre-roster budgeting projection
// (GigForm) and the real per-musician calculation (GigFeeSplit).
//
// Owner/band-leader profit is a band-level pot — it's deducted from the fee
// like any other overhead, but never paid to any individual musician's row
// (the owner is often not even on the gig, more like an agent). Captain
// bonus is separate: real pay for whoever leads on the day, only if there
// is one. DJ, roadie, and singer bonus are each a fixed % of the total fee
// too, since that work doesn't scale with headcount. Musicians then split
// whatever's LEFT evenly across however many are actually on the roster, so
// a 7-piece and a 3-piece both get a sensible per-person share of the same
// gig fee instead of a fixed % each that would blow the budget at higher
// headcounts.
const ROUND_STEP_PENCE = 1000; // nearest £10

function roundUpToStep(pence) {
  return Math.ceil(pence / ROUND_STEP_PENCE) * ROUND_STEP_PENCE;
}

export function calculateFeeSplit({
  totalFeePence,
  regularCount,
  hasSinger,
  hasCaptain,
  djCount,
  roadieCount,
  fuelPence,
  template,
}) {
  const pct = (p) => (p ? (Number(p) / 100) * totalFeePence : 0);

  const rawOwnerProfitPence = Math.round(pct(template?.fee_split_owner_profit_pct));
  const singerBonusPence = hasSinger ? Math.round(pct(template?.fee_split_singer_bonus_pct)) : 0;
  const captainBonusPence = hasCaptain ? Math.round(pct(template?.fee_split_captain_bonus_pct)) : 0;
  const rawDjFeePence = djCount > 0 ? Math.round(pct(template?.fee_split_dj_pct)) : 0;
  const rawRoadieFeePence = roadieCount > 0 ? Math.round(pct(template?.fee_split_roadie_pct)) : 0;

  const rawOverheadPence =
    rawOwnerProfitPence +
    singerBonusPence +
    captainBonusPence +
    rawDjFeePence * djCount +
    rawRoadieFeePence * roadieCount +
    (fuelPence || 0);
  const rawMusicianPoolPence = totalFeePence - rawOverheadPence;
  const rawPerMusicianBasePence = regularCount > 0 ? rawMusicianPoolPence / regularCount : 0;

  // Round each standalone payout up to a clean £10 — nobody wants a fee of
  // £299.71. The extra comes out of owner profit, never off a musician/DJ/
  // roadie, so rounding only ever costs the band pot, never the people.
  const perMusicianBasePence = regularCount > 0 ? roundUpToStep(rawPerMusicianBasePence) : 0;
  const djFeePence = djCount > 0 ? roundUpToStep(rawDjFeePence) : 0;
  const roadieFeePence = roadieCount > 0 ? roundUpToStep(rawRoadieFeePence) : 0;

  const roundingCostPence =
    (perMusicianBasePence - rawPerMusicianBasePence) * regularCount +
    (djFeePence - rawDjFeePence) * djCount +
    (roadieFeePence - rawRoadieFeePence) * roadieCount;

  const ownerProfitPence = Math.round(rawOwnerProfitPence - roundingCostPence);

  // What actually gets paid out to musicians — owner profit is deliberately excluded.
  const allocatedPence =
    regularCount * perMusicianBasePence +
    singerBonusPence +
    captainBonusPence +
    djFeePence * djCount +
    roadieFeePence * roadieCount;

  const remainderPence = totalFeePence - allocatedPence - ownerProfitPence - (fuelPence || 0);

  // Flags when a musician's equal share would fall below what the DJ/roadie
  // earn flat — a sign the fee is too low or the headcount too high.
  const belowDjOrRoadie =
    (djCount > 0 && perMusicianBasePence < djFeePence) ||
    (roadieCount > 0 && perMusicianBasePence < roadieFeePence);

  return {
    perMusicianBasePence,
    singerBonusPence,
    captainBonusPence,
    ownerProfitPence,
    djFeePence,
    roadieFeePence,
    allocatedPence,
    remainderPence,
    belowDjOrRoadie,
  };
}
