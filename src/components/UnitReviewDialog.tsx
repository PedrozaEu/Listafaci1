import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ShoppingItem } from '@/types/shopping';
import { formatNumberBR } from '@/lib/units';

interface Props {
  open: boolean;
  items: ShoppingItem[];
  onClose: () => void;
  onReview: (item: ShoppingItem) => void;
}

/** Legacy items whose old unit cannot be converted safely (L, mL, packages priced by content, unknown). */
export function UnitReviewDialog({ open, items, onClose, onReview }: Props) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Alguns produtos precisam de revisão</DialogTitle>
          <DialogDescription>
            Agora o app usa só un. e kg. Estes produtos estavam em outra unidade e não foram convertidos para não mudar o que você comprou. O restante da lista funciona normalmente.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 overflow-y-auto flex-1 min-h-0">
          {items.map(i => (
            <li key={i.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground break-words">{i.name}</p>
                <p className="text-xs text-muted-foreground">
                  Quantidade anterior: {formatNumberBR(i.unitMigration!.from.quantity)} · Unidade anterior: {i.unitMigration!.from.unit}
                </p>
              </div>
              <Button size="sm" onClick={() => onReview(i)}>Revisar</Button>
            </li>
          ))}
          {!items.length && <li className="text-sm text-muted-foreground">Nenhum produto aguardando revisão.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
