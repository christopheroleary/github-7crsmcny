import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

export function useGigStagePlot(gigId, buildSeed) {
  const [config, setConfig] = useState(null);
  const [visibleToBand, setVisibleToBandState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const buildSeedRef = useRef(buildSeed);
  buildSeedRef.current = buildSeed;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: loadError } = await supabase
        .from('gig_stage_plots')
        .select('config, visible_to_band')
        .eq('gig_id', gigId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) { setError(loadError.message); setLoading(false); return; }
      setConfig(data?.config ?? buildSeedRef.current());
      setVisibleToBandState(data?.visible_to_band ?? false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gigId]);

  const save = useCallback(async (nextConfig) => {
    const { error: saveError } = await supabase
      .from('gig_stage_plots')
      .upsert({ gig_id: gigId, config: nextConfig, updated_at: new Date().toISOString() }, { onConflict: 'gig_id' });
    if (saveError) throw saveError;
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

  return { config, visibleToBand, setVisibleToBand, loading, error, save };
}
