import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useIsOffline } from './useIsOffline.js';
import { isLikelyOfflineError } from '../utils/networkError.js';

// cachedStagePlot: the { config, visible_to_band } row as last saved to
// this device by useOfflineGigData, or null if this gig's never been
// synced. Fallen back to on a failed load -- same read-only-offline
// pattern as GigRoster/GigSetlist; a musician or admin can still see the
// last-saved layout with no signal, dragging/saving/toggling visibility
// still needs one (GigStagePlot.jsx's own save()/setVisibleToBand calls
// aren't guarded here, they just fail the way any offline write does).
//
// refreshSignal: bumped by the gig page's own "↻ Refresh" button --
// previously unused here, so that button silently skipped the stage plot.
export function useGigStagePlot(gigId, buildSeed, cachedStagePlot = null, refreshSignal) {
  const [config, setConfig] = useState(null);
  const [visibleToBand, setVisibleToBandState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usingCache, setUsingCache] = useState(false);
  const buildSeedRef = useRef(buildSeed);
  buildSeedRef.current = buildSeed;
  const cachedRef = useRef(cachedStagePlot);
  cachedRef.current = cachedStagePlot;
  const configRef = useRef(config);
  configRef.current = config;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('gig_stage_plots')
      .select('config, visible_to_band')
      .eq('gig_id', gigId)
      .maybeSingle();
    if (loadError) {
      // A genuine (non-network) error is surfaced honestly even when a
      // cached plot exists, rather than silently hiding it behind a
      // "connection trouble" banner that would misdescribe what actually
      // happened.
      if (cachedRef.current && isLikelyOfflineError(loadError)) {
        setConfig(cachedRef.current.config ?? buildSeedRef.current());
        setVisibleToBandState(cachedRef.current.visible_to_band ?? false);
        setUsingCache(true);
        setLoading(false);
      } else {
        setUsingCache(false);
        setError(loadError.message);
        setLoading(false);
      }
      return;
    }
    setUsingCache(false);
    setConfig(data?.config ?? buildSeedRef.current());
    setVisibleToBandState(data?.visible_to_band ?? false);
    setLoading(false);
  }, [gigId]);

  // Re-fetches the moment connectivity returns -- without this, a stage
  // plot that fell back to cache stayed on that stale snapshot even once
  // back online.
  const isOffline = useIsOffline(load);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshSignal]);

  const save = useCallback(async (nextConfig) => {
    const { error: saveError } = await supabase
      .from('gig_stage_plots')
      .upsert({ gig_id: gigId, config: nextConfig, updated_at: new Date().toISOString() }, { onConflict: 'gig_id' });
    if (saveError) throw saveError;
    // Without this, this hook's own `config` state stays frozen at
    // whatever was loaded on mount -- every drag/autosave since then
    // wrote fresh positions straight to Supabase without this hook ever
    // learning about them. Harmless on its own, but setVisibleToBand
    // below upserts using configRef.current, so flipping that toggle was
    // silently overwriting every real saved position with the stale
    // load-time snapshot (the admin's own view kept showing the real
    // positions from StagePlot's own separate in-memory state right up
    // until they left and came back, at which point THIS now-clobbered
    // row was reloaded and they saw the reset too).
    setConfig(nextConfig);
  }, [gigId]);

  // Plain `update` would silently touch zero rows for a gig whose plot has
  // never been saved yet (no row to update) -- upsert instead, carrying
  // along whatever config is already loaded (or the seed, if somehow
  // nothing is) so flipping the toggle before the first real save still
  // works rather than failing invisibly.
  const setVisibleToBand = useCallback(async (next) => {
    setVisibleToBandState(next);
    const { error: visError } = await supabase
      .from('gig_stage_plots')
      .upsert(
        { gig_id: gigId, config: configRef.current ?? buildSeedRef.current(), visible_to_band: next, updated_at: new Date().toISOString() },
        { onConflict: 'gig_id' }
      );
    if (visError) { setVisibleToBandState(!next); throw visError; }
  }, [gigId]);

  return { config, visibleToBand, setVisibleToBand, loading, error, usingCache, isOffline, save };
}
