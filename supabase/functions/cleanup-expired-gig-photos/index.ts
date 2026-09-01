import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// New-style secret key, not the legacy service_role JWT -- see
// notify-admin/index.ts for why every function was migrated off it.
const SUPABASE_SERVICE_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['secret'];
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Bounds one invocation's work so a large backlog (shouldn't normally
// happen at a daily cadence, but a paused cron/quiet period could build
// one up) can't blow the Edge Function's execution ceiling -- same
// reasoning as refresh-venue-nearby-places' SWEEP_BATCH_SIZE. Oldest
// (soonest-expired) first, so a genuine backlog clears over a few days'
// worth of runs rather than the sweep repeatedly picking the same
// (arbitrary) 200 rows and never making progress.
const BATCH_SIZE = 200;

Deno.serve(async (_req) => {
  try {
    const { data: expired, error } = await admin
      .from('gig_photos')
      .select('id, storage_path')
      .lt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ ok: true, deleted: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    const paths = expired.map((p) => p.storage_path);
    const ids = expired.map((p) => p.id);

    // One call for up to 200 paths, not 200 calls -- Storage's remove()
    // already accepts an array.
    const { error: storageError } = await admin.storage.from('gig-photos').remove(paths);
    // Delete the DB rows regardless of a partial storage failure: an
    // orphaned storage object costs a few pence and self-corrects never,
    // but a gig_photos row pointing at an already-deleted image is a
    // permanently broken gallery thumbnail forever -- the worse outcome
    // to leave in place. Log the mismatch rather than retry-looping here;
    // a genuinely stuck orphan needs a one-off manual check, not automated
    // retry logic inside a cron sweep.
    if (storageError) {
      console.error('cleanup-expired-gig-photos: storage removal error (deleting rows anyway):', storageError.message);
    }

    const { error: deleteError } = await admin.from('gig_photos').delete().in('id', ids);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ ok: true, deleted: ids.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('cleanup-expired-gig-photos error:', err);
    // Cron-invoked -- nobody reads this response body, so keep the real
    // error in the logs only.
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
