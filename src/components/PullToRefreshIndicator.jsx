// Small pinned banner that tracks a usePullToRefresh() gesture -- renders
// nothing at rest, slides down from behind the top edge of the viewport as
// the user pulls, and flips from "Pull to refresh" to "Release to refresh"
// once past the threshold, matching the native iOS/Android affordance this
// is standing in for.
export default function PullToRefreshIndicator({ pullDistance, refreshing, threshold }) {
  if (!pullDistance && !refreshing) return null;

  const ready = refreshing || pullDistance >= threshold;
  // At rest the banner sits fully above the viewport (-44px); it tracks the
  // pull 1:1 up to a small overshoot past the threshold, then holds in place
  // while actually refreshing rather than snapping back and forth.
  const translateY = refreshing ? 14 : Math.min(pullDistance, threshold + 20) - 44;

  return (
    <div
      className={'pull-refresh-indicator' + (ready ? ' pull-refresh-indicator--ready' : '')}
      style={{ transform: 'translate(-50%, ' + translateY + 'px)' }}
      aria-hidden="true"
    >
      <span className={'pull-refresh-indicator__spinner' + (refreshing ? ' pull-refresh-indicator__spinner--spin' : '')}>
        ↻
      </span>
      <span className="pull-refresh-indicator__label">
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  );
}
