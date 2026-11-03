import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import type { Op } from '@/lib/ops';
import { useState } from 'react';

const what: Record<Op['kind'], string> = {
  list_create: 'Criar lista', list_update: 'Alterar lista', list_archive: 'Excluir lista',
  item_create: 'Adicionar item', item_update: 'Editar item', item_delete: 'Excluir item', item_mark: 'Marcar item',
  reorder: 'Mudar a ordem', purchase_save: 'Concluir compra', list_leave: 'Sair da lista',
};

/** Conflicting operations stay in the outbox until the user decides; nothing is overwritten silently. */
export function OpReviewDialog({ ops, denied, deniedOps = [], onResolve, onExport }: {
  ops: Op[]; denied: number; deniedOps?: Op[];
  onResolve: (id: string, c: 'discard' | 'retry' | 'archive') => void; onExport?: () => void;
}) {
  const [later, setLater] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const lists = useStore(s => s.lists);
  const name = (o: Op) => String(o.payload.name ?? lists.flatMap(l => l.items).find(i => i.id === o.entityId)?.name ?? lists.find(l => l.id === o.listId)?.name ?? '');
  return (
    <Dialog open={!later && (ops.length > 0 || denied > 0)} onOpenChange={o => { if (!o) setLater(true); }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Alterações para revisar</DialogTitle>
          <DialogDescription>
            Estas alterações feitas neste aparelho não puderam ser aplicadas porque o item mudou em outro lugar.
            Escolha o que fazer com cada uma.
            {denied > 0 && ` ${denied} alteração(ões) foram recusadas e não serão reenviadas sozinhas. Nada foi apagado.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 max-h-[50vh] overflow-auto">
          {ops.map(o => (
            <li key={o.id} className="rounded-md border p-3 text-sm space-y-2">
              <p><span className="font-medium">{what[o.kind]}</span>{name(o) && `: ${name(o)}`}</p>
              <p className="text-muted-foreground">{o.error}</p>
              <div className="flex gap-2">
                <Button size="sm" className="min-h-11" onClick={() => onResolve(o.id, 'retry')} disabled={o.error === 'item excluído em outro lugar'}>
                  Manter a minha
                </Button>
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => onResolve(o.id, 'discard')}>Usar a da nuvem</Button>
              </div>
            </li>
          ))}
        </ul>
        {deniedOps.length > 0 && (
          <ul className="space-y-3 max-h-[40vh] overflow-auto">
            {deniedOps.map(o => {
              const own = o.kind === 'list_leave' && lists.find(l => l.id === o.listId)?.role === 'owner';
              return (
                <li key={o.id} className="rounded-md border p-3 text-sm space-y-2">
                  <p><span className="font-medium">{what[o.kind]}</span>{name(o) && `: ${name(o)}`} · recusada</p>
                  <p className="text-muted-foreground">
                    {own ? 'Você é o dono desta lista. Esta saída foi criada por um erro de classificação e não remove nada.' : 'O servidor recusou por falta de permissão nesta lista.'}
                  </p>
                  {confirmArchive === o.id ? (
                    <div className="space-y-2">
                      <p>Excluir a lista "{name(o)}"? Na nuvem ela fica arquivada, não apagada.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" className="min-h-11" onClick={() => { setConfirmArchive(null); onResolve(o.id, 'archive'); }}>Excluir minha lista</Button>
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => setConfirmArchive(null)}>Voltar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => onResolve(o.id, 'discard')}>{own ? 'Cancelar esta operação' : 'Descartar esta'}</Button>
                      {own && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmArchive(o.id)}>Quero excluir a lista</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {onExport && <Button variant="outline" className="min-h-11" onClick={onExport}>Baixar cópia de recuperação</Button>}
          <Button variant="ghost" className="min-h-11" onClick={() => setLater(true)}>Revisar depois</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
