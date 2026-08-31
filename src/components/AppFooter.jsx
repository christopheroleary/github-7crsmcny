import { useState } from 'react';
import { supabase } from '../supabaseClient';
import PrivacyModal from './PrivacyModal.jsx';
import TermsModal from './TermsModal.jsx';
import { forceRefreshApp } from '../utils/serviceWorker.js';
import { confirmAsync } from '../utils/confirmService.js';
import { APP_VERSION, APP_BUILD_TIME } from '../utils/buildInfo.js';

// Rendered once in the app shell (App.jsx), after <main>, so it appears
// at the bottom of every tab rather than living inside any one of them --
// Privacy/Terms/Refresh app/version are things people look for once,
// rarely, not content worth spending a nav tab on. Not fixed/sticky, so
// it never covers page content on a small screen; it's just always the
// last thing on whichever tab is showing.
export default function AppFooter() {
  const [openModal, setOpenModal] = useState(null); // null | 'privacy' | 'terms'

  const buildTimeLabel = APP_BUILD_TIME
    ? new Date(APP_BUILD_TIME).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  async function handleRefresh() {
    if (await confirmAsync('Refresh the app and clear its cache? Any unsaved changes will be lost.')) {
      forceRefreshApp();
    }
  }

  return (
    <footer className="app-footer">
      <div className="app-footer__links">
        <button type="button" className="link-button" onClick={() => setOpenModal('privacy')}>Privacy</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-button" onClick={() => setOpenModal('terms')}>Terms</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-button" onClick={handleRefresh}>Refresh app</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <p className="app-footer__version">
        Version {APP_VERSION}{buildTimeLabel ? ' · built ' + buildTimeLabel : ''}
      </p>

      {openModal === 'privacy' && <PrivacyModal onClose={() => setOpenModal(null)} />}
      {openModal === 'terms' && <TermsModal onClose={() => setOpenModal(null)} />}
    </footer>
  );
}
