import { supabase } from '../supabaseClient';

// Powers TasksWidget.jsx (Dashboard) -- every task the current viewer is
// allowed to see, across every band, in one round of queries. No band_id
// loop: the three derived-task RPCs and the `tasks` table itself are both
// scoped by RLS (is_admin() or is_band_leader_of()) rather than by a list
// of ids passed in from the client, so a real admin sees every band's
// tasks the same "no filter, company-wide" way the rest of Dashboard.jsx
// already treats them, and a band leader sees only their own -- without
// this needing to know which case it's in.
//
// Derived tasks are never written to a table -- they're recomputed live
// every call, so they can't go stale and "completing" one always means
// fixing the real thing, not dismissing a copy of it.
export async function loadMyTasks() {
  const [
    { data: manual },
    { data: needsInvoicing },
    { data: anniversaries },
    { data: uninvitedDeps },
  ] = await Promise.all([
    supabase.from('tasks').select('id, title, due_date, done, gig_id, client_id, band_id, bands(name)').eq('done', false),
    supabase.rpc('get_needs_invoicing_tasks'),
    supabase.rpc('get_client_anniversary_tasks'),
    supabase.rpc('get_uninvited_dep_tasks'),
  ]);

  const items = [
    ...(manual || []).map((t) => ({
      key: 'manual-' + t.id,
      kind: 'manual',
      id: t.id,
      title: t.title,
      due_date: t.due_date,
      gig_id: t.gig_id,
      band_id: t.band_id,
      band_name: t.bands?.name || 'Band',
    })),
    ...(needsInvoicing || []).map((r) => ({
      key: 'invoice-' + r.gig_id,
      kind: 'needs_invoicing',
      title: (r.venue_name || 'A gig') + ' still needs invoicing',
      due_date: r.gig_date,
      gig_id: r.gig_id,
      band_id: r.band_id,
      band_name: r.band_name,
    })),
    ...(anniversaries || []).map((r) => ({
      key: 'anniversary-' + r.client_id,
      kind: 'anniversary',
      title: "It's nearly a year since " + r.client_name + "'s last booking — worth a pitch for next year?",
      due_date: null,
      client_id: r.client_id,
      band_id: r.band_id,
      band_name: r.band_name,
    })),
    ...(uninvitedDeps || []).map((r) => ({
      key: 'dep-' + r.placeholder_id,
      kind: 'uninvited_dep',
      title: r.dep_name + ' has never been sent an invite to sign up',
      due_date: null,
      band_id: r.band_id,
      band_name: r.band_name,
    })),
  ];

  // Soonest concrete deadline first (matches how GigsList already orders
  // "needs attention" lists); undated items last, in whatever order they
  // arrived.
  return items.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}
