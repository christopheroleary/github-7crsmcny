// Shared fee-split math, used both for the pre-roster budgeting projection
// (GigForm) and the real per-musician calculation (GigFeeSplit).
//
// Owner profit, DJ, roadie, and singer bonus are each a % of the total fee —
// fixed regardless of headcount, since that work doesn't scale with how many
// other musicians are booked. Musicians then split whatever's LEFT evenly
// across however many are actually on the roster, so a 7-piece and a
// 3-piece band both get a sensible per-person share of the same gig fee
// instead of a fixed % each that would blow the budget at higher headcounts.
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

  const ownerProfitPence = hasCaptain ? Math.round(pct(template?.fee_split_owner_profit_pct)) : 0;
  const singerBonusPence = hasSinger ? Math.round(pct(template?.fee_split_singer_bonus_pct)) : 0;
  const djFeePence = djCount > 0 ? Math.round(pct(template?.fee_split_dj_pct)) : 0;
  const roadieFeePence = roadieCount > 0 ? Math.round(pct(template?.fee_split_roadie_pct)) : 0;

  const overheadPence =
    ownerProfitPence + singerBonusPence + djFeePence * djCount + roadieFeePence * roadieCount + (fuelPence || 0);
  const musicianPoolPence = totalFeePence - overheadPence;
  const perMusicianBasePence = regularCount > 0 ? Math.round(musicianPoolPence / regularCount) : 0;

  const allocatedPence =
    regularCount * perMusicianBasePence +
    singerBonusPence +
    ownerProfitPence +
    djFeePence * djCount +
    roadieFeePence * roadieCount;

  const remainderPence = totalFeePence - allocatedPence - (fuelPence || 0);

  // Flags when a musician's equal share would fall below what the DJ/roadie
  // earn flat — a sign the fee is too low or the headcount too high.
  const belowDjOrRoadie =
    (djCount > 0 && perMusicianBasePence < djFeePence) ||
    (roadieCount > 0 && perMusicianBasePence < roadieFeePence);

  return {
    perMusicianBasePence,
    singerBonusPence,
    ownerProfitPence,
    djFeePence,
    roadieFeePence,
    allocatedPence,
    remainderPence,
    belowDjOrRoadie,
  };
}
