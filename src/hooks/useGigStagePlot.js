import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Loads a gig's saved stage plot if one exists; otherwise builds a fresh
 * seed from `buildSeed()` (deferred to the caller -- GigStagePlot.jsx
 * passes buildStagePlotSeed() already applied to its own gig/venue/lineup
 * props, since this hook has no reason to know their shape). A saved
 * plot always wins over a freshly-built seed, so nobody's manual drags
 * ever get silently re-derived away just because this remounted.
 *
 * `config` is only ever recomputed when `gigId` changes -- switching
 * gigs is what should reset it, not every render of the parent (which
 * would otherwise stomp on in-progress edits the same way a re-seeded
 * initialConfig would inside StagePlot.jsx itself).
 */
export function useGigStagePlot(gigId, buildSeed) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const buildSeedRef = useRef(buildSeed);
  buildSeedRef.current = buildSeed;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: loadError } = await supabase
        .from('gig_stage_plots')
        .select('config')
        .eq('gig_id', gigId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        setLoading(false);
        return;
      }
      setConfig(data?.config ?? buildSeedRef.current());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gigId]);

  const save = useCallback(
    async (nextConfig) => {
      const { error: saveError } = await supabase
        .from('gig_stage_plots')
        .upsert({ gig_id: gigId, config: nextConfig, updated_at: new Date().toISOString() }, { onConflict: 'gig_id' });
      if (saveError) throw saveError;
    },
    [gigId]
  );

  return { config, loading, error, save };
}
