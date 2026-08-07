import { getDeviceInfo } from '../utils/deviceInfo.js';
import { installInstructions } from '../utils/pwaInstallInstructions.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import NotificationSetup from './NotificationSetup.jsx';

function InstallStep({ device }) {
  const { canPromptInstall, promptInstall } = useInstallPrompt();

  if (device.isPwa) {
    return (
      <div className="setup-step setup-step--done">
        <span className="setup-step__badge">✓</span>
        <div>
          <strong>App installed</strong>
          <p>You're using the installed app, not a browser tab.</p>
        </div>
      </div>
    );
  }

  if (canPromptInstall) {
    return (
      <div className="setup-step">
        <span className="setup-step__badge">1</span>
        <div>
          <strong>Install the app</strong>
          <p>Adds an icon to your Home Screen / desktop so it opens like a real app, and is required for notifications to work on some devices.</p>
          <button type="button" className="btn btn--primary btn--small" onClick={promptInstall}>
            📲 Install Gig Manager
          </button>
        </div>
      </div>
    );
  }

  const { steps, note } = installInstructions(device);

  return (
    <div className="setup-step">
      <span className="setup-step__badge">1</span>
      <div>
        <strong>Install the app</strong>
        {note && <p>{note}</p>}
        {steps.length > 0 && (
          <ol className="setup-step__list">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}

function NotificationStep({ device }) {
  const iosNeedsInstallFirst = (device.os === 'iOS' || device.os === 'iPadOS') && !device.isPwa;

  if (iosNeedsInstallFirst) {
    return (
      <div className="setup-step setup-step--disabled">
        <span className="setup-step__badge">2</span>
        <div>
          <strong>Turn on notifications</strong>
          <p>
            This can't work yet in this browser tab — Apple only allows notifications for the installed app, opened
            from its Home Screen icon. Finish step 1, then close this tab and open Gig Manager from the icon instead.
            You'll see this step unlock automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-step">
      <span className="setup-step__badge">2</span>
      <div style={{ flex: 1 }}>
        <strong>Turn on notifications</strong>
        <p>Get gig updates, claim approvals, and day-of reminders even when the app is closed.</p>
        <NotificationSetup />
      </div>
    </div>
  );
}

// Shown either as a full-screen gate right after login (App.jsx, when this
// device hasn't completed setup and hasn't dismissed it) or embedded inline
// from My profile for anyone revisiting it later -- same content either way,
// onContinue just controls whether the "Continue to app" footer renders.
// There's deliberately only one exit button here, not a separate "Skip" --
// both would have done exactly the same thing (dismiss), which is more
// confusing than having one honest button.
export default function PwaSetupGuide({ onContinue, showHeader = true }) {
  const device = getDeviceInfo();

  return (
    <div>
      {showHeader && (
        <>
          <p className="login-card__eyebrow">Gig Manager</p>
          <h1 className="login-card__title" style={{ fontSize: 22, marginBottom: 8 }}>Get the best experience</h1>
        </>
      )}
      <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
        Two quick steps so you don't miss a gig update, claim approval, or day-of reminder.
      </p>

      <InstallStep device={device} />
      <NotificationStep device={device} />

      {onContinue && (
        <div className="form-actions" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--primary" onClick={onContinue}>
            Continue to app
          </button>
        </div>
      )}
    </div>
  );
}
