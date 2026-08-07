// Lightweight, dependency-free UA parsing -- doesn't need to be exhaustive,
// just accurate enough for an admin activity dashboard to tell devices apart.

function detectOs(ua, platform) {
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  // Modern iPadOS reports as "Macintosh" but exposes multi-touch, unlike a
  // real Mac -- this is the standard sniff to tell the two apart.
  if (/iPad/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPadOS';
  // Must come before the generic /Linux/ check below -- ChromeOS's UA
  // string is "X11; CrOS ..." which doesn't contain the literal word
  // "Linux" the way a desktop Linux distro's does, so without this a
  // Chromebook silently fell through to 'Unknown' and got the wrong
  // install instructions (PWA install on ChromeOS works, just via its own
  // menu wording, distinct from generic desktop Chrome).
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectBrowser(ua) {
  if (/EdgA?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/CriOS\//.test(ua)) return 'Chrome';
  if (/FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function detectDeviceType(ua) {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Mobi|iPhone|iPod/.test(ua)) return 'mobile';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'mobile' : 'tablet';
  return 'desktop';
}

function detectIsPwa() {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari's own non-standard flag -- doesn't support the media query above.
  if (window.navigator.standalone === true) return true;
  return false;
}

function detectNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  return {
    userAgent: ua,
    deviceType: detectDeviceType(ua),
    os: detectOs(ua, navigator.platform),
    browser: detectBrowser(ua),
    screenWidth: window.screen?.width || null,
    screenHeight: window.screen?.height || null,
    isPwa: detectIsPwa(),
    notificationPermission: detectNotificationPermission(),
  };
}
