import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { MigrationReport, StorageMode } from '@/hooks/useCloudSync';

interface Props {
  open: boolean;
  onClose: () => void;
  storage: StorageMode;
  report: MigrationReport | null;
  onMigrate: () => void;
  onRollback: () => void;
}

/** Storage upgrade with explicit confirmation and a before/after check. Collaboration is not offered here. */
export function StorageDialog({ open, onClose, storage, report, onMigrate, onRollback }: Props) {
  const running = report?.phase === 'running';
  return (
    <Dialog open={open} onOpenChange={o => !o && !running && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Armazenamento das listas</DialogTitle>
          <DialogDescription>
            {storage === 'relational'
              ? 'Suas listas já usam o novo armazenamento na nuvem.'
              : 'Atualize o armazenamento das listas desta conta. Os dados antigos continuam guardados e nada é apagado.'}
          </DialogDescription>
        </DialogHeader>

        {report?.before && (
          <p className="text-sm tabular-nums">
            {report.before.lists} listas, {report.before.items} itens ({report.before.checked} no carrinho), {report.before.purchases} compras concluídas.
          </p>
        )}
        {running && <p className="text-sm text-muted-foreground">Enviando parte {report.done} de {report.total}...</p>}
        {report?.phase === 'done' && <p className="text-sm text-primary">Conferência concluída: listas, itens, valores, ordem e marcações iguais antes e depois.</p>}
        {report?.phase === 'rolled_back' && <p className="text-sm">Voltou ao armazenamento anterior, com todas as alterações feitas até agora.</p>}
        {report?.phase === 'failed' && (
          <div className="text-sm text-destructive space-y-1" role="alert">
            <p>A atualização não foi ativada. Suas listas continuam como estavam.</p>
            {report.diffs?.map(d => <p key={d}>{d}</p>)}
            {report.message && <p>{report.message}</p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          {storage === 'legacy' && report?.phase !== 'done' && (
            <Button onClick={onMigrate} disabled={running} className="min-h-11">
              {report?.phase === 'failed' ? 'Tentar de novo' : 'Atualizar agora'}
            </Button>
          )}
          {storage === 'relational' && (
            <Button variant="outline" onClick={onRollback} className="min-h-11">Voltar ao armazenamento anterior</Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={running} className="min-h-11">Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
