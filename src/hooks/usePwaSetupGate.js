import { useState } from 'react';
import { getDeviceInfo } from '../utils/deviceInfo.js';

const DISMISS_KEY = 'gig_manager_pwa_setup_dismissed';

// Per-DEVICE, not per-account -- a user logging in on a new phone should
// see this again even if they already completed it on their laptop, since
// each device needs its own install + notification permission. Deliberately
// localStorage-only (no server round trip): there's no stable device ID to
// key a DB row on (see user_sessions, which identifies devices by
// user_agent + is_pwa, not a generated ID), and this doesn't need to be
// more durable than "this browser profile" anyway -- clearing site data
// also clears the install/permission state it's gating.
export function usePwaSetupGate() {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    const device = getDeviceInfo();
    const fullySetUp = device.isPwa && device.notificationPermission === 'granted';
    if (fullySetUp) return false;
    return localStorage.getItem(DISMISS_KEY) !== 'true';
  });

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, 'true');
    setShow(false);
  }

  return { show, dismiss };
}
