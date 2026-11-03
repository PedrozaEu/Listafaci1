import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export const PENDING_INVITE_KEY = 'listafacil-pending-invite';
export const OPEN_LIST_KEY = 'listafacil-open-list';

/** Pending destination bound to the account that accepted; another session never reuses it. */
export const setOpenTarget = (userId: string, listId: string) =>
  localStorage.setItem(OPEN_LIST_KEY, JSON.stringify({ userId, listId }));
export const readOpenTarget = (userId: string): string | null => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_LIST_KEY) ?? 'null') as { userId?: string; listId?: string } | null;
    return v && v.userId === userId && typeof v.listId === 'string' ? v.listId : null;
  } catch { return null; }
};

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

type Peek = { status: 'ok' | 'valid' | 'invalid' | 'expired' | 'revoked' | 'consumed' | 'already_member' | 'discontinued' | 'review' | 'removed' | 'list_unavailable'; list_name?: string; owner_name?: string; role?: string; list_id?: string };
const messages: Record<Exclude<Peek['status'], 'valid' | 'ok'>, string> = {
  invalid: 'Este convite não existe. Confira se o link foi copiado inteiro.',
  expired: 'Este convite expirou. Peça um novo convite ao dono da lista.',
  revoked: 'Este convite foi cancelado pelo dono da lista.',
  consumed: 'Este convite já foi usado por outra pessoa. Peça um novo convite.',
  already_member: 'Vínculo confirmado. Você já participa desta lista.',
  discontinued: 'Este convite usa um perfil que não existe mais. Peça ao dono da lista um convite novo.',
  review: 'Seu vínculo com esta lista está em revisão. O dono precisa escolher Editor ou Apenas marcar.',
  removed: 'Seu acesso a esta lista foi removido pelo dono.',
  list_unavailable: 'Esta lista não está mais disponível.',
};

/** Opening the link only reads the invite; it is consumed only when the signed-in recipient confirms. */
export default function Invite() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(() => {
    const t = location.hash.slice(1) || sessionStorage.getItem(PENDING_INVITE_KEY) || '';
    if (location.hash) history.replaceState(null, '', '/convite'); // keep the token out of history
    if (t) sessionStorage.setItem(PENDING_INVITE_KEY, t);
    return t;
  });
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user || !token) return;
    rpc('peek_list_invite', { _token: token }).then(r => {
      if (r.error) setError('Sem conexão para conferir o convite. Tente de novo quando estiver online.');
      else setPeek(r.data as Peek);
    });
  }, [user, loading, token]);

  const open = (listId: string) => {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    if (user) setOpenTarget(user.id, listId);
    navigate('/', { replace: true });
  };

  const accept = async () => {
    setBusy(true);
    const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email?.split('@')[0] ?? 'Participante';
    const r = await rpc('accept_list_invite_v2', { _token: token, _display_name: name });
    setBusy(false);
    if (r.error) { setError('Não foi possível aceitar agora. Confira a conexão e tente de novo.'); return; }
    const res = r.data as Peek;
    if (res.status === 'ok' || res.status === 'already_member') open(res.list_id!);
    else setPeek(res);
  };

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-4 rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">Convite para uma lista</h1>
        {!token ? <p>Link de convite incompleto.</p>
          : loading ? <p>Carregando...</p>
          : !user ? (
            <>
              <p>Entre com a sua própria conta para ver e aceitar o convite. Ninguém vai pedir a senha de quem convidou.</p>
              <Button className="min-h-11 w-full" onClick={() => navigate('/auth')}>Entrar ou criar conta</Button>
            </>
          ) : error ? <p role="alert">{error}</p>
          : !peek ? <p>Conferindo o convite...</p>
          : peek.status === 'valid' ? (
            <>
              <p><strong>{peek.owner_name}</strong> convidou você para a lista <strong>{peek.list_name}</strong>.</p>
              <p>Permissão: {peek.role === 'editor' ? 'Editar itens (adicionar, editar, excluir e marcar produtos)' : 'Apenas marcar (marcar e desmarcar produtos, sem alterar os dados)'}. O convite vale só para esta lista; suas listas continuam suas.</p>
              <Button className="min-h-11 w-full" onClick={accept} disabled={busy}>{busy ? 'Aceitando...' : 'Aceitar e abrir a lista'}</Button>
              <Button variant="ghost" className="min-h-11 w-full" onClick={() => { sessionStorage.removeItem(PENDING_INVITE_KEY); navigate('/'); }}>Agora não</Button>
            </>
          ) : (
            <>
              <p role="status">{peek.status === 'ok' ? '' : messages[peek.status]}</p>
              {peek.status === 'already_member' && peek.list_id
                ? <Button className="min-h-11 w-full" onClick={() => open(peek.list_id!)}>Abrir a lista</Button>
                : <Button variant="outline" className="min-h-11 w-full" onClick={() => { sessionStorage.removeItem(PENDING_INVITE_KEY); navigate('/'); }}>Ir para minhas listas</Button>}
            </>
          )}
      </div>
    </main>
  );
}
