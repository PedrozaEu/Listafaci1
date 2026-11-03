import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { ChevronDown, Plus, Trash2, Wallet } from 'lucide-react';
import { parseMoneyBR, centsToInput, formatBRL, totalsOf } from '@/lib/money';
import { toast } from 'sonner';

/** "Início": the user's real lists, the shopping in progress and creating a list. */
export function ListDrawer() {
  const { lists, activeListId, setActiveList, addList, deleteList, setBudget } = useStore();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetVal, setBudgetVal] = useState('');

  const handleAddList = () => {
    if (!newName.trim()) return;
    addList(newName.trim(), '🛒');
    setNewName('');
    setOpen(false);
  };

  const activeList = lists.find(l => l.id === activeListId);
  const inProgress = lists.filter(l => {
    const c = l.items.filter(i => i.purchased).length;
    return c > 0 && c < l.items.length;
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label={`Lista atual: ${activeList?.name ?? 'nenhuma'}. Abrir início`}
          className="flex items-center gap-1.5 min-h-11 max-w-full px-2 -ml-2 rounded-md hover:bg-accent transition-colors"
        >
          <span className="font-semibold text-base truncate">{activeList?.name ?? 'Listas'}</span>
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto pb-safe">
        <SheetHeader>
          <SheetTitle>Início</SheetTitle>
          <SheetDescription>Suas listas salvas{lists.length ? ` (${lists.length})` : ''}.</SheetDescription>
        </SheetHeader>

        {inProgress.length > 0 && (
          <section className="mt-4" aria-labelledby="em-andamento">
            <h3 id="em-andamento" className="text-xs font-medium text-muted-foreground mb-2">Compra em andamento</h3>
            {inProgress.map(l => {
              const c = l.items.filter(i => i.purchased).length;
              return (
                <button
                  key={l.id}
                  onClick={() => { setActiveList(l.id); setOpen(false); }}
                  className="w-full min-h-11 mb-1.5 flex items-center justify-between rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-left"
                >
                  <span className="font-medium truncate">Continuar: {l.name}</span>
                  <span className="text-xs num text-muted-foreground flex-shrink-0 ml-2">{c} de {l.items.length} no carrinho</span>
                </button>
              );
            })}
          </section>
        )}

        {[{ title: 'Minhas listas', group: lists.filter(l => (l.role ?? 'owner') === 'owner') },
          { title: 'Compartilhadas comigo', group: lists.filter(l => (l.role ?? 'owner') !== 'owner') }]
          .filter(g => g.group.length > 0 || g.title === 'Minhas listas').map(g => (
        <section key={g.title} className="mt-4 space-y-2" aria-label={g.title}>
          <h3 className="text-xs font-medium text-muted-foreground">{g.title}</h3>
          {g.group.map(list => {
            const guest = (list.role ?? 'owner') !== 'owner';
            const ownerName = guest ? list.members?.find(m => m.role === 'owner')?.name : undefined;
            const inCart = list.items.filter(i => i.purchased).length;
            const totals = totalsOf(list.items);
            const active = list.id === activeListId;
            return (
              <div key={list.id} className={`rounded-lg border ${active ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                <div className="flex items-center">
                  <button
                    className="flex-1 min-w-0 min-h-11 text-left px-3 py-2"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => { setActiveList(list.id); setOpen(false); }}
                  >
                    <p className="text-sm font-medium break-words">{list.name}</p>
                    {guest && <p className="text-xs text-muted-foreground">De {ownerName ?? 'outra pessoa'} · {list.role === 'editor' ? 'você pode editar itens' : list.role === 'checker' ? 'você pode apenas marcar' : 'permissão não confirmada'}</p>}
                    <p className="text-xs text-muted-foreground num">
                      {list.items.length} itens · {inCart} no carrinho · {formatBRL(totals.cents)} estimado
                    </p>
                  </button>
                  {!guest && <button
                    aria-label={`Orçamento de ${list.name}`}
                    aria-expanded={editingBudget === list.id}
                    onClick={() => {
                      setEditingBudget(editingBudget === list.id ? null : list.id);
                      setBudgetVal(centsToInput(list.budgetCents));
                    }}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  >
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                  </button>}
                  {lists.length > 1 && list.role !== 'unknown' && (
                    <button
                      aria-label={guest ? `Sair da lista ${list.name}` : `Excluir lista ${list.name}`}
                      onClick={() => deleteList(list.id)}
                      className="h-11 w-11 inline-flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {editingBudget === list.id && (
                  <div className="flex gap-2 px-3 pb-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Orçamento de ${list.name} em reais`}
                      placeholder="Orçamento (R$)"
                      value={budgetVal}
                      onChange={e => setBudgetVal(e.target.value)}
                      className="h-11"
                    />
                    <Button
                      className="h-11"
                      onClick={() => {
                        const r = parseMoneyBR(budgetVal);
                        if (!r.ok) { toast.error(r.error); return; }
                        setBudget(list.id, r.value || undefined);
                        setEditingBudget(null);
                      }}
                    >
                      Salvar
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
        ))}

        <div className="pt-4 mt-4 border-t">
          <label htmlFor="nova-lista" className="text-xs font-medium text-muted-foreground">Criar lista</label>
          <div className="flex gap-2 mt-1.5">
            <Input
              id="nova-lista"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nome da nova lista"
              className="h-11"
              onKeyDown={e => e.key === 'Enter' && handleAddList()}
            />
            <Button onClick={handleAddList} className="h-11" aria-label="Criar lista">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
