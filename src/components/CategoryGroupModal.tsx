import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CATEGORIES, type ShoppingItem } from '@/types/shopping';
import { formatBRL, lineTotal, totalsOf } from '@/lib/money';

interface Props {
  open: boolean;
  onClose: () => void;
  items: ShoppingItem[];
}

export function CategoryGroupModal({ open, onClose, items }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items) {
      const cat = item.category ?? 'outros';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }

    return CATEGORIES
      .filter(c => map.has(c.id))
      .map(c => ({
        ...c,
        items: map.get(c.id)!,
        total: totalsOf(map.get(c.id)!).cents,
      }));
  }, [items]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Itens por categoria</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.id} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {g.emoji} {g.label}
                </span>
                {g.total > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatBRL(g.total)}
                  </span>
                )}
              </div>
              <div className="space-y-1 pl-2 border-l-2 border-muted">
                {g.items.map(item => {
                  const sub = lineTotal(item) ?? 0;
                  return (
                    <div key={item.id} className="flex items-center justify-between text-xs">
                      <span className={`text-foreground ${item.purchased ? 'line-through text-muted-foreground' : ''}`}>
                        {item.purchased ? '✅' : '☐'} {item.name}
                        <span className="text-muted-foreground ml-1">×{item.quantity}</span>
                      </span>
                      {item.priceCents != null ? (
                        <span className="text-muted-foreground whitespace-nowrap">
                          {formatBRL(item.priceCents)} → {formatBRL(sub)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {grandTotal > 0 && (
            <div className="flex items-center justify-between pt-2 border-t text-sm font-bold text-foreground">
              <span>Total</span>
              <span className="text-primary">{formatBRL(grandTotal)}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
