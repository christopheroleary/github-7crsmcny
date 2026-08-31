import PwaSetupGuide from './PwaSetupGuide.jsx';

// Split out of the old MyProfile.jsx's "App setup" section into its own
// tab -- a task list, not a preference, so it doesn't belong next to
// identity/theme settings. Room to grow into a general onboarding home
// later without feeling out of place there.
export default function GetStarted() {
  return (
    <>
      <div className="section-header">
        <h2 className="section-header__title">Get started</h2>
      </div>
      <div className="day-sheet__section">
        <PwaSetupGuide showHeader={false} />
      </div>
    </>
  );
}
