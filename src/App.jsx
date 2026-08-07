import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { useCurrentProfile } from './context/ProfileContext.jsx';
import Login from './components/Login.jsx';
import GigsList from './components/GigsList.jsx';
import VenuesList from './components/VenuesList.jsx';
import ClientsList from './components/ClientsList.jsx';
import BandsList from './components/BandsList.jsx';
import MusiciansList from './components/MusiciansList.jsx';
import MyProfile from './components/MyProfile.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import Dashboard from './components/Dashboard.jsx';
import EnquiriesList from './components/EnquiriesList.jsx';
import UserActivity from './components/UserActivity.jsx';
import EnquiryForm from './components/EnquiryForm.jsx';
import PublicDocumentView from './components/PublicDocumentView.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ToastHost from './components/ToastHost.jsx';
import PromptHost from './components/PromptHost.jsx';
import PwaSetupGuide from './components/PwaSetupGuide.jsx';
import FeedbackModal from './components/FeedbackModal.jsx';
import FeedbackInbox from './components/FeedbackInbox.jsx';
import SongsList from './components/SongsList.jsx';
import { checkForServiceWorkerUpdate } from './utils/serviceWorker.js';
import { usePwaSetupGate } from './hooks/usePwaSetupGate.js';

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

// Public enquiry form — no auth needed
if (window.location.pathname.startsWith('/enquiry')) {
  const root = document.getElementById('root');
  if (root && !root.dataset.enquiryMounted) {
    root.dataset.enquiryMounted = 'true';
  }
}

export default function App() {
  // Serve public enquiry form regardless of auth state
  if (window.location.pathname.startsWith('/enquiry')) {
    return <EnquiryForm />;
  }

  // Public, no-login share links for invoices/quotes/contracts — each
  // reads through a SECURITY DEFINER RPC scoped to the exact token in the
  // URL (see PublicDocumentView.jsx), never a directly-queried table.
  for (const docType of ['invoice', 'quote', 'contract']) {
    if (window.location.pathname.startsWith('/' + docType + '/')) {
      const token = window.location.pathname.split('/')[2];
      return <PublicDocumentView type={docType} token={token} />;
    }
  }


  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // Clicking the emailed reset link signs the browser into a temporary
  // recovery session and fires this event -- without catching it, that
  // session would fall straight through to the normal signed-in app instead
  // of prompting for a new password.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const { isAdmin, isBandLeader, loading: profileLoading } = useCurrentProfile();
  // localStorage, not sessionStorage: a PWA fully exited (e.g. backgrounded
  // at a venue with no signal, then killed by the OS) loses sessionStorage
  // on relaunch — this needs to survive that so the user lands back on the
  // gig they were on instead of defaulting to Dashboard.
  const [view, setView] = useState(() => localStorage.getItem('gig_view') || 'dashboard');
  const { show: showPwaSetup, dismiss: dismissPwaSetup } = usePwaSetupGate();
  const [showFeedback, setShowFeedback] = useState(false);

  function updateView(v) {
    localStorage.setItem('gig_view', v);
    setView(v);
  }

  function handleNavigate({ url, gig_id, section }) {
    const tab = url ? url.replace('/', '') : 'gigs';
    if (tabs.some(([k]) => k === tab)) {
      if (gig_id) {
        localStorage.setItem('selected_gig_id', gig_id);
      } else {
        localStorage.removeItem('selected_gig_id');
      }
      updateView(tab);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('gig-selected', { detail: { gig_id: gig_id || null, section: section || null } }));
      }, 50);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN') checkForServiceWorkerUpdate();
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Deep link support: ?gig=<share_code> opens straight to that gig once
  // signed in (e.g. a link shared via the WhatsApp group setup panel). The
  // short code (not the raw gig id) keeps the link short enough to look
  // sane pasted as plain text in a WhatsApp message.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('gig');
    if (code) {
      sessionStorage.setItem('pending_gig_code', code);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    // Also wait on profileLoading: handleNavigate closes over `tabs`, which
    // only exists on renders that get past the loading/login early-returns
    // below — session and the profile fetch resolve at different times.
    if (!session || profileLoading) return;
    const pendingCode = sessionStorage.getItem('pending_gig_code');
    if (!pendingCode) return;
    sessionStorage.removeItem('pending_gig_code');
    supabase
      .from('gigs')
      .select('id')
      .eq('share_code', pendingCode)
      .single()
      .then(({ data }) => {
        if (data?.id) handleNavigate({ url: '/gigs', gig_id: data.id });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profileLoading]);

  if (sessionLoading || profileLoading) return <div className="page-loading">Loading…</div>;
  if (passwordRecovery) return <ResetPassword onDone={() => setPasswordRecovery(false)} />;
  if (!session) return <Login />;

  if (showPwaSetup) {
    return (
      <div className="login-page">
        <div className="login-card login-card--wide">
          <PwaSetupGuide onContinue={dismissPwaSetup} />
        </div>
      </div>
    );
  }

  const adminTabs = [
    ['dashboard', 'Dashboard'],
    ['gigs', 'Gigs'],
    ['enquiries', 'Enquiries'],
    ['venues', 'Venues'],
    ['clients', 'Clients'],
    ['bands', 'Bands'],
    ['musicians', 'Musicians'],
    ['repertoire', 'Repertoire'],
    ['activity', 'Activity'],
    ['feedback', 'Feedback'],
  ];

  const bandLeaderTabs = [
    ['dashboard', 'Dashboard'],
    ['gigs', 'Gigs'],
    ['venues', 'Venues'],
    ['clients', 'Clients'],
    ['bands', 'Bands'],
    ['musicians', 'Musicians'],
  ];

  const memberTabs = [
    ['dashboard', 'Dashboard'],
    ['gigs', 'My gigs'],
  ];

  const tabs = isAdmin ? adminTabs : isBandLeader ? bandLeaderTabs : memberTabs;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Gig Manager</span>
        <div className="app-header__right">
        <NotificationBell onNavigate={handleNavigate} />
          <button
            className="notif-bell__btn"
            onClick={() => setShowFeedback(true)}
            title="Send feedback"
            aria-label="Send feedback"
          >
            💬
          </button>
          <button
            className={'notif-bell__btn' + (view === 'profile' ? ' notif-bell__btn--active' : '')}
            onClick={() => updateView('profile')}
            title="My profile"
            aria-label="My profile"
          >
            <UserIcon />
          </button>
          <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} page={view} />}

      <nav className="tab-nav">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={view === key ? 'tab tab--active' : 'tab'}
            onClick={() => updateView(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main>
        {view === 'dashboard' && <Dashboard onNavigate={handleNavigate} />}
        {view === 'gigs' && <GigsList />}
        {view === 'enquiries' && isAdmin && <EnquiriesList />}
        {view === 'venues' && (isAdmin || isBandLeader) && <VenuesList />}
        {view === 'clients' && (isAdmin || isBandLeader) && <ClientsList />}
        {view === 'bands' && (isAdmin || isBandLeader) && <BandsList />}
        {view === 'musicians' && (isAdmin || isBandLeader) && <MusiciansList />}
        {view === 'repertoire' && isAdmin && <SongsList />}
        {view === 'activity' && isAdmin && <UserActivity />}
        {view === 'feedback' && isAdmin && <FeedbackInbox />}
        {view === 'profile' && <MyProfile />}
      </main>
      <ConfirmHost />
      <PromptHost />
      <ToastHost />
    </div>
  );
}