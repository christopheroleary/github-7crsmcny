import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '../supabaseClient';
import { todayStr, twelveMonthsAgoStr, formatShortDate } from '../utils/formatDate.js';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import DailyNewsWidget from './DailyNewsWidget.jsx';
import MyEarnings from './MyEarnings.jsx';

function KPICard({ label, count, value, colour, onClick }) {
  return (
    <button type="button" className="kpi-card kpi-card--clickable" style={{ borderTopColor: colour }} onClick={onClick}>
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__count">{count}</p>
      {value != null && <p className="kpi-card__value">£{Math.round(value).toLocaleString('en-GB')}</p>}
    </button>
  );
}

// Table of the gigs behind a KPI card. Admin sees client + fee + invoice
// status; musicians only ever see gigs they're personally booked on, with
// no fee/client info — matching what they can already see on their own
// gigs list elsewhere in the app.
function DrilldownModal({ title, gigs, isAdmin, onClose, onSelectGig }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="section-header">
          <h3 className="section-header__title">{title}</h3>
          <button type="button" className="link-button" onClick={onClose}>✕ Close</button>
        </div>
        {gigs.length === 0 ? (
          <p className="state-message">No gigs in this list.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="travel-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Venue</th>
                  <th>Band</th>
                  {isAdmin && <th>Client</th>}
                  <th>Status</th>
                  {isAdmin && <th>Fee</th>}
                  {isAdmin && <th>Invoice</th>}
                </tr>
              </thead>
              <tbody>
                {[...gigs].sort((a, b) => a.gig_date.localeCompare(b.gig_date)).map((g) => (
                  <tr key={g.id} onClick={() => onSelectGig(g.id)} style={{ cursor: 'pointer' }}>
                    <td>{formatShortDate(g.gig_date)}</td>
                    <td>{g.venues?.name || '—'}</td>
                    <td>{g.bands?.name || '—'}</td>
                    {isAdmin && <td>{g.clients?.name || '—'}</td>}
                    <td>{g.status}</td>
                    {isAdmin && <td>{g.fee_amount != null ? '£' + Math.round(Number(g.fee_amount)).toLocaleString('en-GB') : '—'}</td>}
                    {isAdmin && <td>{g.invoices?.status === 'paid' ? 'Paid' : g.invoices?.status === 'sent' ? 'Sent' : g.invoices ? 'Draft' : 'None'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard({ onNavigate }) {
  const { isAdmin: isAdminRole, isBandLeader, ledBandIds, profile } = useCurrentProfile();
  // Band leaders get the same full business-shaped dashboard query as admin
  // -- but unlike admin, RLS alone doesn't scope it to "their" business: a
  // leader can SELECT any gig they're merely performing on too (is_on_gig),
  // so an unfiltered query here would sum another band's fees into this
  // leader's revenue/outstanding totals and list them in the drilldown
  // table's Client/Fee/Invoice columns. bandFilterIds below closes that --
  // null for a real admin (genuinely company-wide), an array of only their
  // own led bands for a leader.
  const isAdmin = isAdminRole || isBandLeader;
  const bandFilterIds = !isAdminRole && isBandLeader ? ledBandIds : null;
  // Only admin/leader get a toggle -- they're the only ones with a
  // "business" hat to switch away from. A plain musician has just the one
  // view, so My Earnings is appended below their existing cards instead
  // (see the bottom of the render) rather than gated behind a switch.
  const [dashboardMode, setDashboardMode] = useState('business');

  const [loading, setLoading] = useState(true);
  const [outstanding, setOutstanding] = useState({ count: 0, value: 0, gigs: [] });
  const [upcoming, setUpcoming] = useState({ count: 0, value: null, gigs: [] });
  const [thisMonth, setThisMonth] = useState({ count: 0, value: null, gigs: [] });
  const [allGigs, setAllGigs] = useState({ count: 0, gigs: [] });
  const [unInvoiced, setUnInvoiced] = useState({ count: 0, value: 0, gigs: [] });
  const [inquiries, setInquiries] = useState({ count: 0, gigs: [] });
  const [trends, setTrends] = useState([]);
  const [activeDrilldown, setActiveDrilldown] = useState(null); // one of the state keys above, or null

  useEffect(() => {
    async function load() {
      // Guards the whole body: an uncaught throw anywhere in here (as just
      // happened with an embedded-relation shape mismatch) used to leave
      // setLoading(false) unreached, freezing the page on "Loading
      // dashboard…" forever with no visible error.
      try {
        await loadImpl();
      } catch (err) {
        console.error('Dashboard failed to load:', err);
      } finally {
        setLoading(false);
      }
    }

    async function loadImpl() {
      const today = todayStr();
      const monthStart = today.slice(0, 7) + '-01';
      const twelveAgo = twelveMonthsAgoStr();

      function buildTrends(trendGigs, includeRevenue) {
        const monthMap = {};
        const now = new Date();
        let endYear = now.getFullYear();
        let endMonth = now.getMonth();

        (trendGigs || []).forEach(g => {
          const year = parseInt(g.gig_date.slice(0, 4), 10);
          const month = parseInt(g.gig_date.slice(5, 7), 10) - 1;
          if (year > endYear || (year === endYear && month > endMonth)) {
            endYear = year;
            endMonth = month;
          }
        });

        const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);

        while (true) {
          const y = d.getFullYear();
          const m = d.getMonth();
          const key = `${y}-${String(m + 1).padStart(2, '0')}`;
          const label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

          monthMap[key] = { month: label, gigs: 0, revenue: 0 };

          if (y === endYear && m === endMonth) break;
          d.setMonth(m + 1);
        }

        (trendGigs || []).forEach(g => {
          const key = g.gig_date.slice(0, 7);
          if (monthMap[key]) {
            monthMap[key].gigs += 1;
            if (includeRevenue) {
              monthMap[key].revenue += Math.round(Number(g.fee_amount) || 0);
            }
          }
        });

        setTrends(Object.values(monthMap));
      }

      if (isAdmin) {
        // ── ADMIN VIEW — full business detail. For a real admin this is
        // genuinely company-wide; for a leader-only viewer, bandFilterIds
        // narrows every query below to just the bands they lead, so a gig
        // they're merely performing on for someone else's band never
        // contributes its fee or shows up in the drilldown table. ──
        const gigCols = 'id, fee_amount, gig_date, status, venues(name), bands(name), clients(name), invoices(status)';
        // Applied identically to every query below rather than repeating the
        // conditional six times.
        const scoped = (q) => (bandFilterIds ? q.in('band_id', bandFilterIds) : q);
        const [
          { data: completedGigs },
          { data: upcomingGigs },
          { data: trendGigs },
          { data: allGigsData },
          { data: pastGigs },
          { data: inquiryGigs }
        ] = await Promise.all([
          scoped(supabase.from('gigs').select(gigCols).eq('status', 'completed')),
          scoped(supabase.from('gigs').select(gigCols).gte('gig_date', today).not('status', 'in', '("cancelled")')),
          scoped(supabase.from('gigs').select('gig_date, fee_amount, status').gte('gig_date', twelveAgo).not('status', 'in', '("cancelled")')),
          scoped(supabase.from('gigs').select(gigCols)),
          scoped(supabase.from('gigs').select(gigCols).lt('gig_date', today).not('status', 'in', '("cancelled")')),
          scoped(supabase.from('gigs').select(gigCols).eq('status', 'inquiry'))
        ]);

        setAllGigs({ count: (allGigsData || []).length, gigs: allGigsData || [] });
        setInquiries({ count: (inquiryGigs || []).length, gigs: inquiryGigs || [] });

        // invoices is embedded as a single object, not an array -- invoices.gig_id
        // has a UNIQUE constraint, so PostgREST returns a to-one relationship.
        const unInvoicedGigs = (pastGigs || []).filter(g => g.invoices?.status !== 'sent' && g.invoices?.status !== 'paid');
        setUnInvoiced({
          count: unInvoicedGigs.length,
          value: unInvoicedGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
          gigs: unInvoicedGigs,
        });

        const outstandingGigs = (completedGigs || []).filter(g => g.invoices?.status !== 'paid');
        setOutstanding({
          count: outstandingGigs.length,
          value: outstandingGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
          gigs: outstandingGigs,
        });

        setUpcoming({
          count: (upcomingGigs || []).length,
          value: (upcomingGigs || []).reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
          gigs: upcomingGigs || [],
        });

        // upcomingGigs (>= today) and pastGigs (< today) are mutually exclusive
        // by date and both already exclude cancelled gigs, so together they
        // cover every gig that could fall in the current month.
        const thisMonthGigs = (upcomingGigs || []).concat(pastGigs || [])
          .filter(g => g.gig_date >= monthStart && g.gig_date <= today);
        setThisMonth({
          count: thisMonthGigs.length,
          value: thisMonthGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
          gigs: thisMonthGigs,
        });

        buildTrends(trendGigs, true);

      } else {
        // ── MUSICIAN VIEW — scoped to gigs they're personally booked on only,
        // matching what they can already see on their own gigs list. No fee
        // or client info, same as the rest of the app shows them. ──
        const gigCols = 'id, gig_date, status, venues(name), bands(name), gig_lineup!inner(profile_id)';
        const [
          { data: upcomingGigs },
          { data: trendGigs },
          { data: allGigsData },
          { data: inquiryGigs }
        ] = await Promise.all([
          supabase.from('gigs').select(gigCols).gte('gig_date', today).not('status', 'in', '("cancelled")').eq('gig_lineup.profile_id', profile?.id),
          supabase.from('gigs').select('gig_date, gig_lineup!inner(profile_id)').gte('gig_date', twelveAgo).not('status', 'in', '("cancelled")').eq('gig_lineup.profile_id', profile?.id),
          supabase.from('gigs').select(gigCols).eq('gig_lineup.profile_id', profile?.id),
          supabase.from('gigs').select(gigCols).eq('status', 'inquiry').eq('gig_lineup.profile_id', profile?.id)
        ]);

        setAllGigs({ count: (allGigsData || []).length, gigs: allGigsData || [] });
        setInquiries({ count: (inquiryGigs || []).length, gigs: inquiryGigs || [] });
        setUpcoming({ count: (upcomingGigs || []).length, value: null, gigs: upcomingGigs || [] });

        const thisMonthGigs = (allGigsData || []).filter(g => g.gig_date >= monthStart && g.gig_date <= today && g.status !== 'cancelled');
        setThisMonth({ count: thisMonthGigs.length, value: null, gigs: thisMonthGigs });

        buildTrends(trendGigs, false);
      }
    }

    load();
  }, [isAdmin, bandFilterIds, profile]);

  if (loading) return <p className="state-message">Loading dashboard…</p>;

  function selectGig(gigId) {
    setActiveDrilldown(null);
    onNavigate?.({ url: '/gigs', gig_id: gigId });
  }

  const drilldowns = {
    allGigs: { title: 'All gigs', data: allGigs },
    inquiries: { title: 'Inquiries', data: inquiries },
    unInvoiced: { title: 'Un-invoiced (past)', data: unInvoiced },
    outstanding: { title: 'Outstanding (unpaid)', data: outstanding },
    upcoming: { title: isAdmin ? 'Upcoming gigs' : 'My upcoming gigs', data: upcoming },
    thisMonth: { title: 'This month', data: thisMonth },
  };

  return (
    <div className="dashboard">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <h2 className="section-header__title">Dashboard</h2>
        {/* Only admin/leader have a "business" hat to switch away from -- a
            plain musician gets My Earnings appended below instead, always
            visible, no toggle needed (see the bottom of this component). */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`btn btn--small ${dashboardMode === 'business' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setDashboardMode('business')}
            >
              Business
            </button>
            <button
              type="button"
              className={`btn btn--small ${dashboardMode === 'earnings' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setDashboardMode('earnings')}
            >
              My earnings
            </button>
          </div>
        )}
      </div>

      {(!isAdmin || dashboardMode === 'business') && (
        <>
          <div className="kpi-row">
            <KPICard label="All gigs" count={allGigs.count + ' gigs'} colour="#71717a" onClick={() => setActiveDrilldown('allGigs')} />
            <KPICard label="Inquiries" count={inquiries.count + ' gigs'} colour="#8b5cf6" onClick={() => setActiveDrilldown('inquiries')} />

            {isAdmin && (
              <>
                <KPICard label="Un-invoiced (past)" count={unInvoiced.count + ' gigs'} value={unInvoiced.value} colour="#c2410c" onClick={() => setActiveDrilldown('unInvoiced')} />
                <KPICard label="Outstanding (unpaid)" count={outstanding.count + ' gigs'} value={outstanding.value} colour="var(--rust)" onClick={() => setActiveDrilldown('outstanding')} />
              </>
            )}
            <KPICard label={isAdmin ? "Upcoming gigs" : "My upcoming"} count={upcoming.count + ' gigs'} value={upcoming.value} colour="var(--amber)" onClick={() => setActiveDrilldown('upcoming')} />
            <KPICard label="This month" count={thisMonth.count + ' gigs'} value={thisMonth.value} colour="var(--teal)" onClick={() => setActiveDrilldown('thisMonth')} />
          </div>

          {activeDrilldown && (
            <DrilldownModal
              title={drilldowns[activeDrilldown].title}
              gigs={drilldowns[activeDrilldown].data.gigs}
              isAdmin={isAdmin}
              onClose={() => setActiveDrilldown(null)}
              onSelectGig={selectGig}
            />
          )}

          <div className="dashboard-chart">
            <p className="dashboard-chart__title">Trend (Historical & Upcoming)</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c8862e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#c8862e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gigGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1f3d3a" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#1f3d3a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd5c7" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} />

                {isAdmin && (
                  <YAxis yAxisId="rev" orientation="right" tick={{ fontSize: 11 }}
                    tickFormatter={v => '£' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
                )}

                <YAxis yAxisId="gig" orientation="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value, name) => name === 'revenue' ? ['£' + value.toLocaleString('en-GB'), 'Revenue'] : [value, 'Gigs']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--line)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />

                {isAdmin && (
                  <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#c8862e" fill="url(#revGrad)" strokeWidth={2} name="revenue" />
                )}
                <Area yAxisId="gig" type="monotone" dataKey="gigs" stroke="#1f3d3a" fill="url(#gigGrad)" strokeWidth={2} name="gigs" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {isAdmin && dashboardMode === 'earnings' && (
        <MyEarnings profileId={profile?.id} ledBandIds={ledBandIds} />
      )}

      {!isAdmin && (
        <div className="day-sheet__section">
          <h3 className="day-sheet__section-title">My earnings</h3>
          <MyEarnings profileId={profile?.id} ledBandIds={ledBandIds} />
        </div>
      )}

      <DailyNewsWidget />
    </div>
  );
}
