import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore, useActiveSortMode } from '@/store/useStore';
import { NextPurchaseDialog } from '@/components/NextPurchaseDialog';
import { routeSequence, compareRoute } from '@/lib/route';
import { AppHeader } from '@/components/AppHeader';
import { ItemCard } from '@/components/ItemCard';
import { LiveBadge } from '@/components/LiveBadge';
import { AddEditSheet } from '@/components/AddEditSheet';
import { UnitReviewDialog } from '@/components/UnitReviewDialog';
import { needsUnitReview } from '@/lib/units';
import { CategoryChips } from '@/components/CategoryChips';
import { SortControl } from '@/components/SortControl';
import { EmptyState } from '@/components/EmptyState';
import { Fab } from '@/components/Fab';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, AlertTriangle, CheckCheck } from 'lucide-react';
import { CompletePurchaseDialog } from '@/components/CompletePurchaseDialog';
import { ReportDialog } from '@/components/ReportDialog';
import { BackupDialog } from '@/components/BackupDialog';
import { SyncDecisionDialog } from '@/components/SyncDecisionDialog';
import { SyncConflictDialog } from '@/components/SyncConflictDialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CATEGORIES, type ShoppingItem, canEditItems } from '@/types/shopping';
import type { ExportScope } from '@/lib/export';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CategoryCostDashboard } from '@/components/CategoryCostDashboard';
import { CategoryGroupModal } from '@/components/CategoryGroupModal';
import { buildTxtExport, buildWhatsAppText } from '@/lib/export';
import { normalizeText } from '@/lib/text';
import { formatBRL, totalsOf } from '@/lib/money';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useCloudSync, RELATIONAL_RELEASE } from '@/hooks/useCloudSync';
import { StorageDialog } from '@/components/StorageDialog';
import { OpReviewDialog } from '@/components/OpReviewDialog';
import { downloadRecovery } from '@/lib/recovery';
import { ShareDialog } from '@/components/ShareDialog';
import { PENDING_INVITE_KEY, OPEN_LIST_KEY, readOpenTarget } from '@/pages/Invite';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';

