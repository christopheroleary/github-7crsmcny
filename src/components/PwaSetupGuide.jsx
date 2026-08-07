import { useState } from 'react';
import { getDeviceInfo } from '../utils/deviceInfo.js';
import { installInstructions } from '../utils/pwaInstallInstructions.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import NotificationSetup from './NotificationSetup.jsx';

function InstallStepContent({ device, onInstalled }) {
  const { canPromptInstall, promptInstall } = useInstallPrompt();

  if (device.isPwa) {
    return (
      <div className="setup-step__done-msg">
        <span className="setup-step__badge setup-step__badge--done">✓</span>
        <div>
          <strong>App installed</strong>
          <p>You're using the installed app, not a browser tab.</p>
        </div>
      </div>
    );
  }

  if (canPromptInstall) {
    return (
      <div>
        <p>One tap does it here — this browser supports installing directly.</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => {
            const outcome = await promptInstall();
            if (outcome === 'accepted' && onInstalled) onInstalled();
          }}
        >
          📲 Install Gig Manager
        </button>
      </div>
    );
  }

  const { steps, summary, note, officialUrl, officialLabel } = installInstructions(device);

  return (
    <div>
      {summary && <p>{summary}</p>}
      {steps && (
        <ol className="setup-wizard__list">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {note && <p className="field__hint">{note}</p>}
      {officialUrl && (
        <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="btn btn--ghost">
          📄 {officialLabel} ↗
        </a>
      )}
    </div>
  );
}

function NotificationStepContent({ device }) {
  const iosNeedsInstallFirst = (device.os === 'iOS' || device.os === 'iPadOS') && !device.isPwa;

  if (iosNeedsInstallFirst) {
    return (
      <div className="setup-step--disabled">
        <p>
          This can't work yet in this browser tab — Apple only allows notifications for the installed app, opened
          from its Home Screen icon. Go back to step 1, then close this tab and open Gig Manager from the icon
          instead. You'll see this step unlock automatically.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p>Get gig updates, claim approvals, and day-of reminders even when the app is closed.</p>
      <NotificationSetup />
    </div>
  );
}

const STEPS = [
  { key: 'install', title: 'Install the app' },
  { key: 'notifications', title: 'Turn on notifications' },
];

// Shown either as a full-screen gate right after login (App.jsx, when this
// device hasn't completed setup and hasn't dismissed it) or embedded inline
// from My profile for anyone revisiting it later -- same content either
// way, onContinue just controls whether the footer renders.
export default function PwaSetupGuide({ onContinue, showHeader = true }) {
  const device = getDeviceInfo();
  // Skip straight to notifications if this device is already installed --
  // no point making an already-done step the first thing shown.
  const [stepIndex, setStepIndex] = useState(device.isPwa ? 1 : 0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

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

      <div className="setup-wizard">
        <div className="setup-wizard__progress">
          {STEPS.map((s, i) => (
            <span key={s.key} className={'setup-wizard__dot' + (i === stepIndex ? ' setup-wizard__dot--active' : i < stepIndex ? ' setup-wizard__dot--done' : '')} />
          ))}
          <span className="field__hint" style={{ marginLeft: 8 }}>Step {stepIndex + 1} of {STEPS.length}</span>
        </div>

        <h3 style={{ margin: '12px 0 10px' }}>{step.title}</h3>

        {step.key === 'install' && (
          <InstallStepContent device={device} onInstalled={() => setStepIndex(1)} />
        )}
        {step.key === 'notifications' && <NotificationStepContent device={device} />}

        <div className="form-actions" style={{ marginTop: 20 }}>
          {stepIndex > 0 && (
            <button type="button" className="link-button" onClick={() => setStepIndex((i) => i - 1)}>
              ← Back
            </button>
          )}
          {!isLast && (
            <button type="button" className="btn btn--ghost" onClick={() => setStepIndex((i) => i + 1)}>
              Next →
            </button>
          )}
          {isLast && onContinue && (
            <button type="button" className="btn btn--primary" onClick={onContinue}>
              Continue to app
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
