import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { downloadBackup, type Snapshot } from '@/lib/backup';
import type { ConflictChoice, SyncConflict } from '@/hooks/useCloudSync';

const describe = (s: Snapshot) => {
  const items = s.lists.reduce((n, l) => n + l.items.length, 0);
  return `${s.lists.length} lista(s), ${items} item(ns)`;
};

interface Props {
  conflict: SyncConflict | null;
  onResolve: (choice: ConflictChoice) => void;
}

export function SyncConflictDialog({ conflict, onResolve }: Props) {
  return (
    <AlertDialog open={!!conflict}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Versões diferentes</AlertDialogTitle>
          <AlertDialogDescription>
            Este aparelho tem alterações que ainda não foram enviadas, e a nuvem foi alterada em outro lugar.
            Nada foi apagado. O envio está pausado até você escolher.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>Neste aparelho: {describe(conflict.local)}</span>
              <Button size="sm" variant="ghost" onClick={() => downloadBackup(conflict.local, 'aparelho')}>Baixar</Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Na nuvem: {describe(conflict.remote)}</span>
              <Button size="sm" variant="ghost" onClick={() => downloadBackup(conflict.remote, 'nuvem')}>Baixar</Button>
            </div>
            <div className="grid gap-2 pt-2">
              <Button onClick={() => onResolve('join')}>Juntar as duas</Button>
              <Button variant="outline" onClick={() => onResolve('device')}>Manter a deste aparelho</Button>
              <Button variant="outline" onClick={() => onResolve('cloud')}>Usar a da nuvem</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A versão não escolhida continua guardada: a da nuvem nas versões anteriores, a do aparelho no Backup.
            </p>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