export default function Index() {
  const {
    lists, activeListId, searchQuery, categoryFilter,
    darkMode, shoppingMode, setDarkModeFromSystem, resetAll, reorderItems,
    invertActiveList, undoInversion, createNextList, setSearchQuery, setCategoryFilter,
  } = useStore();
  const sortMode = useActiveSortMode();
  const [hideChecked, setHideChecked] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<ShoppingItem | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [purchasedOpen, setPurchasedOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  useWakeLock(shoppingMode);
  const {
    status: syncStatus, decision, resolveDecision, conflict, resolveConflict, ready,
    storage, migration, migrate, rollback, notice, clearNotice, opStatus, resolveOp, prepareShare, refreshNow, live, online,
  } = useCloudSync();
  const [storageOpen, setStorageOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  // invite links: back to the invite after signing in; open the accepted list once it is loaded
  useEffect(() => {
    if (user && sessionStorage.getItem(PENDING_INVITE_KEY)) navigate('/convite', { replace: true });
  }, [user, navigate]);
  const refreshedFor = useRef<string | null>(null);
  const listIdsKey = lists.map(l => l.id).join(',');
  useEffect(() => {
    if (!ready || !user) return;
    const target = readOpenTarget(user.id); // bound to this account; another session's destination is ignored
    if (!target) return;
    if (storage !== 'relational') {
      toast('Vínculo confirmado. Preparando suas listas...');
      setStorageOpen(true);
      return;
    }
    if (lists.some(l => l.id === target)) { useStore.getState().setActiveList(target); localStorage.removeItem(OPEN_LIST_KEY); }
    else if (refreshedFor.current !== target) { refreshedFor.current = target; toast('Carregando a lista compartilhada...'); void refreshNow(); }
    // reacts to the wanted id becoming available, not to the list count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, storage, listIdsKey]);
  useEffect(() => { if (notice) { toast.error(notice); clearNotice(); } }, [notice, clearNotice]);


  // Dark mode: follow the OS until the user toggles it manually.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDarkModeFromSystem(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDarkModeFromSystem(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setDarkModeFromSystem]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const list = lists.find(l => l.id === activeListId);
  const canEdit = canEditItems(list?.role);
  const toReview = canEdit ? (list?.items ?? []).filter(needsUnitReview) : [];
  const sharedOwner = list?.role && list.role !== 'owner' ? list.members?.find(m => m.role === 'owner')?.name : undefined;
  const allItems = useMemo(() => list?.items ?? [], [list]);

  // Filter (accent-insensitive search)
  const filtered = useMemo(() => {
    let items = allItems;
    if (categoryFilter) items = items.filter(i => i.category === categoryFilter);
    const q = normalizeText(searchQuery);
    if (q) {
      items = items.filter(i =>
        normalizeText(i.name).includes(q) || normalizeText(i.note ?? '').includes(q),
      );
    }
    return items;
  }, [allItems, categoryFilter, searchQuery]);

  // Route views (Roteiro / Por categoria): explicit order, checked items stay in place.
  const routeItems = useMemo(() => {
    const seq = routeSequence(filtered);
    return hideChecked ? seq.filter(i => !i.purchased) : seq;
  }, [filtered, hideChecked]);
  const isRouteView = sortMode === 'custom' || sortMode === 'category';
  const categoryGroups = useMemo(() => CATEGORIES
    .map(c => ({ cat: c, items: routeItems.filter(i => (i.category ?? 'outros') === c.id) }))
    .filter(g => g.items.length > 0), [routeItems]);

  const handleInvert = () => {
    if (searchQuery.trim() || categoryFilter) {
      toast.error('Remova a busca e o filtro de categoria antes de inverter', {
        description: 'A inversão vale para a lista inteira, não só para o que está na tela.',
        action: { label: 'Remover', onClick: () => { setSearchQuery(''); setCategoryFilter(null); } },
      });
      return;
    }
    if (allItems.length < 2) { toast('Nada para inverter'); return; }
    if (storage === 'relational' && syncStatus === 'conflict') {
      toast.error('Revise as alterações em conflito antes de inverter.');
      return;
    }
    const token = invertActiveList();
    if (!token) return;
    toast.success('Lista invertida', {
      duration: 8000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          if (!undoInversion(token)) toast.error('Não dá para desfazer: a ordem mudou depois da inversão.');
        },
      },
    });
  };

  // Sort
  const sorted = useMemo(() => {
    const pending = filtered.filter(i => !i.purchased);
    const purchased = filtered.filter(i => i.purchased);

    const sortFn = (a: ShoppingItem, b: ShoppingItem) => {
      if (sortMode === 'alpha') return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      if (sortMode === 'created') return b.createdAt - a.createdAt;
      return compareRoute(a, b);
    };

    return { pending: [...pending].sort(sortFn), purchased: [...purchased].sort(sortFn) };
  }, [filtered, sortMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const handleRouteDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = routeItems.findIndex(i => i.id === active.id);
    const newIndex = routeItems.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    reorderItems(arrayMove(routeItems, oldIndex, newIndex).map(i => i.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.pending.findIndex(i => i.id === active.id);
    const newIndex = sorted.pending.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(sorted.pending, oldIndex, newIndex);
    // Only the visible/reordered ids are sent; the store keeps every other item intact.
    reorderItems(reordered.map(i => i.id));
  };

  type ExportKind = 'whatsapp' | 'txt';
  const [exportAsk, setExportAsk] = useState<ExportKind | null>(null);
  const visibleItems = useMemo(() => [...sorted.pending, ...sorted.purchased], [sorted]);
  const isFiltered = visibleItems.length !== allItems.length;

  const describeVisible = (): string => {
    const parts: string[] = [];
    if (categoryFilter) parts.push(`categoria ${CATEGORIES.find(c => c.id === categoryFilter)?.label ?? categoryFilter}`);
    if (searchQuery.trim()) parts.push(`busca "${searchQuery.trim()}"`);
    return `Seleção visível${parts.length ? `: ${parts.join(', ')}` : ''} (${visibleItems.length} de ${allItems.length} itens)`;
  };

  const startExport = (kind: ExportKind) => {
    if (!allItems.length) { toast.error('Lista vazia'); return; }
    if (isFiltered) { setExportAsk(kind); return; }
    void runExport(kind, 'all');
  };

  const runExport = async (kind: ExportKind, scopeKind: ExportScope['kind']) => {
    setExportAsk(null);
    const items = scopeKind === 'all'
      ? [...allItems].sort((a, b) => Number(a.purchased) - Number(b.purchased))
      : visibleItems;
    if (!items.length) { toast.error('Nenhum item para exportar'); return; }
    const scope: ExportScope = scopeKind === 'all'
      ? { kind: 'all', label: `Lista completa (${items.length} itens)` }
      : { kind: 'visible', label: describeVisible() };
    const listName = list?.name ?? 'Lista';
    if (kind === 'whatsapp') await shareWhatsApp(buildWhatsAppText(listName, items, scope));
    else await shareTxt(listName, buildTxtExport(listName, items, scope));
  };

  const shareWhatsApp = async (text: string) => {
    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      toast.success('Lista copiada!');
    }
  };

  const shareTxt = async (listName: string, fullText: string) => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, fullText], { type: 'text/plain;charset=utf-8' });

    try {
      const file = new File([blob], `${listName}.txt`, { type: 'text/plain;charset=utf-8' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: listName });
        return;
      }
    } catch {
      // Share cancelled or unsupported: fall through to download
    }

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${listName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Arquivo baixado!');
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        window.open(reader.result as string, '_blank');
        toast.success('Arquivo aberto em nova aba!');
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleOpenEdit = (item: ShoppingItem) => {
    setEditItem(item);
    setSheetOpen(true);
  };

  const handleCloseSheet = () => {
    setSheetOpen(false);
    setEditItem(null);
  };

  // Never show data that may belong to another account while ownership is being checked.
  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground">Carregando suas listas...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background ${shoppingMode ? 'pb-40' : 'pb-28'}`}>
      <AppHeader
        syncStatus={syncStatus}
        onShareWhatsApp={() => startExport('whatsapp')}
        onShare={() => setShareOpen(true)}
        onShareTxt={() => startExport('txt')}
        onReport={() => setReportOpen(true)}
        onCategories={() => setCategoryModalOpen(true)}
        onBackup={() => setBackupOpen(true)}
        pendingCount={opStatus?.pending ?? 0}
        confirmedAt={opStatus?.confirmedAt ?? null}
        live={live === 'live'}
        online={online}
        onStorage={user && (RELATIONAL_RELEASE || storage === 'relational') ? () => setStorageOpen(true) : undefined}
      />

      <main className="container py-4 space-y-4">
        {storage === 'relational' && (lists.find(l => l.id === activeListId)?.members?.length ?? 0) > 1 && (
          <LiveBadge live={live === 'live' && (opStatus?.pending ?? 0) === 0} online={online} pending={opStatus?.pending ?? 0} members={lists.find(l => l.id === activeListId)?.members ?? []} />
        )}
        {list?.role && list.role !== 'owner' && (
          <p className="rounded-lg border bg-card px-3 py-2 text-sm" role="status">
            Lista de {sharedOwner ?? 'outra pessoa'}. {list.role === 'editor' ? 'Você pode editar itens.' : list.role === 'checker' ? 'Você pode apenas marcar.' : 'Permissão ainda não confirmada pelo servidor. Nada é enviado até confirmar.'}
          </p>
        )}
        {toReview.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-warning bg-warning/10 px-3 py-2 text-sm" role="status">
            <p className="flex-1 text-foreground">
              {toReview.length === 1 ? '1 produto precisa' : `${toReview.length} produtos precisam`} de revisão da unidade.
            </p>
            <button type="button" onClick={() => setReviewOpen(true)} className="min-h-10 rounded-md px-3 font-medium text-primary hover:bg-accent">Revisar</button>
          </div>
        )}
        {!shoppingMode && (
          <>
            {canEdit && <SortControl onInvert={handleInvert} onNextPurchase={() => setNextOpen(true)} />}
            <CategoryChips />
          </>
        )}

        {allItems.length === 0 ? (
          <EmptyState onAdd={canEdit ? () => setSheetOpen(true) : undefined} />
        ) : (
          isRouteView ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 min-h-11 text-sm text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={hideChecked} onChange={e => setHideChecked(e.target.checked)} />
              Ocultar itens no carrinho
            </label>
            {routeItems.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nenhum item para mostrar.</p>}
            {sortMode === 'custom' ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRouteDragEnd}>
                <SortableContext items={routeItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {routeItems.map(item => (
                      <ItemCard key={item.id} item={item} onEdit={handleOpenEdit} sortMode={sortMode} shoppingMode={shoppingMode} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              categoryGroups.map(g => (
                <section key={g.cat.id} className="space-y-2 pt-2" aria-label={g.cat.label}>
                  <h2 className="text-sm font-semibold text-muted-foreground">{g.cat.label} ({g.items.length})</h2>
                  {g.items.map(item => (
                    <ItemCard key={item.id} item={item} onEdit={handleOpenEdit} sortMode={sortMode} shoppingMode={shoppingMode} />
                  ))}
                </section>
              ))
            )}
            {!shoppingMode && <CategoryCostDashboard items={allItems} />}
            {!shoppingMode && canEdit && allItems.some(i => i.purchased) && (
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <Button size="sm" onClick={() => setCompleteOpen(true)} className="text-xs">
                  <CheckCheck className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Concluir compra
                </Button>
              </div>
            )}
          </div>
          ) : (
          <div className="space-y-2">
            {sorted.pending.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sorted.pending.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {sorted.pending.map(item => (
                        <ItemCard key={item.id} item={item} onEdit={handleOpenEdit} sortMode={sortMode} shoppingMode={shoppingMode} />
                      ))}
                    </AnimatePresence>
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {sorted.purchased.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setPurchasedOpen(!purchasedOpen)}
                  aria-expanded={purchasedOpen}
                  className="flex items-center gap-2 min-h-11 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${purchasedOpen ? 'rotate-0' : '-rotate-90'}`} aria-hidden="true" />
                  No carrinho ({sorted.purchased.length})
                </button>
                {purchasedOpen && (
                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {sorted.purchased.map(item => (
                        <ItemCard key={item.id} item={item} onEdit={handleOpenEdit} sortMode={sortMode} shoppingMode={shoppingMode} />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}

            {!shoppingMode && <CategoryCostDashboard items={allItems} />}

            {!shoppingMode && canEdit && (
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                {sorted.purchased.length > 0 && (
                  <Button size="sm" onClick={() => setCompleteOpen(true)} className="text-xs">
                  <CheckCheck className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Concluir compra
                </Button>
                )}
                {!confirmClearAll ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClearAll(true)} className="text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Resetar tudo
                  </Button>
                ) : (
                  <Button variant="destructive" size="sm" onClick={() => { resetAll(); setConfirmClearAll(false); toast.success('Todos os dados foram apagados'); }} className="text-xs">
                    Apagar listas, orçamentos e histórico
                  </Button>
                )}
              </div>
            )}
          </div>
          )
        )}
      </main>

      {shoppingMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur pb-safe" role="status" aria-live="polite">
          <div className="container flex items-center justify-between gap-3 py-3 pr-24 text-base">
            <span>No carrinho <strong className="num">{allItems.filter(i => i.purchased).length} de {allItems.length}</strong></span>
            <span className="text-right">
              <span className="block text-xs text-muted-foreground">Total estimado</span>
              <strong className="num">{formatBRL(totalsOf(allItems).cents)}</strong>
            </span>
          </div>
        </div>
      )}

      {canEdit && <Fab raised={shoppingMode} onClick={() => { setEditItem(null); setSheetOpen(true); }} />}

      <AddEditSheet open={sheetOpen} onClose={handleCloseSheet} editItem={editItem} />
      <UnitReviewDialog open={reviewOpen && toReview.length > 0} items={toReview} onClose={() => setReviewOpen(false)}
        onReview={item => { setReviewOpen(false); handleOpenEdit(item); }} />
      <CategoryGroupModal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} items={allItems} />
      <ReportDialog list={list} open={reportOpen} onClose={() => setReportOpen(false)} />
      <CompletePurchaseDialog list={list} open={completeOpen} onClose={() => setCompleteOpen(false)} />
      <NextPurchaseDialog
        source={list}
        open={nextOpen}
        onClose={() => setNextOpen(false)}
        onConfirm={opts => {
          if (!list) return;
          const id = createNextList(list.id, opts);
          setNextOpen(false);
          if (id) toast.success('Nova lista criada', { description: `"${list.name}" foi mantida sem alterações.` });
        }}
      />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} />
      <StorageDialog open={storageOpen} onClose={() => setStorageOpen(false)} storage={storage}
        report={migration} onMigrate={() => void migrate()} onRollback={() => void rollback()} />
      <SyncDecisionDialog decision={decision} onResolve={resolveDecision} />
      <SyncConflictDialog conflict={conflict} onResolve={resolveConflict} />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} list={list} signedIn={!!user}
        relational={storage === 'relational'} userId={user?.id ?? null} prepareShare={prepareShare}
        refresh={() => void refreshNow()} onShareText={() => { setShareOpen(false); startExport('whatsapp'); }}
        onOpenStorage={() => { setShareOpen(false); setStorageOpen(true); }} />
      <OpReviewDialog ops={opStatus?.conflicts ?? []} denied={opStatus?.denied ?? 0} deniedOps={opStatus?.deniedOps ?? []} onResolve={resolveOp} onExport={user ? () => void downloadRecovery(user.id) : undefined} />
      <Dialog open={!!exportAsk} onOpenChange={o => !o && setExportAsk(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>O que exportar?</DialogTitle>
            <DialogDescription>Há um filtro ou busca ativa. Os totais seguem exatamente os itens escolhidos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button className="w-full" onClick={() => exportAsk && runExport(exportAsk, 'all')}>
              Lista completa ({allItems.length} itens)
            </Button>
            <Button className="w-full" variant="outline" onClick={() => exportAsk && runExport(exportAsk, 'visible')}>
              Só o que está na tela ({visibleItems.length} itens)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
