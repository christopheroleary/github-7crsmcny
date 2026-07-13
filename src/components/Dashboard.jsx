import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '../supabaseClient';
import { todayStr, twelveMonthsAgoStr } from '../utils/formatDate.js';

function KPICard({ label, count, value, colour }) {
  return (
    <div className="kpi-card" style={{ borderTopColor: colour }}>
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__count">{count}</p>
      {value != null && <p className="kpi-card__value">£{Math.round(value).toLocaleString('en-GB')}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [outstanding, setOutstanding] = useState({ count: 0, value: 0 });
  const [upcoming, setUpcoming] = useState({ count: 0, value: 0 });
  const [thisMonth, setThisMonth] = useState({ count: 0, value: 0 });
  const [allGigs, setAllGigs] = useState(0);
  const [unInvoiced, setUnInvoiced] = useState({ count: 0, value: 0 });
  const [trends, setTrends] = useState([]);

  useEffect(() => {
    async function load() {
      const today = todayStr();
      const monthStart = today.slice(0, 7) + '-01';
      const twelveAgo = twelveMonthsAgoStr();

      const [
        { data: completedGigs }, 
        { data: upcomingGigs }, 
        { data: trendGigs },
        { data: allGigsData },
        { data: pastGigs }
      ] = await Promise.all([
        supabase.from('gigs')
          .select('id, fee_amount, invoices(status)')
          .eq('status', 'completed'),
        supabase.from('gigs')
          .select('id, fee_amount, gig_date')
          .gte('gig_date', today)
          .not('status', 'in', '("cancelled")'),
        supabase.from('gigs')
          .select('gig_date, fee_amount, status')
          .gte('gig_date', twelveAgo)
          .not('status', 'in', '("cancelled")'),
        supabase.from('gigs')
          .select('id'),
        supabase.from('gigs')
          .select('id, fee_amount, gig_date, invoices(status)')
          .lt('gig_date', today)
          .not('status', 'in', '("cancelled")')
      ]);

      // All Gigs Count
      setAllGigs((allGigsData || []).length);

      // Un-invoiced past gigs (No invoices, or only draft/cancelled ones)
      const unInvoicedGigs = (pastGigs || []).filter(g => 
        !g.invoices?.some(inv => inv.status === 'sent' || inv.status === 'paid')
      );
      setUnInvoiced({
        count: unInvoicedGigs.length,
        value: unInvoicedGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
      });

      // Outstanding: completed with no paid invoice
      const outstandingGigs = (completedGigs || []).filter(g =>
        !g.invoices?.some(inv => inv.status === 'paid')
      );
      setOutstanding({
        count: outstandingGigs.length,
        value: outstandingGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
      });

      // Upcoming
      setUpcoming({
        count: (upcomingGigs || []).length,
        value: (upcomingGigs || []).reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
      });

      // This month (subset of upcoming if month hasn't ended, or from trendGigs)
      const thisMonthGigs = (trendGigs || []).filter(g => g.gig_date >= monthStart && g.gig_date <= today);
      setThisMonth({
        count: thisMonthGigs.length,
        value: thisMonthGigs.reduce((s, g) => s + (Number(g.fee_amount) || 0), 0),
      });

      // Build monthly trend data dynamically
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
          monthMap[key].revenue += Math.round(Number(g.fee_amount) || 0);
        }
      });
      
      setTrends(Object.values(monthMap));
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p className="state-message">Loading dashboard…</p>;

  return (
    <div className="dashboard">
      <h2 className="section-header__title" style={{ marginBottom: 16 }}>Dashboard</h2>

      <div className="kpi-row">
        <KPICard label="All gigs" count={allGigs + ' gigs'} colour="#71717a" />
        <KPICard label="Un-invoiced (past)" count={unInvoiced.count + ' gigs'} value={unInvoiced.value} colour="#c2410c" />
        <KPICard label="Outstanding (unpaid)" count={outstanding.count + ' gigs'} value={outstanding.value} colour="var(--rust)" />
        <KPICard label="Upcoming gigs" count={upcoming.count + ' gigs'} value={upcoming.value} colour="var(--amber)" />
        <KPICard label="This month" count={thisMonth.count + ' gigs'} value={thisMonth.value} colour="var(--teal)" />
      </div>

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
            <YAxis yAxisId="rev" orientation="right" tick={{ fontSize: 11 }}
              tickFormatter={v => '£' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
            <YAxis yAxisId="gig" orientation="left" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(value, name) => name === 'revenue' ? ['£' + value.toLocaleString('en-GB'), 'Revenue'] : [value, 'Gigs']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--line)' }}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#c8862e" fill="url(#revGrad)" strokeWidth={2} name="revenue" />
            <Area yAxisId="gig" type="monotone" dataKey="gigs" stroke="#1f3d3a" fill="url(#gigGrad)" strokeWidth={2} name="gigs" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}