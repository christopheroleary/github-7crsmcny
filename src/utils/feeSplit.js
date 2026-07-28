// Shared fee-split math, used both for the pre-roster budgeting projection
// (GigForm) and the real per-musician calculation (GigFeeSplit). Percentages
// are of the total gig fee, so a bigger gig scales every role's cut in
// proportion rather than paying a fixed amount regardless of gig size.
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

  const perMusicianBasePence = Math.round(pct(template?.fee_split_musician_base_pct));
  const singerBonusPence = hasSinger ? Math.round(pct(template?.fee_split_singer_bonus_pct)) : 0;
  const captainBonusPence = hasCaptain ? Math.round(pct(template?.fee_split_captain_bonus_pct)) : 0;
  const djFeePence = djCount > 0 ? Math.round(pct(template?.fee_split_dj_pct)) : 0;
  const roadieFeePence = roadieCount > 0 ? Math.round(pct(template?.fee_split_roadie_pct)) : 0;

  const allocatedPence =
    regularCount * perMusicianBasePence +
    singerBonusPence +
    captainBonusPence +
    djFeePence * djCount +
    roadieFeePence * roadieCount;

  const remainderPence = totalFeePence - allocatedPence - (fuelPence || 0);

  return {
    perMusicianBasePence,
    singerBonusPence,
    captainBonusPence,
    djFeePence,
    roadieFeePence,
    allocatedPence,
    remainderPence,
  };
}
