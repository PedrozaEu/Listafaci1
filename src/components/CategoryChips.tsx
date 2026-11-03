import { CATEGORIES } from '@/types/shopping';
import { useStore } from '@/store/useStore';

const chip = (active: boolean) =>
  `flex-shrink-0 inline-flex items-center gap-1.5 min-h-10 text-sm px-3.5 rounded-full border transition-colors whitespace-nowrap
  ${active
    ? 'bg-foreground text-background border-foreground'
    : 'bg-card text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground'}`;

export function CategoryChips() {
  const { categoryFilter, setCategoryFilter } = useStore();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide" role="group" aria-label="Filtrar por categoria">
      <button aria-pressed={categoryFilter === null} onClick={() => setCategoryFilter(null)} className={chip(categoryFilter === null)}>
        Todas
      </button>
      {CATEGORIES.map(c => (
        <button
          key={c.id}
          aria-pressed={categoryFilter === c.id}
          onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
          className={chip(categoryFilter === c.id)}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${c.bar}`} aria-hidden="true" />
          {c.label}
        </button>
      ))}
    </div>
  );
}
