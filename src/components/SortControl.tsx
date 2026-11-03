import type { SortMode } from '@/types/shopping';
import { useStore, useActiveSortMode } from '@/store/useStore';
import { ArrowDownUp, CopyPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const modes: { value: SortMode; label: string }[] = [
  { value: 'custom', label: 'Roteiro' },
  { value: 'category', label: 'Por categoria' },
  { value: 'alpha', label: 'A a Z' },
  { value: 'created', label: 'Recentes' },
];

interface Props {
  onInvert: () => void;
  onNextPurchase: () => void;
}

export function SortControl({ onInvert, onNextPurchase }: Props) {
  const setSortMode = useStore(s => s.setSortMode);
  const sortMode = useActiveSortMode();

  return (
    <div className="space-y-2">
      <div className="flex rounded-lg border bg-muted p-1" role="radiogroup" aria-label="Ordenar itens">
        {modes.map(m => (
          <button
            key={m.value}
            role="radio"
            aria-checked={sortMode === m.value}
            onClick={() => setSortMode(m.value)}
            className={`flex-1 min-h-10 text-xs sm:text-sm font-medium px-2 rounded-md transition-colors duration-150
              ${sortMode === m.value
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
              }
            `}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="flex-1 min-w-fit min-h-10" onClick={onInvert}>
          <ArrowDownUp className="h-4 w-4 mr-1.5" aria-hidden="true" /> Inverter lista
        </Button>
        <Button variant="outline" size="sm" className="flex-1 min-w-fit min-h-10" onClick={onNextPurchase}>
          <CopyPlus className="h-4 w-4 mr-1.5" aria-hidden="true" /> Criar próxima compra
        </Button>
      </div>
    </div>
  );
}
