import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { buildListFile, parseListFile, ListFileError } from '@/lib/listFile';
import type { ShoppingList } from '@/types/shopping';

type Role = 'editor' | 'checker';
interface Prepared { pending: number; confirmedAt: number | null; revision: number; onServer: boolean }
interface Props {
  open: boolean;
  onClose: () => void;
  list: ShoppingList | undefined;
  signedIn: boolean;
  relational: boolean;
  userId: string | null;
  prepareShare: (listId: string) => Promise<Prepared | null>;
  refresh: () => void;
  onShareText: () => void;
  onOpenStorage: () => void;
}

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
const time = (t: number | null) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca');
const roleLabel: Record<Role, string> = { checker: 'Apenas marcar: marca e desmarca produtos, sem alterar os dados', editor: 'Editar itens: adiciona, edita, exclui e marca produtos' };
const roleName = (r: string) => r === 'owner' ? 'dono' : r === 'editor' ? 'editar itens' : r === 'checker' ? 'apenas marcar' : 'perfil antigo';

interface InviteRow { id: string; role: Role; expires_at: string }

/** Two different things: invite to THE SAME list, or send an independent copy. */
export function ShareDialog(p: Props) {
  const [role, setRole] = useState<Role>('checker');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<Prepared | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const importListCopy = useStore(s => s.importListCopy);
  const isOwner = (p.list?.role ?? 'owner') === 'owner';

  const loadInvites = async () => {
    if (!p.list || !p.relational || !isOwner) return;
    const { data } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)('list_invites' as never)
      .select('id, role, expires_at').eq('list_id', p.list.id).is('accepted_at', null).is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    setInvites((data as unknown as InviteRow[]) ?? []);
  };
  useEffect(() => {
    if (!p.open) { setLink(null); setQr(null); setState(null); return; }
    void loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.list?.id]);

  const sendCurrent = async () => {
    if (!p.list) return;
    setBusy(true);
    try {
      const st = await p.prepareShare(p.list.id);
      setState(st);
      if (!st?.onServer) { toast.error('Esta lista ainda não chegou à nuvem. Conecte-se à internet e tente de novo.'); return; }
      const r = await rpc('create_list_invite_v2', { _list_id: p.list.id, _role: role, _hours: 24 });
      if (r.error) {
        toast.error(/fetch|network/i.test(r.error.message) ? 'Sem conexão: o convite não foi criado.' : 'Não foi possível criar o convite.');
        return;
      }
      const token = (r.data as { token: string }).token;
      const url = `${location.origin}/convite#${token}`; // fragment: never sent to servers or logs
      setLink(url);
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 220 }));
      void loadInvites();
    } finally {
      setBusy(false);
    }
  };

  const shareNative = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: `Lista ${p.list?.name}`, text: 'Convite para continuar a lista no ListaFácil', url: link });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') void copy(); // cancel is not an error
    }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast.success('Link copiado'); }
    catch { toast('Selecione e copie o link mostrado abaixo.'); }
  };

  const exportFile = () => {
    if (!p.list) return;
    const blob = new Blob([buildListFile(p.list)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lista-${p.list.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const copyList = parseListFile(await f.text());
      importListCopy(copyList);
      toast.success(`Cópia "${copyList.name}" criada`, { description: 'É uma lista nova e independente: não recebe atualizações da original.' });
      p.onClose();
    } catch (e) {
      toast.error(e instanceof ListFileError ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeMember = async (userId: string) => {
    if (!p.list) return;
    const r = await rpc('remove_list_member', { _list_id: p.list.id, _user_id: userId });
    if (r.error) toast.error('Não foi possível remover.'); else { toast.success('Participante removido'); p.refresh(); }
  };
  const setRole2 = async (userId: string, r2: Role) => {
    if (!p.list) return;
    const r = await rpc('set_member_role', { _list_id: p.list.id, _user_id: userId, _role: r2 });
    if (r.error) toast.error('Não foi possível mudar a permissão.'); else { toast.success('Permissão atualizada'); p.refresh(); }
  };
  const revoke = async (id: string) => {
    const r = await rpc('revoke_list_invite', { _invite_id: id });
    if (r.error) toast.error('Não foi possível cancelar o convite.'); else { toast.success('Convite cancelado'); void loadInvites(); }
  };

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <Dialog open={p.open} onOpenChange={o => !o && p.onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compartilhar "{p.list?.name}"</DialogTitle>
          <DialogDescription>Compartilhe antes de começar a compra. Se este aparelho desligar antes de sincronizar, a outra pessoa não verá as alterações que só existiam nele.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="invite">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="invite" className="min-h-11">Mesma lista</TabsTrigger>
            <TabsTrigger value="copy" className="min-h-11">Enviar cópia</TabsTrigger>
          </TabsList>

          <TabsContent value="invite" className="space-y-3 pt-2 text-sm">
            <p>Convide alguém para usar só esta lista, com a própria conta. Suas outras listas, compras e histórico continuam privados.</p>
            {!p.signedIn ? <p className="text-muted-foreground">Entre na sua conta para convidar.</p>
              : !p.relational ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">Para convidar, atualize antes o armazenamento das listas.</p>
                  <Button variant="outline" className="min-h-11" onClick={p.onOpenStorage}>Armazenamento das listas</Button>
                </div>
              ) : !isOwner ? <p className="text-muted-foreground">Só o dono da lista pode convidar.</p>
              : (
                <>
                  <fieldset className="space-y-2">
                    <legend className="font-medium mb-1">Permissão de quem receber, só na lista "{p.list?.name}"</legend>
                    {(['checker', 'editor'] as Role[]).map(r => (
                      <label key={r} className="flex items-center gap-2 min-h-11 rounded-md border px-3 cursor-pointer has-[:checked]:border-primary">
                        <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                        {roleLabel[r]}
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-muted-foreground">O convite vale para uma pessoa e expira em 24 horas. Quem receber entra com a própria conta.</p>
                  {offline && <p className="text-warning" role="status">Sem internet: o convite não pode ser criado agora. A nuvem tem a versão confirmada às {time(state?.confirmedAt ?? null)}.</p>}
                  <Button className="min-h-11 w-full" onClick={sendCurrent} disabled={busy}>
                    {busy ? 'Sincronizando...' : `Convidar para "${p.list?.name ?? ''}" (${role === 'editor' ? 'editar itens' : 'apenas marcar'})`}
                  </Button>
                  {state && state.pending > 0 && (
                    <p className="text-warning" role="status">
                      {state.pending} alteração(ões) ainda não foram enviadas. A outra pessoa verá só a última versão salva, confirmada às {time(state.confirmedAt)}.
                    </p>
                  )}
                  {link && (
                    <div className="space-y-2 rounded-md border p-3">
                      <p className="text-primary">Convite criado. Revisão confirmada na nuvem: {state?.revision ?? 0}, às {time(state?.confirmedAt ?? null)}.</p>
                      {qr && <img src={qr} alt="QR do convite" width={220} height={220} className="mx-auto" />}
                      <input readOnly value={link} className="w-full rounded border px-2 py-1 text-xs" onFocus={e => e.currentTarget.select()} aria-label="Link do convite" />
                      <div className="flex gap-2">
                        {'share' in navigator && <Button className="min-h-11 flex-1" onClick={shareNative}>Compartilhar</Button>}
                        <Button variant="outline" className="min-h-11 flex-1" onClick={copy}>Copiar link</Button>
                      </div>
                    </div>
                  )}
                  {(p.list?.members?.length ?? 0) > 1 && (<>{p.list!.members!.some(m => m.status === 'review') && <p className="text-warning" role="status">Um participante tinha o perfil antigo de leitor e está sem acesso até você escolher Apenas marcar ou Editar itens.</p>}
                    <div className="space-y-1">
                      <p className="font-medium">Participantes</p>
                      {p.list!.members!.map(m => (
                        <div key={m.userId} className="flex items-center justify-between min-h-11">
                          <span><span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{ background: m.color }} />{m.name} · {m.status === 'review' ? 'aguardando você escolher a permissão' : roleName(m.role)}</span>
                          {m.role !== 'owner' && (
                            <span className="flex flex-wrap justify-end">
                              {(m.status === 'review' || m.role !== 'checker') && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setRole2(m.userId, 'checker')}>Apenas marcar</Button>}
                              {(m.status === 'review' || m.role !== 'editor') && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setRole2(m.userId, 'editor')}>Editar itens</Button>}
                              <Button size="sm" variant="ghost" className="min-h-11" onClick={() => removeMember(m.userId)}>Remover</Button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>)}
                  {invites.length > 0 && (
                    <div className="space-y-1">
                      <p className="font-medium">Convites ainda não aceitos</p>
                      {invites.map(i => (
                        <div key={i.id} className="flex items-center justify-between min-h-11">
                          <span>{i.role === 'editor' ? 'Editar itens' : i.role === 'checker' ? 'Apenas marcar' : 'Perfil antigo (reemita o convite)'}, expira às {time(new Date(i.expires_at).getTime())}</span>
                          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => revoke(i.id)}>Cancelar</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
          </TabsContent>

          <TabsContent value="copy" className="space-y-3 pt-2 text-sm">
            <p>Uma cópia é independente: ela <strong>não recebe</strong> as atualizações da lista original.</p>
            <Button variant="outline" className="min-h-11 w-full" onClick={p.onShareText}>Texto para consulta (WhatsApp)</Button>
            <Button variant="outline" className="min-h-11 w-full" onClick={exportFile}>Arquivo para importar (JSON)</Button>
            <div className="border-t pt-3 space-y-2">
              <p>Recebeu um arquivo? A importação cria uma lista nova, só sua.</p>
              <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="import-list" onChange={e => void importFile(e.target.files?.[0])} />
              <Button asChild variant="outline" className="min-h-11 w-full"><label htmlFor="import-list" className="cursor-pointer">Importar arquivo de lista</label></Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
