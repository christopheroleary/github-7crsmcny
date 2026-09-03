import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { confirmAsync } from '../utils/confirmService.js';
import { notify } from '../utils/toastService.js';

// Shared logic behind every "possible duplicates" panel (SongDuplicates.jsx,
// VenueDuplicates.jsx) -- load a flat list of candidate rows from an RPC,
// group them, sort each group so the suggested winner is first, run the
// merge RPC once per loser after a confirm, then reload. Each caller
// supplies its own field names, sort/confirm-message logic and does its own
// rendering -- this only owns the fetch/group/select/merge state machine,
// not any JSX, so how a "song" or "venue" row looks stays with the
// component that actually knows what one is.
export function useDuplicateMerger({ getGroupsRpc, mergeRpc, groupKeyField, sortCompare, buildConfirmMessage, noun, onMerged }) {
  const [groups, setGroups] = useState(null); // null = not checked yet
  const [loading, setLoading] = useState(false);
  const [selectedWinner, setSelectedWinner] = useState({}); // group key -> row id
  const [mergingKey, setMergingKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(getGroupsRpc);
    setLoading(false);
    if (error) {
      notify(`Couldn't check for duplicate ${noun}: ` + error.message);
      return;
    }
    setGroups(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getGroupsRpc, noun]);

  useEffect(() => { load(); }, [load]);

  const sortedGroups = useMemo(() => {
    if (!groups) return [];
    const map = new Map();
    groups.forEach((row) => {
      const key = row[groupKeyField];
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return Array.from(map.values()).map((rows) => [...rows].sort(sortCompare));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, groupKeyField]);

  function winnerFor(group) {
    const key = group[0][groupKeyField];
    return selectedWinner[key] || group[0].id;
  }

  function selectWinner(group, rowId) {
    const key = group[0][groupKeyField];
    setSelectedWinner((prev) => ({ ...prev, [key]: rowId }));
  }

  async function handleMerge(group) {
    const key = group[0][groupKeyField];
    const winnerId = winnerFor(group);
    const winner = group.find((r) => r.id === winnerId);
    const losers = group.filter((r) => r.id !== winnerId);

    const ok = await confirmAsync(buildConfirmMessage(winner, losers));
    if (!ok) return;

    setMergingKey(key);
    try {
      for (const loser of losers) {
        const { error } = await supabase.rpc(mergeRpc, { p_winner_id: winnerId, p_loser_id: loser.id });
        if (error) throw error;
      }
      notify(`Merged into "${winner.title || winner.name}".`, 'success');
      await load();
      onMerged?.();
    } catch (err) {
      notify("Couldn't merge: " + err.message);
    } finally {
      setMergingKey(null);
    }
  }

  return { groups, sortedGroups, loading, mergingKey, winnerFor, selectWinner, handleMerge };
}
