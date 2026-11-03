import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import type { ShoppingList } from '@/types/shopping';
import { useStore } from '@/store/useStore';
import { buildPurchaseRecord, todayISO } from '@/lib/purchase';
import { formatBRL } from '@/lib/money';
import { formatQty, basisShort } from '@/lib/units';

interface Props {
  list: ShoppingList | undefined;
  open: boolean;
  onClose: () => void;
}

export function CompletePurchaseDialog({ list, open, onClose }: Props) {
  const completePurchase = useStore(s => s.completePurchase);
  const [date, setDate] = useState(todayISO());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<'keep' | 'move'>('keep');
  const [bought, setBought] = useState<'keep' | 'remove'>('keep');
  const [busy, setBusy] = useState(false);
  // One id per opening: repeated taps hit the same id and the store refuses duplicates.
  const recordId = useRef('');

  useEffect(() => {
    if (open) {
      recordId.current = crypto.randomUUID();
      setDate(todayISO());
      setConfirmed(new Set());
      setPending('keep');
      setBought('keep');
      setBusy(false);
    }
  }, [open]);

  const preview = useMemo(
    () => (list ? buildPurchaseRecord(list, { id: 'preview', purchasedOn: date, now: 0, confirmedIds: confirmed }) : null),
    [list, date, confirmed],
  );
  if (!list || !preview) return null;

  const pendingCount = list.items.filter(i => !i.purchased).length;
  const estimatedIds = preview.lines.filter(l => l.priceStatus === 'estimated').map(l => l.itemId);
  const toggle = (id: string, on: boolean) =>
    setConfirmed(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  const submit = () => {
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error('Informe a data da compra.'); return; }
    setBusy(true);
    const r = completePurchase(list.id, { id: recordId.current, purchasedOn: date, now: Date.now(), confirmedIds: confirmed }, pending, undefined, bought);
    if (r.status === 'ok') {
      toast.success('Compra concluída e guardada no histórico', {
        description: r.record.complete
          ? `Total pago: ${formatBRL(r.record.confirmedCents)}`
          : 'Total parcial: há itens sem preço ou com preço estimado.',
      });
      onClose();
    } else if (r.status === 'duplicate') {
      onClose();
    } else {
      toast.error(r.status === 'empty' ? 'Nenhum item no carrinho para concluir.' : 'Lista não encontrada.');
      setBusy(false);
    }
  };

  const statusText = (s: string) =>
    s === 'estimated' ? 'estimado' : s === 'missing' ? 'sem preço' : s === 'incompatible' ? 'unidade incompatível' : '';

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Concluir compra</DialogTitle>
          <DialogDescription>
            Revise os {preview.lines.length} itens no carrinho. A compra fica guardada no histórico, sem mudar depois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-1.5">
            <Label htmlFor="purchase-date">Data da compra</Label>
            <Input id="purchase-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <ul className="divide-y rounded-md border" aria-label="Itens comprados">
            {preview.lines.map(l => (
              <li key={l.itemId} className="flex items-start gap-2 p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium break-words">{l.name}</p>
                  <p className="text-xs text-muted-foreground num">
                    {formatQty(l)}
                    {l.priceCents != null && ` · ${formatBRL(l.priceCents)}/${basisShort[l.priceBasis]}`}
                  </p>
                  {(l.priceStatus === 'estimated' || confirmed.has(l.itemId)) && (
                    <label className="mt-1 flex items-center gap-2 text-xs">
                      <Checkbox checked={confirmed.has(l.itemId)} onCheckedChange={v => toggle(l.itemId, v === true)} />
                      Confirmo o preço reaproveitado
                    </label>
                  )}
                </div>
                <div className="text-right">
                  <span className="block font-semibold num">{l.lineCents != null ? formatBRL(l.lineCents) : '—'}</span>
                  {statusText(l.priceStatus) && (
                    <span className={`block text-xs ${l.priceStatus === 'estimated' ? 'text-muted-foreground' : 'text-destructive'}`}>
                      {statusText(l.priceStatus)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {estimatedIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setConfirmed(new Set([...confirmed, ...estimatedIds]))}>
              Confirmar todos os preços estimados ({estimatedIds.length})
            </Button>
          )}

          <div className="rounded-md bg-muted p-3 text-sm space-y-1" role="status">
            {preview.complete ? (
              <p>Total pago: <strong className="num">{formatBRL(preview.confirmedCents)}</strong></p>
            ) : (
              <>
                <p>Total parcial confirmado: <strong className="num">{formatBRL(preview.confirmedCents)}</strong></p>
                {preview.estimatedCount > 0 && (
                  <p className="text-muted-foreground">+ {formatBRL(preview.estimatedCents)} estimados ({preview.estimatedCount} itens)</p>
                )}
                {preview.missingCount > 0 && (
                  <p className="text-muted-foreground">{preview.missingCount} {preview.missingCount === 1 ? 'item sem valor' : 'itens sem valor'} não somados</p>
                )}
                <p className="text-xs text-muted-foreground">Este não é o valor pago completo.</p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Itens comprados</p>
            <RadioGroup value={bought} onValueChange={v => setBought(v as 'keep' | 'remove')}>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="keep" id="b-keep" className="mt-0.5" />
                <Label htmlFor="b-keep" className="font-normal">Manter na lista, desmarcados, como guia para a próxima compra</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="remove" id="b-remove" />
                <Label htmlFor="b-remove" className="font-normal">Tirar da lista</Label>
              </div>
            </RadioGroup>
          </div>

          {pendingCount > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{pendingCount} {pendingCount === 1 ? 'item pendente' : 'itens pendentes'} (não entram na compra)</p>
              <RadioGroup value={pending} onValueChange={v => setPending(v as 'keep' | 'move')}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="keep" id="p-keep" />
                  <Label htmlFor="p-keep" className="font-normal">Manter nesta lista</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="move" id="p-move" />
                  <Label htmlFor="p-move" className="font-normal">Mover para uma nova lista</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !preview.lines.length}>Concluir compra</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
