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
import Settings from './components/Settings.jsx';
import GetStarted from './components/GetStarted.jsx';
import DepProfile from './components/DepProfile.jsx';
import Money from './components/Money.jsx';
import AppFooter from './components/AppFooter.jsx';
import PushHealthBanner from './components/PushHealthBanner.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import Dashboard from './components/Dashboard.jsx';
import EnquiriesList from './components/EnquiriesList.jsx';
import UserActivity from './components/UserActivity.jsx';
import EnquiryForm from './components/EnquiryForm.jsx';
import PublicDocumentView from './components/PublicDocumentView.jsx';
import PublicBandPage from './components/PublicBandPage.jsx';
import PublicSongRequests from './components/PublicSongRequests.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import ConfirmHost from './components/ConfirmHost.jsx';
import ToastHost from './components/ToastHost.jsx';
import PromptHost from './components/PromptHost.jsx';
import PwaSetupGuide from './components/PwaSetupGuide.jsx';
import FeedbackModal from './components/FeedbackModal.jsx';
import JoinBandInvite from './components/JoinBandInvite.jsx';
import FeedbackInbox from './components/FeedbackInbox.jsx';
import SongsList from './components/SongsList.jsx';
import WhatsNewModal from './components/WhatsNewModal.jsx';
import { WHATS_NEW } from './data/whatsNew.js';
import { checkForServiceWorkerUpdate } from './utils/serviceWorker.js';
import { isNetworkAuthError } from './utils/authErrors.js';
import { usePwaSetupGate } from './hooks/usePwaSetupGate.js';
import {
  DashboardIcon, GigsIcon, EnquiriesIcon, VenuesIcon, ClientsIcon, SuppliersIcon,
  BandsIcon, MusiciansIcon, RepertoireIcon, ActivityIcon, FeedbackIcon,
  SettingsIcon, GetStartedIcon, DepProfileIcon, MoneyIcon, MegaphoneIcon,
} from './utils/tabIcons.jsx';

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

  // Public, no-login band booking page — reads through get_public_band_page/
  // get_band_availability, scoped to bands with public_enabled = true (see
  // PublicBandPage.jsx).
  if (window.location.pathname.startsWith('/band/')) {
    const slug = window.location.pathname.split('/')[2];
    return <PublicBandPage slug={slug} />;
  }

  // Public, no-login song request page for a gig's QR code -- reads
  // through get_gig_requests_page/submit_song_request, scoped to gigs
  // within their active request window (see PublicSongRequests.jsx).
  if (window.location.pathname.startsWith('/requests/')) {
    const token = window.location.pathname.split('/')[2];
    return <PublicSongRequests token={token} />;
  }


  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // Clicking the emailed reset link signs the browser into a temporary
  // recovery session and fires this event -- without catching it, that
  // session would fall straight through to the normal signed-in app instead
  // of prompting for a new password.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [pendingJoinToken, setPendingJoinToken] = useState(null);
  const { profile, isAdmin, isBandLeader, loading: profileLoading, refreshProfile } = useCurrentProfile();
  // localStorage, not sessionStorage: a PWA fully exited (e.g. backgrounded
  // at a venue with no signal, then killed by the OS) loses sessionStorage
  // on relaunch — this needs to survive that so the user lands back on the
  // gig they were on instead of defaulting to Dashboard.
  const [view, setView] = useState(() => {
    // Stripe's Account Link onboarding / subscription checkout both redirect
    // back here with a flag rather than a dedicated URL -- this app has no
    // router, so a query param is the only way it can tell the SPA where to
    // land. Both personal-account flows land on Money now (My Profile was
    // split into Settings/Get started/Dep profile/Money -- this is where
    // Stripe Connect payout setup and the Pro subscription actually live).
    if (window.location.search.includes('stripe_connect=1')) return 'money';
    // Band-level Connect setup (BandConnectPayoutSetup) returns here the
    // same way, but lands on Bands instead -- a distinct flag from
    // stripe_connect=1 so the two return trips don't collide.
    if (window.location.search.includes('stripe_connect_band=1')) return 'bands';
    if (window.location.search.includes('pro=1') || window.location.search.includes('pro=0')) return 'money';
    // 'profile' was My Profile's old view key, before it was split into
    // Settings/Get started/Dep profile/Money -- anyone whose last session
    // ended there still has it cached and would otherwise land on a view
    // that no longer exists.
    const stored = localStorage.getItem('gig_view');
    return stored === 'profile' ? 'settings' : (stored || 'dashboard');
  });
  const { show: showPwaSetup, dismiss: dismissPwaSetup } = usePwaSetupGate();
  const [showFeedback, setShowFeedback] = useState(false);

  // Shared here rather than owned by whichever component happens to render
  // the button, since the header megaphone and the footer's "What's new"
  // link are siblings with no other common parent, and both need to open
  // the same panel and agree on what's already been seen. The badge only
  // needs a per-device "have they opened it since the newest entry shipped"
  // check -- localStorage, not an account-synced value -- this is far
  // lower-stakes than a real notification.
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const latestWhatsNewId = WHATS_NEW[0]?.id ?? null;
  const [whatsNewSeenId, setWhatsNewSeenId] = useState(() => {
    try { return localStorage.getItem('whatsNewSeenId'); } catch { return null; }
  });
  const hasUnseenWhatsNew = Boolean(latestWhatsNewId) && whatsNewSeenId !== latestWhatsNewId;
  function openWhatsNew() {
    setShowWhatsNew(true);
    try { localStorage.setItem('whatsNewSeenId', latestWhatsNewId); } catch { /* private browsing etc -- badge just reappears next time, harmless */ }
    setWhatsNewSeenId(latestWhatsNewId);
  }

  // Strip the query param once read -- otherwise it'd force back to Profile
  // on every future reload, not just this one return trip.
  useEffect(() => {
    if (window.location.search.includes('stripe_connect=1')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (window.location.search.includes('stripe_connect_band=1')) {
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

  // ?join_band=<token> -- a band-invite link (BandMembers' "Invite an
  // existing musician"). Only meaningful for an already-registered account,
  // so this just stashes the token and lets the normal sign-in flow run its
  // course if there's no session yet; the effect below picks it up once
  // there is one.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('join_band');
    if (token) {
      sessionStorage.setItem('pending_join_band_token', token);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!session || profileLoading) return;
    const token = sessionStorage.getItem('pending_join_band_token');
    if (!token) return;
    sessionStorage.removeItem('pending_join_band_token');
    setPendingJoinToken(token);
  }, [session, profileLoading]);

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

  // Lets a deeply-nested component (e.g. GigFeeSplit's "set the split
  // percentages" link) jump straight to editing a specific band without
  // threading a callback down through every intermediate component —
  // mirrors the gig-selected localStorage+event pattern above, one-shot
  // rather than persisted since arriving here is always a deliberate click,
  // not something that should keep reopening on every later Bands visit.
  useEffect(() => {
    function handleNavigateToBand(e) {
      const bandId = e.detail?.band_id;
      if (!bandId) return;
      // `section: 'members'` (e.g. GigRoster's "Manage this band's members"
      // hint) opens straight to the standing-roster panel instead of the
      // edit-details form GigFeeSplit's link expects -- same event, same
      // one-shot localStorage+event relay, just carrying one extra field
      // through for BandsList to branch on.
      localStorage.setItem('selected_band_id', bandId);
      localStorage.setItem('selected_band_section', e.detail?.section || '');
      updateView('bands');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('band-selected', { detail: { band_id: bandId, section: e.detail?.section } }));
      }, 50);
    }
    window.addEventListener('navigate-to-band', handleNavigateToBand);
    return () => window.removeEventListener('navigate-to-band', handleNavigateToBand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Visible to every role, appended after each role's own working tabs --
  // Settings/Get started/Dep profile/Money used to be one page (My
  // Profile) hidden behind the small header icon, which is a big part of
  // why musicians kept missing Pro/claims features living in there.
  const personalTabs = [
    ['settings', 'Settings', SettingsIcon],
    ['getstarted', 'Get started', GetStartedIcon],
    ['depprofile', 'Dep profile', DepProfileIcon],
    ['money', 'Money', MoneyIcon],
  ];

  const adminTabs = [
    ['dashboard', 'Dashboard', DashboardIcon],
    ['gigs', 'Gigs', GigsIcon],
    ['enquiries', 'Enquiries', EnquiriesIcon],
    ['venues', 'Venues', VenuesIcon],
    ['clients', 'Clients', ClientsIcon],
    ['suppliers', 'Suppliers', SuppliersIcon],
    ['bands', 'Bands', BandsIcon],
    ['musicians', 'Musicians', MusiciansIcon],
    ['repertoire', 'Repertoire', RepertoireIcon],
    ['activity', 'Activity', ActivityIcon],
    ['feedback', 'Feedback', FeedbackIcon],
    ...personalTabs,
  ];

  const bandLeaderTabs = [
    ['dashboard', 'Dashboard', DashboardIcon],
    ['gigs', 'Gigs', GigsIcon],
    ['venues', 'Venues', VenuesIcon],
    ['clients', 'Clients', ClientsIcon],
    ['suppliers', 'Suppliers', SuppliersIcon],
    ['bands', 'Bands', BandsIcon],
    ['musicians', 'Musicians', MusiciansIcon],
    ...personalTabs,
  ];

  const memberTabs = [
    ['dashboard', 'Dashboard', DashboardIcon],
    ['gigs', 'My gigs', GigsIcon],
    ...personalTabs,
  ];

  const tabs = isAdmin ? adminTabs : isBandLeader ? bandLeaderTabs : memberTabs;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__logo">
          <img src="/icons/icon.svg" alt="" width="30" height="30" />
          <span className="app-header__title">Seeau</span>
        </span>
        <div className="app-header__right">
        <button
          className="notif-bell__btn"
          onClick={openWhatsNew}
          title="What's new"
          aria-label={"What's new" + (hasUnseenWhatsNew ? ', new update' : '')}
        >
          <MegaphoneIcon />
          {hasUnseenWhatsNew && <span className="notif-bell__badge notif-bell__badge--dot" />}
        </button>
        <NotificationBell onNavigate={handleNavigate} />
          <button
            className="feedback-btn"
            onClick={() => setShowFeedback(true)}
            title="Send feedback — bugs, ideas, anything not working as expected"
            aria-label="Send feedback"
          >
            <FeedbackIcon /><span className="feedback-btn__label">Feedback</span>
          </button>
          <button
            className={'notif-bell__btn' + (view === 'settings' ? ' notif-bell__btn--active' : '')}
            onClick={() => updateView('settings')}
            title="Settings"
            aria-label="Settings"
          >
            {profile?.avatar_url ? (
              <span className="avatar-preview avatar-preview--tiny">
                <img src={profile.avatar_url} alt="" />
              </span>
            ) : (
              <UserIcon />
            )}
          </button>
        </div>
      </header>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} page={view} />}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}

      <PushHealthBanner />

      <nav className="tab-nav">
        {tabs.map(([key, label, Icon]) => (
          <button
            key={key}
            className={view === key ? 'tab tab--active' : 'tab'}
            onClick={() => {
              // Clicking Gigs/My gigs always lands on the list, even when a
              // gig's detail view is already open there -- updateView alone
              // is a no-op in that case since `view` doesn't change, so the
              // click would otherwise do nothing. selected_gig_id is left
              // untouched by every OTHER tab switch (and across a full PWA
              // restart) so those still resume the same gig; this only
              // clears it on an explicit click of the Gigs tab itself.
              if (key === 'gigs') {
                localStorage.removeItem('selected_gig_id');
                window.dispatchEvent(new CustomEvent('gig-selected', { detail: { gig_id: null, section: null } }));
              }
              updateView(key);
            }}
          >
            <Icon />
            <span className="tab__label">{label}</span>
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
        {view === 'settings' && <Settings />}
        {view === 'getstarted' && <GetStarted />}
        {view === 'depprofile' && <DepProfile />}
        {view === 'money' && <Money />}
      </main>
      <AppFooter onOpenWhatsNew={openWhatsNew} />
      {pendingJoinToken && (
        <JoinBandInvite token={pendingJoinToken} onDone={() => setPendingJoinToken(null)} />
      )}
      <ConfirmHost />
      <PromptHost />
      <ToastHost />
    </div>
  );
}