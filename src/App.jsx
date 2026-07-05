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

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const { isAdmin, loading: profileLoading } = useCurrentProfile();
  const [view, setView] = useState('gigs');

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

  // Handle notification click navigation
  // Notification URLs are tab names like '/gigs' or '/profile'
  function handleNotificationNavigate(url) {
    if (!url) return;
    const tab = url.replace('/', '');
    const validTabs = ['gigs', 'venues', 'clients', 'bands', 'musicians', 'profile'];
    if (validTabs.includes(tab)) setView(tab);
  }

  if (sessionLoading || profileLoading) {
    return <div className="page-loading">Loading…</div>;
  }

  if (!session) return <Login />;

  const adminTabs = [
    ['gigs', 'Gigs'],
    ['venues', 'Venues'],
    ['clients', 'Clients'],
    ['bands', 'Bands'],
    ['musicians', 'Musicians'],
    ['profile', 'My profile'],
  ];

  const memberTabs = [
    ['gigs', 'My gigs'],
    ['profile', 'My profile'],
  ];

  const tabs = isAdmin ? adminTabs : memberTabs;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Gig Manager</span>
        <div className="app-header__right">
          <NotificationBell onNavigate={handleNotificationNavigate} />
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
            onClick={() => setView(key)}
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