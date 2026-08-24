import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { useCurrentProfile } from './context/ProfileContext.jsx';
import Login from './components/Login.jsx';
import GigsList from './components/GigsList.jsx';
import VenuesList from './components/VenuesList.jsx';
import ClientsList from './components/ClientsList.jsx';
import SuppliersList from './components/SuppliersList.jsx';
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

// True when a Supabase auth call failed because the *fetch* to the auth
// server didn't succeed (offline, timed out, DNS/TLS failure on a captive
// portal, connection dropped mid-request) rather than because the server
// rejected the request (expired/revoked refresh token, bad credentials).
// supabase-js's own retry logic already makes this distinction internally
// (see @supabase/auth-js's isAuthRetryableFetchError) but doesn't expose
// the helper from the public package, so we match its tag directly. This
// is deliberately not navigator.onLine, which reports true on a wifi
// network with no working internet -- exactly the case we need to catch.
function isNetworkAuthError(error) {
  return error?.name === 'AuthRetryableFetchError';
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
  const { profile, isAdmin, isBandLeader, loading: profileLoading, refreshProfile } = useCurrentProfile();
  // localStorage, not sessionStorage: a PWA fully exited (e.g. backgrounded
  // at a venue with no signal, then killed by the OS) loses sessionStorage
  // on relaunch — this needs to survive that so the user lands back on the
  // gig they were on instead of defaulting to Dashboard.
  const [view, setView] = useState(() => {
    // Stripe's Account Link onboarding / subscription checkout both redirect
    // back here with a flag rather than a dedicated URL -- this app has no
    // router, so a query param is the only way it can tell the SPA where to
    // land.
    if (window.location.search.includes('stripe_connect=1')) return 'profile';
    if (window.location.search.includes('pro=1') || window.location.search.includes('pro=0')) return 'profile';
    return localStorage.getItem('gig_view') || 'dashboard';
  });
  const { show: showPwaSetup, dismiss: dismissPwaSetup } = usePwaSetupGate();
  const [showFeedback, setShowFeedback] = useState(false);

  // Strip the query param once read -- otherwise it'd force back to Profile
  // on every future reload, not just this one return trip.
  useEffect(() => {
    if (window.location.search.includes('stripe_connect=1')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (window.location.search.includes('pro=1')) {
      window.history.replaceState({}, '', window.location.pathname);
      // The webhook that flips subscription_tier to 'pro' normally lands
      // well before this redirect completes, but isn't guaranteed to --
      // re-fetching here rather than trusting the cached profile means a
      // slow webhook just shows "free" for a moment on refresh rather than
      // baking a stale value into the cache.
      refreshProfile();
    } else if (window.location.search.includes('pro=0')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
    supabase.auth.getSession().then(({ data, error }) => {
      if (data.session) {
        setSession(data.session);
      } else if (error && isNetworkAuthError(error)) {
        // Token refresh failed for a *network* reason -- not just fully
        // offline, but also a flaky 4G signal, wifi connected to a router
        // with no real internet, or the connection dropping mid-request
        // while swapping between wifi and 4G. supabase-js tags exactly this
        // case as AuthRetryableFetchError, discarding the still-valid
        // stale session and resolving session: null instead of throwing --
        // which would otherwise force a signed-in user straight to the
        // Login screen over a bad signal, defeating the whole point of the
        // offline gig cache below. navigator.onLine can't be trusted for
        // this: it reports true on a wifi network with no working
        // internet, so we check the SDK's own error instead. Fall back to
        // the session still sitting in the SDK's storage so the app opens
        // into cached data; a real refresh happens automatically (via the
        // auth listener below) the moment the connection is actually good.
        try {
          const raw = localStorage.getItem(supabase.auth.storageKey);
          setSession(raw ? JSON.parse(raw) : null);
        } catch {
          setSession(null);
        }
      } else {
        // No session, or a genuine auth rejection (revoked/invalid refresh
        // token) rather than a network failure -- signing out is correct.
        setSession(null);
      }
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
    ['suppliers', 'Suppliers'],
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
    ['suppliers', 'Suppliers'],
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
            {profile?.avatar_url ? (
              <span className="avatar-preview avatar-preview--tiny">
                <img src={profile.avatar_url} alt="" />
              </span>
            ) : (
              <UserIcon />
            )}
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
        {view === 'suppliers' && (isAdmin || isBandLeader) && <SuppliersList />}
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