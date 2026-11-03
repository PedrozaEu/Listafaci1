import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { ShoppingList } from '@/types/shopping';
import type { NextListOptions } from '@/lib/route';
import { formatBRL } from '@/lib/money';

interface Props {
  source: ShoppingList | undefined;
  open: boolean;
  onClose: () => void;
  onConfirm: (opts: NextListOptions) => void;
}

export function NextPurchaseDialog({ source, open, onClose, onConfirm }: Props) {
  const [name, setName] = useState('');
  const [invert, setInvert] = useState(false);
  const [keepBudget, setKeepBudget] = useState(true);
  const [usePrices, setUsePrices] = useState(true);

  useEffect(() => {
    if (open && source) {
      setName(`${source.name} (próxima)`);
      setInvert(false);
      setKeepBudget(source.budgetCents != null);
      setUsePrices(true);
    }
  }, [open, source]);

  if (!source) return null;
  const pricedCount = source.items.filter(i => i.priceCents != null).length;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar próxima compra</DialogTitle>
          <DialogDescription>
            Uma nova lista com os {source.items.length} itens de "{source.name}", todos pendentes. A lista original não muda e ninguém é adicionado automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="next-name">Nome da nova lista</Label>
            <Input id="next-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          </div>
          <RadioGroup value={invert ? 'invert' : 'keep'} onValueChange={v => setInvert(v === 'invert')} aria-label="Roteiro">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="keep" id="r-keep" />
              <Label htmlFor="r-keep" className="font-normal">Manter roteiro como está</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="invert" id="r-invert" />
              <Label htmlFor="r-invert" className="font-normal">Inverter roteiro</Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Checkbox id="c-budget" checked={keepBudget} disabled={source.budgetCents == null} onCheckedChange={v => setKeepBudget(v === true)} />
            <Label htmlFor="c-budget" className="font-normal">
              Reaproveitar orçamento{source.budgetCents != null ? ` (${formatBRL(source.budgetCents)})` : ' (lista sem orçamento)'}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="c-prices" checked={usePrices} onCheckedChange={v => setUsePrices(v === true)} />
            <Label htmlFor="c-prices" className="font-normal">
              Usar preços anteriores como estimativa ({pricedCount} com preço)
            </Label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm({ name, invert, keepBudget, usePrices })}>Criar lista</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
