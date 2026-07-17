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
import EnquiryForm from './components/EnquiryForm.jsx';

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

  if (window.location.pathname.startsWith('/invoice/')) {
    const token = window.location.pathname.split('/')[2];
    return (
      <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>✅ The Route Works!</h1>
        <p>If you see this instead of the login screen, the bypass was successful.</p>
      </div>
    );
  }


  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const { isAdmin, loading: profileLoading } = useCurrentProfile();
  const [view, setView] = useState(() => sessionStorage.getItem('gig_view') || 'dashboard');

  function updateView(v) {
    sessionStorage.setItem('gig_view', v);
    setView(v);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (sessionLoading || profileLoading) return <div className="page-loading">Loading…</div>;
  if (!session) return <Login />;

  const adminTabs = [
    ['dashboard', 'Dashboard'],
    ['gigs', 'Gigs'],
    ['enquiries', 'Enquiries'],
    ['venues', 'Venues'],
    ['clients', 'Clients'],
    ['bands', 'Bands'],
    ['musicians', 'Musicians'],
  ];

  const memberTabs = [
    ['dashboard', 'Dashboard'],
    ['gigs', 'My gigs'],
  ];

  const tabs = isAdmin ? adminTabs : memberTabs;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Gig Manager</span>
        <div className="app-header__right">
        <NotificationBell onNavigate={({ url, gig_id }) => {
          const tab = url ? url.replace('/', '') : 'gigs';
          if (tabs.some(([k]) => k === tab)) {
            if (gig_id) {
              sessionStorage.setItem('selected_gig_id', gig_id);
            } else {
              sessionStorage.removeItem('selected_gig_id');
            }
            updateView(tab);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('gig-selected', { detail: { gig_id: gig_id || null } }));
            }, 50);
          }
        }} />
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
        {view === 'dashboard' && <Dashboard />}
        {view === 'gigs' && <GigsList />}
        {view === 'enquiries' && isAdmin && <EnquiriesList />}
        {view === 'venues' && isAdmin && <VenuesList />}
        {view === 'clients' && isAdmin && <ClientsList />}
        {view === 'bands' && isAdmin && <BandsList />}
        {view === 'musicians' && isAdmin && <MusiciansList />}
        {view === 'profile' && <MyProfile />}
      </main>
    </div>
  );
}