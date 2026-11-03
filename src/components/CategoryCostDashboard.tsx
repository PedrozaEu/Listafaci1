import { useMemo } from 'react';
import { CATEGORIES, type ShoppingItem } from '@/types/shopping';
import { Progress } from '@/components/ui/progress';
import { formatBRL, lineTotal } from '@/lib/money';

interface Props {
  items: ShoppingItem[];
}

export function CategoryCostDashboard({ items }: Props) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;

    for (const item of items) {
      const sub = lineTotal(item) ?? 0;
      if (sub <= 0) continue;
      total += sub;
      const cat = item.category ?? 'outros';
      map.set(cat, (map.get(cat) ?? 0) + sub);
    }

    if (total === 0) return null;

    const rows = CATEGORIES
      .filter(c => map.has(c.id))
      .map(c => ({
        ...c,
        cost: map.get(c.id)!,
        pct: (map.get(c.id)! / total) * 100,
      }))
      .sort((a, b) => b.cost - a.cost);

    return { rows, total };
  }, [items]);

  if (!data) return null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Custo por categoria</h3>
        <span className="text-sm font-bold text-primary">
          {formatBRL(data.total)}
        </span>
      </div>

      <div className="space-y-2">
        {data.rows.map(row => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {row.emoji} {row.label}
              </span>
              <span className="font-medium text-foreground">
                {formatBRL(row.cost)}
                <span className="text-muted-foreground ml-1">({row.pct.toFixed(0)}%)</span>
              </span>
            </div>
            <Progress value={row.pct} className="h-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}
