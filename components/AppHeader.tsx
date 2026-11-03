import {
  Search, Moon, Sun, X, ShoppingCart, LogOut, Cloud, CloudOff, RefreshCw, MoreVertical,
  Share2, FileText, Printer, LayoutGrid, DatabaseBackup, LogIn,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useState } from 'react';
import { totalsOf, formatBRL } from '@/lib/money';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { flushPendingSync, type SyncStatus } from '@/hooks/useCloudSync';
import { ListDrawer } from '@/components/ListDrawer';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { downloadBackup, snapshotOf } from '@/lib/backup';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  syncStatus?: SyncStatus;
  onShareWhatsApp: () => void;
  onShareTxt: () => void;
  onReport: () => void;
  onCategories: () => void;
  onBackup: () => void;
  /** Shown only while the storage upgrade is offered. */
  onStorage?: () => void;
  onShare: () => void;
  /** Operations waiting in the device outbox (relational storage). */
  pendingCount?: number;
  confirmedAt?: number | null;
  live?: boolean;
  online?: boolean;
}

const iconBtn = 'h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors';

const syncLabel: Record<SyncStatus, string> = {
  offline: 'Sem conta: salvo só neste aparelho',
  loading: 'Carregando suas listas...',
  saving: 'Salvando na nuvem...',
  pending: 'Salvo neste aparelho, aguardando sincronização',
  synced: 'Salvo na nuvem',
  error: 'Falha ao sincronizar',
  conflict: 'Versões diferentes, envio pausado',
};

