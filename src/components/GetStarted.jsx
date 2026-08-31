import PwaSetupGuide from './PwaSetupGuide.jsx';

// Split out of the old MyProfile.jsx's "App setup" section into its own
// tab -- a task list, not a preference, so it doesn't belong next to
// identity/theme settings. Room to grow into a general onboarding home
// later without feeling out of place there.
export default function GetStarted() {
  return (
    <div className="day-sheet__section">
      <h2 className="section-header__title" style={{ margin: '0 0 16px' }}>Get started</h2>
      <PwaSetupGuide showHeader={false} />
    </div>
  );
}
