import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Upload, History } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import { downloadRecovery } from '@/lib/recovery';
import { supabase } from '@/integrations/supabase/client';
import {
  parseBackup, snapshotOf, BackupError, downloadBackup, loadStash, clearStash, isEmptySnapshot,
  mergeSnapshots, LEGACY, CONFLICT_COPY, type Snapshot,
} from '@/lib/backup';

const SAFETY_KEY = 'listafacil-antes-de-restaurar';

interface Version { id: string; created_at: string; data: Snapshot }

const countItems = (s: Snapshot) => (s.lists ?? []).reduce((n, l) => n + (l.items?.length ?? 0), 0);
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function BackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{ snap: Snapshot; label: string; join?: string } | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const download = () => {
    downloadBackup(snapshotOf(useStore.getState()));
    toast.success('Arquivo de backup gerado');
  };

  // Device copies kept aside: data from an older version without a known owner, and the device side of a divergence.
  const parked = open
    ? ([[LEGACY, 'Dados antigos deste aparelho (dono não identificado)'], [CONFLICT_COPY, 'Cópia do aparelho guardada numa divergência']] as const)
        .map(([key, label]) => ({ key, label, snap: loadStash(key) }))
        .filter(p => p.snap && !isEmptySnapshot(p.snap))
    : [];

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const snap = parseBackup(await file.text());
      setPendingRestore({ snap, label: `arquivo ${file.name}` });
    } catch (e) {
      toast.error(e instanceof BackupError ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const loadVersions = async () => {
    if (!user) return;
    setLoadingVersions(true);
    const { data, error } = await supabase
      .from('user_state_history').select('id, created_at, data')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
    setLoadingVersions(false);
    if (error) { toast.error('Não foi possível buscar as versões salvas.'); return; }
    setVersions((data ?? []) as unknown as Version[]);
  };

  const confirmRestore = () => {
    if (!pendingRestore) return;
    // Keep what is on screen now, so the restore itself can be undone.
    localStorage.setItem(SAFETY_KEY, JSON.stringify(snapshotOf(useStore.getState())));
    const current = snapshotOf(useStore.getState());
    useStore.getState().hydrateFromCloud(
      pendingRestore.join ? mergeSnapshots(current, pendingRestore.snap) : pendingRestore.snap,
    );
    if (pendingRestore.join) clearStash(pendingRestore.join);
    setPendingRestore(null);
    toast.success('Listas restauradas', {
      duration: 8000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          const raw = localStorage.getItem(SAFETY_KEY);
          if (raw) useStore.getState().hydrateFromCloud(JSON.parse(raw));
        },
      },
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { setPendingRestore(null); onClose(); } }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backup das listas</DialogTitle>
          <DialogDescription>
            Guarde uma cópia completa das listas, itens, orçamentos, observações e histórico de preços.
          </DialogDescription>
        </DialogHeader>

        {pendingRestore ? (
          <div className="space-y-3">
            <p className="text-sm">
              {pendingRestore.join ? 'Juntar' : 'Restaurar o'} {pendingRestore.label} com {pendingRestore.snap.lists.length} lista(s) e{' '}
              {countItems(pendingRestore.snap)} item(ns)?{' '}
              {pendingRestore.join ? 'Os itens serão juntados às listas atuais, sem apagar nada.' : 'As listas atuais serão substituídas.'}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPendingRestore(null)}>Cancelar</Button>
              <Button variant={pendingRestore.join ? 'default' : 'destructive'} onClick={confirmRestore}>
                {pendingRestore.join ? 'Juntar' : 'Substituir listas'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button className="w-full justify-start" variant="outline" onClick={download}>
              <Download className="h-4 w-4 mr-2" aria-hidden="true" /> Baixar backup
            </Button>
            {user && (
              <Button className="w-full justify-start" variant="outline" onClick={() => void downloadRecovery(user.id).then(() => toast.success('Cópia de recuperação gerada'))}>
                <Download className="h-4 w-4 mr-2" aria-hidden="true" /> Cópia de recuperação (inclui alterações pendentes)
              </Button>
            )}
            <Button className="w-full justify-start" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" /> Restaurar de um arquivo
            </Button>
            <input
              ref={fileRef} type="file" accept="application/json,.json" className="hidden"
              aria-label="Escolher arquivo de backup" onChange={e => onFile(e.target.files?.[0])}
            />

            {parked.map(p => (
              <div key={p.key} className="pt-2 border-t space-y-2">
                <p className="text-sm">{p.label}: {p.snap!.lists.length} lista(s), {countItems(p.snap!)} item(ns).</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadBackup(p.snap!, p.key)}>Baixar</Button>
                  <Button size="sm" onClick={() => setPendingRestore({ snap: p.snap!, label: p.label.toLowerCase(), join: p.key })}>
                    Juntar às minhas listas
                  </Button>
                </div>
              </div>
            ))}

            {user && (
              <div className="pt-2 border-t space-y-2">
                <Button className="w-full justify-start" variant="ghost" onClick={loadVersions} disabled={loadingVersions}>
                  <History className="h-4 w-4 mr-2" aria-hidden="true" />
                  {loadingVersions ? 'Buscando...' : 'Versões anteriores na nuvem'}
                </Button>
                {versions && versions.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">Nenhuma versão anterior ainda.</p>
                )}
                {versions?.map(v => (
                  <div key={v.id} className="flex items-center justify-between text-sm px-1">
                    <span>
                      {fmt(v.created_at)}
                      <span className="text-muted-foreground"> · {v.data.lists?.length ?? 0} lista(s), {countItems(v.data)} item(ns)</span>
                    </span>
                    <Button size="sm" variant="ghost"
                      onClick={() => setPendingRestore({ snap: v.data, label: `versão de ${fmt(v.created_at)}` })}>
                      Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
