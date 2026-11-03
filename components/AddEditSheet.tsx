import { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CATEGORIES, type ShoppingItem, type CategoryId } from '@/types/shopping';
import { useStore } from '@/store/useStore';
import { normalizeText } from '@/lib/text';
import { toast } from 'sonner';
import { parseMoneyBR, centsToInput, formatBRL } from '@/lib/money';
import {
  ITEM_UNITS, MAX_PRESENTATION, parseQuantityFor, formatNumberBR, quantityInput, lineResult, needsUnitReview,
  isItemUnit, type ItemUnit,
} from '@/lib/units';

interface Props {
  open: boolean;
  onClose: () => void;
  editItem?: ShoppingItem | null;
}

export function AddEditSheet({ open, onClose, editItem }: Props) {
  const { addItem, updateItem, getHistoryItems, getPriceHistory, findItemByName, mergeQuantity } = useStore();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<CategoryId | ''>('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState<ItemUnit>('un');
  const [presentation, setPresentation] = useState('');
  /** true while the price field holds a reused (estimated) price the user did not type. */
  const [priceEstimated, setPriceEstimated] = useState(false);
  const [error, setError] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [duplicate, setDuplicate] = useState<{ item: ShoppingItem; addAnother: boolean } | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const history = useMemo(() => (open ? getHistoryItems() : []), [open, getHistoryItems]);

  const review = editItem ? needsUnitReview(editItem) : false;
  const cleanPres = presentation.replace(/\s+/g, ' ').trim() || undefined;

  const lastPrice = useMemo(() => {
    if (!open || !name.trim()) return null;
    const entries = getPriceHistory(name, { unit, priceBasis: unit, presentation: cleanPres });
    const keys = Object.keys(entries).sort();
    if (!keys.length) return null;
    const latestKey = keys[keys.length - 1];
    const [y, m] = latestKey.split('-');
    return { cents: entries[latestKey], label: `${m}/${y}` };
  }, [open, name, getPriceHistory, unit, cleanPres]);

  const suggestions = useMemo(() => {
    if (!name.trim() || editItem) return [];
    const q = normalizeText(name);
    return history
      .filter(h => normalizeText(h.name).includes(q) && normalizeText(h.name) !== q)
      .slice(0, 6);
  }, [name, history, editItem]);

  useEffect(() => {
    if (editItem) {
      setName(editItem.name);
      const rev = needsUnitReview(editItem);
      const u: ItemUnit = isItemUnit(editItem.unit) ? editItem.unit : 'un';
      // an item under review starts empty: the old amount is shown, never converted by guess
      setQuantity(rev ? '' : quantityInput(editItem.quantity, u));
      setPrice(rev ? '' : centsToInput(editItem.priceCents));
      setCategory(editItem.category ?? '');
      setNote(editItem.note ?? '');
      setUnit(rev ? 'un' : u);
      setPresentation(editItem.presentation ?? '');
      setPriceEstimated(!rev && Boolean(editItem.priceEstimated));
    } else {
      setName('');
      setQuantity('1');
      setPrice('');
      setCategory('');
      setNote('');
      setUnit('un');
      setPresentation('');
      setPriceEstimated(false);
    }
    setError('');
    setDuplicate(null);
    setShowSuggestions(false);
    setSelectedIdx(-1);
  }, [editItem, open]);

  const applySuggestion = (s: typeof history[0]) => {
    setName(s.name);
    if (s.category && !category) setCategory(s.category);
    if (s.note && !note) setNote(s.note);
    setShowSuggestions(false);
    setSelectedIdx(-1);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (!suggestions.length || !showSuggestions) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      applySuggestion(suggestions[selectedIdx]);
    }
  };

  const parsedPrice = parseMoneyBR(price);
  const parsedQty = parseQuantityFor(quantity, unit);
  const currentCents = parsedPrice.ok ? parsedPrice.value : undefined;
  const live = parsedQty.ok && currentCents != null ? lineResult({ quantity: parsedQty.value, unit, priceBasis: unit, priceCents: currentCents }) : null;
  const subtotalCents = live?.ok ? live.cents : null;

  const buildData = () => ({
    name: name.trim(),
    quantity: parsedQty.ok ? parsedQty.value : 1,
    unit,
    presentation: cleanPres,
    packSize: undefined,
    packUnit: undefined,
    priceBasis: unit,
    priceCents: currentCents,
    priceEstimated: currentCents != null && priceEstimated ? true : undefined,
    controlPortion: undefined,
    // review ends when the user saves explicit un/kg values; an automatic conversion stays recorded
    unitMigration: editItem?.unitMigration?.status === 'converted' ? editItem.unitMigration : undefined,
    category: (category || undefined) as CategoryId | undefined,
    note: note.trim() || undefined,
  });

  const finishAdd = (addAnother: boolean) => {
    if (addAnother) {
      setName('');
      setQuantity('1');
      setPrice('');
      setPriceEstimated(false);
      setPresentation('');
      setNote('');
      setDuplicate(null);
    } else {
      onClose();
    }
  };

  const handleSave = (addAnother = false) => {
    if (!name.trim()) {
      setError('Nome é obrigatório');
      return;
    }

    if (!parsedQty.ok) {
      setError(parsedQty.error);
      return;
    }
    if (!parsedPrice.ok) {
      setError(parsedPrice.error);
      return;
    }

    const data = buildData();

    if (editItem) {
      updateItem(editItem.id, data);
      onClose();
      return;
    }

    const found = findItemByName(data.name);
    const existing = found && (found.unit ?? 'un') === unit && (found.presentation ?? '') === (cleanPres ?? '')
      && !needsUnitReview(found) ? found : undefined;
    if (existing && !duplicate) {
      setDuplicate({ item: existing, addAnother });
      return;
    }

    addItem(data);
    finishAdd(addAnother);
  };

  const handleMerge = () => {
    if (!duplicate) return;
    const data = buildData();
    mergeQuantity(duplicate.item.id, data.quantity, data.priceCents);
    toast.success(`Quantidade somada a "${duplicate.item.name}"`);
    const addAnother = duplicate.addAnother;
    setDuplicate(null);
    finishAdd(addAnother);
  };

  const handleAddAnyway = () => {
    if (!duplicate) return;
    const addAnother = duplicate.addAnother;
    addItem(buildData());
    setDuplicate(null);
    finishAdd(addAnother);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editItem ? 'Editar Item' : 'Novo Item'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 overflow-y-auto flex-1 min-h-0">
          <div className="relative">
            <Label htmlFor="name">Nome *</Label>
            <Input
              id="name"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); setDuplicate(null); setShowSuggestions(true); setSelectedIdx(-1); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={handleNameKeyDown}
              placeholder="Ex: Leite integral"
              className={error ? 'border-destructive animate-shake' : ''}
              autoFocus
              autoComplete="off"
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-md overflow-hidden"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); applySuggestion(s); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors
                      ${i === selectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 text-popover-foreground'}
                    `}
                  >
                    <span>{s.name}</span>
                    {s.category && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {CATEGORIES.find(c => c.id === s.category)?.emoji}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {review && editItem?.unitMigration && (
            <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm" role="note">
              <p className="font-medium text-foreground">Este produto precisa de revisão</p>
              <p className="text-muted-foreground mt-0.5">
                Valor anterior: {formatNumberBR(editItem.unitMigration.from.quantity)} {editItem.unitMigration.from.unit}
                {editItem.unitMigration.from.priceCents != null && ` a ${formatBRL(editItem.unitMigration.from.priceCents)} por ${editItem.unitMigration.from.priceBasis ?? editItem.unitMigration.from.unit}`}.
                {' '}Informe a quantidade em un. ou kg e, se quiser, a apresentação (ex.: Garrafa 2 L).
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="presentation">Apresentação (opcional)</Label>
            <Input id="presentation" value={presentation} maxLength={MAX_PRESENTATION}
              onChange={e => { setPresentation(e.target.value); setDuplicate(null); }}
              placeholder="Ex: Pacote 5 kg, Garrafa 2 L, 12 rolos" className="mt-1" autoComplete="off" />
            <p className="text-xs text-muted-foreground mt-1">Só descreve o produto. Não entra nas contas.</p>
          </div>

          <div>
            <Label>Unidade</Label>
            <div className="flex gap-1.5 mt-1.5" role="radiogroup" aria-label="Unidade">
              {ITEM_UNITS.map(u => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={unit === u}
                  onClick={() => { setUnit(u); setError(''); }}
                  className={`min-h-10 flex-1 text-sm px-4 rounded-full border transition-colors
                    ${unit === u ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary'}`}
                >
                  {u === 'un' ? 'un.' : 'kg'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="qty">Quantidade ({unit === 'un' ? 'un.' : 'kg'})</Label>
              <Input
                id="qty"
                type="text"
                inputMode={unit === 'kg' ? 'decimal' : 'numeric'}
                placeholder={unit === 'kg' ? '1,750' : '1'}
                aria-invalid={!parsedQty.ok}
                value={quantity}
                onFocus={e => e.target.select()}
                onBlur={() => { if (!quantity.trim() && !review) setQuantity('1'); }}
                onChange={e => { setQuantity(e.target.value); setError(''); }}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="price">{unit === 'un' ? 'Preço por unidade' : 'Preço por kg'}</Label>
              <Input
                id="price"
                type="text"
                inputMode="decimal"
                value={price}
                aria-invalid={!parsedPrice.ok}
                onChange={e => { setPrice(e.target.value); setPriceEstimated(false); setError(''); }}
                placeholder="0,00"
              />
              {priceEstimated && currentCents != null && (
                <p className="text-xs text-muted-foreground mt-1">Preço estimado (reaproveitado). Confirme ao concluir a compra.</p>
              )}
              {lastPrice != null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Último preço por {unit === 'un' ? 'unidade' : 'kg'} ({lastPrice.label}): {formatBRL(lastPrice.cents)}
                  {currentCents == null && (
                    <button
                      type="button"
                      className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => { setPrice(centsToInput(lastPrice.cents)); setPriceEstimated(true); }}
                    >
                      Usar como estimativa
                    </button>
                  )}
                  {currentCents != null && currentCents > lastPrice.cents && (
                    <span className="text-destructive"> ▲</span>
                  )}
                  {currentCents != null && currentCents < lastPrice.cents && (
                    <span className="text-success"> ▼</span>
                  )}
                </p>
              )}
            </div>
          </div>
          {subtotalCents != null && (
            <p className="text-sm text-foreground num" aria-live="polite">Subtotal: <span className="font-semibold">{formatBRL(subtotalCents)}</span></p>
          )}

          <div>
            <Label>Categoria</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(category === c.id ? '' : c.id)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors
                    ${category === c.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary'
                    }
                  `}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="note">Observação</Label>
            <Textarea
              id="note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex: sem lactose, marca X..."
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        {duplicate ? (
          <div className="shrink-0 pt-3 space-y-2 border-t">
            <p className="text-sm text-foreground">
              "{duplicate.item.name}" já está na lista ({formatNumberBR(duplicate.item.quantity)} {duplicate.item.unit === 'kg' ? 'kg' : 'un.'}).
            </p>
            <div className="flex gap-2">
              <Button onClick={handleMerge} className="flex-1">Somar quantidade</Button>
              <Button variant="outline" onClick={handleAddAnyway}>Adicionar mesmo assim</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-3 shrink-0">
            <Button onClick={() => handleSave(false)} className="flex-1">
              {editItem ? 'Salvar' : 'Adicionar'}
            </Button>
            {!editItem && (
              <Button variant="outline" onClick={() => handleSave(true)}>
                Salvar + Outro
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
