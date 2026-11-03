import { Check, Pencil, Trash2, Minus, Plus, GripVertical } from 'lucide-react';
import { CATEGORIES, type ShoppingItem, type SortMode, canEditItems } from '@/types/shopping';
import { useStore } from '@/store/useStore';
import { initials } from '@/data/live';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatBRL, lineTotal } from '@/lib/money';
import { formatQty, basisLabel, basisShort, defaultBasis, needsUnitReview, formatNumberBR } from '@/lib/units';

interface Props {
  item: ShoppingItem;
  onEdit: (item: ShoppingItem) => void;
  sortMode: SortMode;
  shoppingMode?: boolean;
}

const touch = 'h-11 w-11 inline-flex items-center justify-center rounded-md transition-colors';

export function ItemCard({ item, onEdit, sortMode, shoppingMode = false }: Props) {
  // authorship only matters when the list has more than one participant
  const members = useStore(s => s.lists.find(l => l.id === s.activeListId)?.members);
  const canEdit = canEditItems(useStore(s => s.lists.find(l => l.id === s.activeListId)?.role));
  const who = (id?: string) => members?.find(m => m.userId === id)?.name;
  const shared = !!members && members.length > 1;
  // the check shows who marked it (server markedBy); old marks without author stay neutral
  const marker = shared && item.purchased ? members.find(m => m.userId === item.markedBy) : undefined;
  const author = shared && who(item.addedBy) ? `adicionado por ${who(item.addedBy)}` : '';
  const { togglePurchased, deleteItem, updateItem } = useStore();
  const category = CATEGORIES.find(c => c.id === item.category);
  const reduceMotion = useReducedMotion();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: sortMode !== 'custom' || !canEdit });

  const style = { transform: CSS.Transform.toString(transform), transition };

  const handleDelete = () => {
    const snapshot = { ...item };
    const listId = useStore.getState().activeListId;
    deleteItem(item.id);
    toast('Item removido', {
      action: {
        label: 'Desfazer',
        onClick: () => {
          if (!listId || !useStore.getState().restoreItem(listId, snapshot)) {
            toast.error('A lista deste item foi excluída. Não foi possível restaurar.');
          }
        },
      },
      duration: 4000,
    });
  };

  const subtotal = lineTotal(item);
  const review = needsUnitReview(item);
  const basis = item.priceBasis ?? defaultBasis(item.unit ?? 'un');
  const anim = shoppingMode || reduceMotion
    ? {}
    : {
        layout: true as const,
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        transition: { duration: 0.18 },
      };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...anim}
      className={`relative overflow-hidden rounded-lg border bg-card shadow-card
        ${item.purchased ? 'bg-muted/40' : ''}
        ${isDragging ? 'z-50 shadow-lg' : ''}
      `}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${category?.bar ?? 'bg-border'}`} aria-hidden="true" />
      <div className={`flex items-start gap-1 pl-2 ${shoppingMode ? 'p-2.5' : 'p-1.5'}`}>
        {sortMode === 'custom' && !shoppingMode && (
          <button
            {...attributes}
            {...listeners}
            aria-label={`Reordenar ${item.name}`}
            className={`${touch} cursor-grab active:cursor-grabbing touch-none text-muted-foreground`}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <button
          role="checkbox"
          aria-checked={item.purchased}
          aria-label={item.purchased ? `Tirar ${item.name} do carrinho${marker ? `, marcado por ${marker.name}` : ''}` : `Colocar ${item.name} no carrinho`}
          onClick={() => togglePurchased(item.id)}
          className={`${touch} flex-shrink-0`}
        >
          <span
            className={`rounded-md border-2 flex items-center justify-center transition-colors duration-150
              ${shoppingMode ? 'h-7 w-7' : 'h-6 w-6'}
              ${item.purchased ? (marker ? '' : 'bg-teal border-teal') : 'border-input bg-card'}`}
            style={marker ? { backgroundColor: marker.color, borderColor: marker.color } : undefined}
          >
            {item.purchased && <Check className={`h-4 w-4 ${marker ? 'text-primary-foreground' : 'text-teal-foreground'}`} aria-hidden="true" />}
          </span>
        </button>

        <div className="flex-1 min-w-0 py-2">
          <p className={`font-medium break-words ${shoppingMode ? 'text-lg leading-snug' : 'text-[15px] leading-snug'} ${item.purchased ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {item.name}
          </p>
          {item.presentation && (
            <p className={`text-muted-foreground break-words ${shoppingMode ? 'text-sm' : 'text-xs'}`}>{item.presentation}</p>
          )}
          {review && (
            <button type="button" onClick={() => canEdit && onEdit(item)} disabled={!canEdit}
              className="mt-1 inline-flex min-h-8 items-center rounded-full border border-warning bg-warning/10 px-2.5 text-xs font-medium text-foreground">
              Revisar unidade · antes: {formatNumberBR(item.unitMigration!.from.quantity)} {item.unitMigration!.from.unit}
            </button>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{category?.label ?? 'Sem categoria'}</span>
            {item.purchased && !marker && <span className="font-medium text-teal">No carrinho</span>}
            {marker && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <span aria-hidden="true" style={{ backgroundColor: marker.color }}
                  className="h-4 w-4 rounded-full text-[8px] font-bold text-primary-foreground inline-flex items-center justify-center">{initials(marker.name)}</span>
                Marcado por {marker.name}
              </span>
            )}
          </div>
          {author && (
            <p className="text-muted-foreground mt-0.5 text-xs">{author}</p>
          )}
          {item.note && (
            <p className={`text-muted-foreground mt-1 break-words ${shoppingMode ? 'text-sm' : 'text-xs'}`}>{item.note}</p>
          )}

          <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
            {(item.unit ?? 'un') !== 'un' || review ? (
              <button
                onClick={() => canEdit && onEdit(item)}
                disabled={!canEdit}
                aria-label={`Quantidade de ${item.name}: ${formatQty(item)}. Editar`}
                className={`min-h-11 rounded-md border bg-background px-3 font-semibold num ${shoppingMode ? 'text-lg' : 'text-sm'}`}
              >
                {formatQty(item)}
              </button>
            ) : (
            <div className="flex items-center rounded-md border bg-background" role="group" aria-label={`Quantidade de ${item.name}`}>
              <button
                aria-label={`Diminuir quantidade de ${item.name}`}
                disabled={!canEdit || item.quantity <= 1}
                onClick={() => item.quantity > 1 && updateItem(item.id, { quantity: item.quantity - 1 })}
                className={`${touch} text-muted-foreground hover:bg-accent`}
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className={`min-w-8 text-center font-semibold num ${shoppingMode ? 'text-lg' : 'text-sm'}`} aria-live="polite">
                {item.quantity}<span className="text-xs font-normal text-muted-foreground ml-1">un.</span>
              </span>
              <button
                aria-label={`Aumentar quantidade de ${item.name}`}
                disabled={!canEdit}
                onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}
                className={`${touch} text-muted-foreground hover:bg-accent`}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            )}

            {item.priceCents != null && subtotal != null ? (
              <button
                onClick={() => canEdit && onEdit(item)}
                disabled={!canEdit}
                aria-label={`Preço de ${item.name}: ${formatBRL(item.priceCents)} por ${basisLabel[basis]}${item.priceEstimated ? ' (estimado)' : ''}, subtotal estimado ${formatBRL(subtotal)}. Editar`}
                className="ml-auto min-h-11 text-right rounded-md px-2 hover:bg-accent"
              >
                <span className={`block font-semibold num text-foreground ${shoppingMode ? 'text-base' : 'text-sm'}`}>{formatBRL(subtotal)}</span>
                <span className="block text-xs text-muted-foreground num">{formatBRL(item.priceCents)}/{basisShort[basis]}{item.priceEstimated ? ' · estimado' : ''}</span>
              </button>
            ) : (
              <button
                onClick={() => canEdit && onEdit(item)}
                disabled={!canEdit}
                className={`ml-auto min-h-11 rounded-md px-2 text-sm font-medium hover:bg-accent ${item.priceCents != null ? 'text-destructive' : 'text-primary'}`}
              >
                {item.priceCents != null ? 'Unidade do preço incompatível' : 'Informar preço'}
              </button>
            )}
          </div>
        </div>

        {canEdit && <div className="flex flex-col">
          <button aria-label={`Editar ${item.name}`} onClick={() => canEdit && onEdit(item)}
                disabled={!canEdit} className={`${touch} text-muted-foreground hover:bg-accent`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button aria-label={`Excluir ${item.name}`} onClick={handleDelete} className={`${touch} text-destructive hover:bg-destructive/10`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>}
      </div>
    </motion.div>
  );
}
