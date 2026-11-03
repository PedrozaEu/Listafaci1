import { CloudOff, Radio, RefreshCw } from 'lucide-react';
import type { ListMember } from '@/types/shopping';
import { initials } from '@/data/live';

interface Props { live: boolean; online: boolean; pending: number; members: ListMember[] }

/** Connection state of a shared list. Shows participants, not "online" people (no presence in this version). */
export function LiveBadge({ live, online, pending, members }: Props) {
  const text = !online ? `Sem conexão: ${pending} alteração(ões) pendente(s)`
    : pending > 0 ? `Enviando ${pending} alteração(ões)`
    : live ? 'Ao vivo' : 'Conectando...';
  const Icon = !online ? CloudOff : live ? Radio : RefreshCw;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2" role="status" aria-live="polite">
      <span className={`flex items-center gap-1.5 text-xs font-medium ${live && online ? 'text-teal' : 'text-muted-foreground'}`}>
        <Icon className={`h-3.5 w-3.5 ${!live && online && pending === 0 ? 'animate-spin' : ''}`} aria-hidden="true" />
        {text}
      </span>
      <span className="flex items-center" aria-label={`${members.length} participantes: ${members.map(m => m.name).join(', ')}`}>
        {members.slice(0, 5).map(m => (
          <span key={m.userId} title={m.name} style={{ backgroundColor: m.color }}
            className="-ml-1.5 first:ml-0 h-6 w-6 rounded-full ring-2 ring-card text-[10px] font-semibold text-primary-foreground inline-flex items-center justify-center">
            {initials(m.name)}
          </span>
        ))}
        {members.length > 5 && <span className="ml-1 text-xs text-muted-foreground">+{members.length - 5}</span>}
      </span>
    </div>
  );
}
