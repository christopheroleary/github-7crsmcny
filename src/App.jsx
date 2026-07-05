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

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const { isAdmin, loading: profileLoading } = useCurrentProfile();

  // Persist view across tab focus/blur and minor re-renders
  const [view, setView] = useState(() => sessionStorage.getItem('gig_view') || 'gigs');
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
    ['gigs', 'Gigs'],
    ['venues', 'Venues'],
    ['clients', 'Clients'],
    ['bands', 'Bands'],
    ['musicians', 'Musicians'],
  ];

  const memberTabs = [
    ['gigs', 'My gigs'],
  ];

  const tabs = isAdmin ? adminTabs : memberTabs;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Gig Manager</span>
        <div className="app-header__right">
          <NotificationBell onNavigate={(url) => {
            const tab = url.replace('/', '');
            if (['gigs','venues','clients','bands','musicians','profile'].includes(tab)) updateView(tab);
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
        {view === 'gigs' && <GigsList />}
        {view === 'venues' && isAdmin && <VenuesList />}
        {view === 'clients' && isAdmin && <ClientsList />}
        {view === 'bands' && isAdmin && <BandsList />}
        {view === 'musicians' && isAdmin && <MusiciansList />}
        {view === 'profile' && <MyProfile />}
      </main>
    </div>
  );
}