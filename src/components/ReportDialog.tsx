import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import type { jsPDF } from 'jspdf';
import { useStore } from '@/store/useStore';
import type { ShoppingList } from '@/types/shopping';
import { buildReportModel, formatDateBR, linesFromCart, linesFromPurchase } from '@/lib/report';
import { todayISO } from '@/lib/purchase';
import {
  COLUMN_LABEL, COLUMN_ORDER, DEFAULT_COLUMNS, PRESETS, loadReportConfig, matchingPreset, needsLandscape,
  normalizeColumns, presetColumns, saveReportConfig, selectedCount, type ColumnId, type Orientation,
} from '@/lib/reportConfig';

interface Props {
  list: ShoppingList | undefined;
  open: boolean;
  onClose: () => void;
}

const CART = 'cart';
const LONG_PAGES = 4;

export function ReportDialog({ list, open, onClose }: Props) {
  const purchases = useStore(s => s.purchases);
  const sorted = useMemo(
    () => [...purchases].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn) || b.completedAt - a.completedAt),
    [purchases],
  );
  const cartCount = list?.items.filter(i => i.purchased).length ?? 0;
  const [source, setSource] = useState<string>(CART);
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  /** null = not chosen yet; asked only when the columns do not fit in portrait. */
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const [saved, setSaved] = useState(() => loadReportConfig());
  const [doc, setDoc] = useState<jsPDF | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSource(sorted[0]?.id ?? CART);
      setColumns(DEFAULT_COLUMNS);
      setOrientation(null);
      setSaved(loadReportConfig());
      setDoc(null);
    }
  }, [open, sorted]);

  const purchase = sorted.find(x => x.id === source);
  const model = useMemo(() => {
    if (!open) return null;
    return purchase
      ? buildReportModel({ kind: 'purchase', listName: purchase.listName, purchaseDate: purchase.purchasedOn, issuedAt: new Date(), lines: linesFromPurchase(purchase) })
      : buildReportModel({ kind: 'cart', listName: list?.name ?? 'Lista', purchaseDate: todayISO(), issuedAt: new Date(), lines: list ? linesFromCart(list) : [] });
  }, [open, purchase, list]);
  /** Observação is offered only when the source really has notes. */
  const available = useMemo<ColumnId[]>(() => {
    const hasNote = model?.groups.some(g => g.rows.some(r => r.note)) ?? false;
    return COLUMN_ORDER.filter(c => c !== 'note' || hasNote);
  }, [model]);
  const cols = useMemo(() => normalizeColumns(columns, available), [columns, available]);
  const wide = needsLandscape(cols);
  const effOrientation: Orientation = orientation ?? 'portrait';
  const askOrientation = wide && orientation == null;
  const preset = matchingPreset(cols, available);

  // Live build: gives the page estimate and makes the buttons ready. Lists are never changed.
  useEffect(() => {
    setDoc(null);
    if (!model || !model.totals.products || askOrientation) return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const { buildReportPdf } = await import('@/lib/reportPdf');
        const d = buildReportPdf(model, { columns: cols, orientation: effOrientation });
        if (alive) setDoc(d);
      } catch {
        if (alive) toast.error('Não foi possível gerar o PDF.');
      } finally {
        if (alive) setBusy(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [model, cols, effOrientation, askOrientation]);

  const toggle = (c: ColumnId, on: boolean) =>
    setColumns(prev => normalizeColumns(on ? [...prev, c] : prev.filter(x => x !== c)));
  const remember = () => {
    const cfg = { columns: cols, orientation: wide ? effOrientation : undefined };
    saveReportConfig(cfg);
    setSaved(cfg);
  };
  const useSaved = () => {
    if (!saved) return;
    setColumns(saved.columns);
    setOrientation(saved.orientation ?? null);
  };
  const savedDiffers = saved && (saved.columns.join() !== cols.join() || (saved.orientation ?? null) !== orientation);

  const fileName = () => {
    const p = sorted.find(x => x.id === source);
    const base = p ? `${p.listName} ${p.purchasedOn}` : `${list?.name ?? 'Lista'} em andamento ${todayISO()}`;
    return `ListaFacil reposicao ${base}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  };

  const openPreview = () => {
    if (!doc) return;
    remember();
    const url = URL.createObjectURL(doc.output('blob'));
    const w = window.open(url, '_blank');
    if (!w) toast.error('O navegador bloqueou a nova aba. Use Salvar PDF.');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const printPdf = () => {
    if (!doc) return;
    remember();
    const url = URL.createObjectURL(doc.output('blob'));
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = url;
    frame.onload = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
      catch { window.open(url, '_blank'); }
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
    };
    document.body.appendChild(frame);
  };

  const pages = doc?.getNumberOfPages() ?? 0;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Relatório PDF de reposição</DialogTitle>
          <DialogDescription>Folha para imprimir e marcar o consumo do mês. Filtros da tela não são aplicados.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          <RadioGroup value={source} onValueChange={setSource} aria-label="Origem do relatório">
            {sorted.map(p => (
              <div key={p.id} className="flex items-start gap-2">
                <RadioGroupItem value={p.id} id={`src-${p.id}`} className="mt-0.5" />
                <Label htmlFor={`src-${p.id}`} className="font-normal leading-snug">
                  Compra concluída: {p.listName}, {formatDateBR(p.purchasedOn)} ({p.lines.length} itens)
                </Label>
              </div>
            ))}
            <div className="flex items-start gap-2">
              <RadioGroupItem value={CART} id="src-cart" className="mt-0.5" disabled={!cartCount} />
              <Label htmlFor="src-cart" className="font-normal leading-snug">
                Itens no carrinho agora ({cartCount}). Sai como "Compra em andamento, não conferida".
              </Label>
            </div>
          </RadioGroup>
          {!sorted.length && <p className="text-xs text-muted-foreground">Nenhuma compra concluída ainda.</p>}

          <section aria-labelledby="cfg-title" className="space-y-3 border-t pt-3">
            <h3 id="cfg-title" className="text-sm font-semibold">Configurar relatório</h3>
            {savedDiffers && (
              <Button variant="outline" size="sm" onClick={useSaved}>Usar última configuração</Button>
            )}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Configurações rápidas">
              {PRESETS.map(p => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={preset === p.id ? 'default' : 'outline'}
                  aria-pressed={preset === p.id}
                  onClick={() => setColumns(presetColumns(p.id, available))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <fieldset className="grid grid-cols-2 gap-x-3 gap-y-2">
              <legend className="sr-only">Colunas do relatório</legend>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked disabled aria-label="Produto (obrigatório)" />
                Produto (sempre)
              </label>
              {available.map(c => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={cols.includes(c)} onCheckedChange={v => toggle(c, v === true)} />
                  {COLUMN_LABEL[c]}
                </label>
              ))}
            </fieldset>
            <p className="text-sm font-medium" aria-live="polite">Colunas selecionadas: {selectedCount(cols)}</p>

            {wide && (
              <div className="rounded-md border p-3 text-sm space-y-2" role="status">
                <p>Este relatório ficará mais legível em modo paisagem.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={orientation === 'landscape' ? 'default' : 'outline'} aria-pressed={orientation === 'landscape'} onClick={() => setOrientation('landscape')}>Usar paisagem</Button>
                  <Button size="sm" variant={orientation === 'portrait' ? 'default' : 'outline'} aria-pressed={orientation === 'portrait'} onClick={() => setOrientation('portrait')}>Continuar em retrato</Button>
                </div>
              </div>
            )}

            <div className="rounded-md bg-muted p-3 text-sm" role="status" aria-live="polite">
              {!model?.totals.products ? 'Não há itens para o relatório.'
                : askOrientation ? 'Escolha retrato ou paisagem para continuar.'
                : busy || !doc ? 'Calculando páginas...'
                : <>Estimativa: aproximadamente {pages} {pages === 1 ? 'página' : 'páginas'} ({effOrientation === 'landscape' ? 'A4 paisagem' : 'A4 retrato'}).
                    {pages > LONG_PAGES && <span className="block mt-1 font-medium">Atenção: a impressão vai ocupar {pages} folhas.</span>}</>}
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 shrink-0 flex-wrap">
          <Button variant="outline" onClick={openPreview} disabled={!doc}>Abrir prévia</Button>
          <Button variant="outline" onClick={printPdf} disabled={!doc}>Imprimir</Button>
          <Button onClick={() => { if (doc) { remember(); doc.save(fileName()); } }} disabled={!doc}>Salvar PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
