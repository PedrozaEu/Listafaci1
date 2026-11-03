import { ShoppingCart, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  /** Omitted when the person cannot add items to this list. */
  onAdd?: () => void;
}

export function EmptyState({ onAdd }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card py-12 px-6 text-center">
      <ShoppingCart className="h-8 w-8 text-muted-foreground mb-3" aria-hidden="true" />
      <h2 className="text-base font-semibold text-foreground mb-1">Lista vazia</h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-[260px]">
        {onAdd ? 'Adicione o primeiro produto para começar o roteiro de compras.' : 'Ainda não há produtos nesta lista.'}
      </p>
      {onAdd && (
        <Button onClick={onAdd} className="min-h-11">
          <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar item
        </Button>
      )}
    </div>
  );
}
