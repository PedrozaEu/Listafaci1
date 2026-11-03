import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShoppingBag, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

export default function Auth() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentEmail, setSentEmail] = useState(false);
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setSentEmail(true);
          toast.success('Confira seu e-mail para confirmar a conta.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Bem-vindo de volta!');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível continuar.';
      toast.error(
        msg.includes('Invalid login credentials') ? 'E-mail ou senha incorretos.' :
        msg.includes('already registered') ? 'Este e-mail já tem conta. Faça login.' : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error('Não foi possível entrar com o Google.');
      return;
    }
    if (result.redirected) return;
    navigate('/', { replace: true });
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ShoppingBag className="h-10 w-10 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-foreground">ListaFácil</h1>
          <p className="text-sm text-muted-foreground">
            Entre para salvar suas listas na nuvem e usá-las em qualquer aparelho.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={busy}
          >
            Continuar com Google
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" />
          </div>

          {sentEmail ? (
            <p className="text-sm text-muted-foreground text-center">
              Enviamos um link de confirmação para <strong>{email}</strong>. Abra o e-mail para ativar a conta.
            </p>
          ) : (
            <form onSubmit={handleEmail} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {mode === 'signup' ? 'Criar conta' : 'Entrar'}
              </Button>
            </form>
          )}

          <button
            type="button"
            className="w-full text-sm text-primary hover:underline"
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setSentEmail(false); }}
          >
            {mode === 'signup' ? 'Já tenho conta — entrar' : 'Criar uma conta nova'}
          </button>
        </div>

        <p className="text-center text-sm">
          <Link to="/" className="text-muted-foreground hover:underline">
            Continuar sem conta neste aparelho
          </Link>
        </p>
      </div>
    </main>
  );
}
