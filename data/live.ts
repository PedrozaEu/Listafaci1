import { supabase } from '@/integrations/supabase/client';

export type LiveState = 'off' | 'connecting' | 'live';

/**
 * Live notifications for ONE open list: Postgres Changes on the persisted tables, filtered by list.
 * RLS decides who receives each event, so a removed member stops receiving them. Events only signal
 * "something changed": the caller re-reads the authorized state (never trusts the payload) and keeps the outbox.
 */
export function subscribeList(listId: string, onChange: () => void, onState: (s: LiveState) => void) {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bump = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) onChange(); }, 300);
  };
  onState('connecting');
  const channel = supabase
    .channel(`lista-${listId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items', filter: `list_id=eq.${listId}` }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'list_members', filter: `list_id=eq.${listId}` }, bump)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_lists', filter: `id=eq.${listId}` }, bump)
    .subscribe(status => {
      if (closed) return;
      if (status === 'SUBSCRIBED') { onState('live'); bump(); } // (re)connected: fetch what may have been missed
      else onState('connecting');
    });
  return () => {
    closed = true;
    clearTimeout(timer);
    onState('off');
    void supabase.removeChannel(channel);
  };
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
