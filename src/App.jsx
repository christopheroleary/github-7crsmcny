import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import Login from './components/Login.jsx';
import GigsList from './components/GigsList.jsx';
import VenuesList from './components/VenuesList.jsx';
import MyProfile from './components/MyProfile.jsx';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('gigs');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (!session) return <Login />;

  const tabs = [
    ['gigs', 'Gigs'],
    ['venues', 'Venues'],
    ['profile', 'My profile'],
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Gig Manager</span>
        <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <nav className="tab-nav">
        {tabs.map(([key, label]) => (
          <button key={key} className={view === key ? 'tab tab--active' : 'tab'} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {view === 'gigs' && <GigsList />}
        {view === 'venues' && <VenuesList />}
        {view === 'profile' && <MyProfile />}
      </main>
    </div>
  );
}