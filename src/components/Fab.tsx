import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
  /** Sits above the fixed shopping summary bar. */
  raised?: boolean;
}

export function Fab({ onClick, raised = false }: Props) {
  return (
    <button
      onClick={onClick}
      style={{ bottom: `calc(${raised ? '5.25rem' : '1.5rem'} + env(safe-area-inset-bottom))` }}
      className="fixed right-4 sm:right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all duration-150"
      aria-label="Adicionar item"
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