export function AppHeader({ syncStatus = 'offline', onShareWhatsApp, onShareTxt, onReport, onCategories, onBackup, onStorage, onShare, pendingCount = 0, confirmedAt = null, live = false, online = true }: Props) {
  const {
    lists, activeListId, darkMode, toggleDarkMode,
    searchQuery, setSearchQuery, shoppingMode, toggleShoppingMode,
  } = useStore();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const label = !online && user ? `Sem conexão: ${pendingCount} alteração(ões) pendente(s) neste aparelho`
    : live && syncStatus === 'synced' ? 'Ao vivo: mudanças dos participantes aparecem na hora'
    : syncStatus === 'pending' ? `Aguardando sincronização: ${pendingCount}`
    : syncStatus === 'synced' && confirmedAt
      ? `Salvo na nuvem (confirmado às ${new Date(confirmedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`
      : syncLabel[syncStatus];
  const leave = async () => {
    await flushPendingSync();
    if (pendingCount > 0 || syncStatus === 'conflict') { setLeaveAsk(true); return; }
    await signOut();
  };

  const list = lists.find(l => l.id === activeListId);
  const items = list?.items ?? [];
  const totalItems = items.length;
  const inCart = items.filter(i => i.purchased).length;
  const cartTotals = totalsOf(items.filter(i => i.purchased));
  const totals = totalsOf(items);
  const progress = totalItems > 0 ? (inCart / totalItems) * 100 : 0;
  const budget = list?.budgetCents;
  const budgetRatio = budget ? totals.cents / budget : 0;
  const budgetColor = budgetRatio > 1 ? 'bg-destructive' : budgetRatio > 0.85 ? 'bg-warning' : 'bg-teal';

  const SyncIcon = syncStatus === 'synced' || syncStatus === 'pending' ? Cloud
    : syncStatus === 'saving' || syncStatus === 'loading' ? RefreshCw : CloudOff;

  return (
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="container flex items-center gap-1 py-1.5">
        <div className="flex-1 min-w-0">
          <ListDrawer />
        </div>

        <Button variant="ghost" size="icon"
          aria-label={searchOpen ? 'Fechar busca' : 'Buscar itens'}
          aria-expanded={searchOpen}
          onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(''); }}
          className={iconBtn}
        >
          {searchOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Search className="h-5 w-5" aria-hidden="true" />}
        </Button>
        <button
          aria-label={shoppingMode ? 'Sair do modo mercado' : 'Entrar no modo mercado'}
          aria-pressed={shoppingMode}
          onClick={toggleShoppingMode}
          className={shoppingMode
            ? 'h-11 w-11 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground'
            : iconBtn}
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Abrir menu" className={iconBtn}>
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Conta</DropdownMenuLabel>
            {user ? (
              <>
                <div className="px-2 pb-1.5 text-sm">
                  <p className="truncate">{user.email}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <SyncIcon className={`h-3.5 w-3.5 ${syncStatus === 'saving' || syncStatus === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {label}
                  </p>
                </div>
                <DropdownMenuItem className="min-h-11 gap-2" onClick={() => void leave()}>
                  <LogOut className="h-4 w-4" aria-hidden="true" /> Sair da conta
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem className="min-h-11 gap-2" onClick={() => navigate('/auth')}>
                <LogIn className="h-4 w-4" aria-hidden="true" /> Entrar ou criar conta
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Exportar e organizar</DropdownMenuLabel>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onShare}>
              <Share2 className="h-4 w-4" aria-hidden="true" /> Compartilhar ou continuar em outro aparelho
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onShareWhatsApp}>
              <Share2 className="h-4 w-4" aria-hidden="true" /> Enviar pelo WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onShareTxt}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Exportar arquivo TXT
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onReport}>
              <Printer className="h-4 w-4" aria-hidden="true" /> Relatório PDF de reposição
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onCategories}>
              <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Ver por categoria
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 gap-2" onClick={onBackup}>
              <DatabaseBackup className="h-4 w-4" aria-hidden="true" /> Backup das listas
            </DropdownMenuItem>
            {onStorage && (
              <DropdownMenuItem className="min-h-11 gap-2" onClick={onStorage}>
                <DatabaseBackup className="h-4 w-4" aria-hidden="true" /> Armazenamento das listas
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 gap-2" onClick={toggleDarkMode}>
              {darkMode ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
              {darkMode ? 'Usar tema claro' : 'Usar tema escuro'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {searchOpen && (
        <div className="container pb-2">
          <Input
            placeholder="Buscar na lista"
            aria-label="Buscar itens"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            className="h-11"
            autoFocus
          />
        </div>
      )}

      <div className="container pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-l-4 border-teal bg-teal/10 px-3 py-2" role="status" aria-live="polite" aria-label="Resumo do carrinho">
          <div>
            <p className="text-sm font-semibold text-foreground">Total no carrinho</p>
            <p className="text-xs text-muted-foreground">{inCart} de {totalItems} itens · estimado</p>
          </div>
          <strong className="text-xl font-bold text-teal num break-all">{formatBRL(cartTotals.cents)}</strong>
          {cartTotals.missing > 0 && (
            <p className="w-full text-xs text-muted-foreground">
              {cartTotals.missing} {cartTotals.missing === 1 ? 'item no carrinho sem preço fora do total' : 'itens no carrinho sem preço fora do total'}
            </p>
          )}
        </div>
      </div>

      {!shoppingMode && (
        <div className="container pb-3 space-y-2">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Itens</dt>
              <dd className="font-semibold num">{totalItems}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">No carrinho</dt>
              <dd className="font-semibold num">{inCart} de {totalItems}</dd>
            </div>
            <div className="text-right">
              <dt className="text-xs text-muted-foreground">Total estimado</dt>
              <dd className="font-semibold num">{formatBRL(totals.cents)}</dd>
            </div>
          </dl>
          <div
            className="h-1.5 rounded-full bg-muted overflow-hidden"
            role="progressbar" aria-label="Itens no carrinho"
            aria-valuemin={0} aria-valuemax={totalItems} aria-valuenow={inCart}
          >
            <div className="h-full bg-teal transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
          {(totals.missing > 0 || budget) && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {totals.missing > 0 && (
                <span>{totals.missing} {totals.missing === 1 ? 'item sem preço fora do total' : 'itens sem preço fora do total'}</span>
              )}
              {budget ? (
                <span className="flex items-center gap-2 num ml-auto">
                  Orçamento {formatBRL(budget)}
                  <span className="w-16 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                    <span className={`block h-full ${budgetColor}`} style={{ width: `${Math.min(budgetRatio * 100, 100)}%` }} />
                  </span>
                  <span className={budgetRatio > 1 ? 'text-destructive font-medium' : ''}>{Math.round(budgetRatio * 100)}%</span>
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
      <Dialog open={leaveAsk} onOpenChange={setLeaveAsk}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Há alterações não enviadas</DialogTitle>
            <DialogDescription>
              {pendingCount} alteração(ões) ainda não chegaram à nuvem. Se sair agora, elas ficam guardadas só neste aparelho,
              para esta conta, e serão enviadas quando você entrar de novo aqui. Outro aparelho não verá essas alterações.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-col">
            <Button className="min-h-11" disabled={leaving} onClick={async () => {
              setLeaving(true); await flushPendingSync(); setLeaving(false);
            }}>{leaving ? 'Sincronizando...' : 'Tentar sincronizar agora'}</Button>
            <Button variant="outline" className="min-h-11" onClick={() => downloadBackup(snapshotOf(useStore.getState()), '-antes-de-sair')}>
              Exportar backup
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={async () => { setLeaveAsk(false); await signOut(); }}>
              Sair mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
