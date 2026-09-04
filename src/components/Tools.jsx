import GuitarTuner from './GuitarTuner.jsx';

// Landing page for small standalone utilities that aren't tied to any one
// gig/band/client record -- just handy on their own. Guitar tuner is the
// first; more get added here over time as their own day-sheet__section
// cards below it, same one-tab-many-tools shape Money.jsx already uses.
export default function Tools() {
  return (
    <>
      <div className="section-header">
        <h2 className="section-header__title">Tools</h2>
      </div>
      <GuitarTuner />
    </>
  );
}
