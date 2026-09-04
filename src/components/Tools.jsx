import GuitarTuner from './GuitarTuner.jsx';
import Metronome from './Metronome.jsx';
import VolumeMeter from './VolumeMeter.jsx';
import CountdownTimer from './CountdownTimer.jsx';

// Landing page for small standalone utilities that aren't tied to any one
// gig/band/client record -- just handy on their own. More get added here
// over time as their own day-sheet__section cards, same one-tab-many-tools
// shape Money.jsx already uses.
export default function Tools() {
  return (
    <>
      <div className="section-header">
        <h2 className="section-header__title">Tools</h2>
      </div>
      <GuitarTuner />
      <Metronome />
      <VolumeMeter />
      <CountdownTimer />
    </>
  );
}
