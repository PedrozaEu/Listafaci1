import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { SyncDecision } from '@/hooks/useCloudSync';

interface Props {
  decision: SyncDecision | null;
  onResolve: (choice: 'join' | 'separate') => void;
}

export function SyncDecisionDialog({ decision, onResolve }: Props) {
  return (
    <AlertDialog open={!!decision}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Listas encontradas neste aparelho</AlertDialogTitle>
          <AlertDialogDescription>
            Existem {decision?.localListCount ?? 0} lista(s) com itens criadas sem conta.
            {decision?.hasRemoteData
              ? ' Sua conta já tem listas salvas. Você pode juntar as duas coisas ou manter separado.'
              : ' Você pode levar essas listas para sua conta ou mantê-las só no modo sem conta.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onResolve('separate')}>
            Manter separado
          </Button>
          <Button onClick={() => onResolve('join')}>
            {decision?.hasRemoteData ? 'Juntar com minha conta' : 'Levar para minha conta'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
