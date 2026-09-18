import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import logo from '../assets/logo.png';
import { extractApiErrorMessage, getPasswordResetContext, resetPassword } from '../lib/api';

type LoadState = 'loading' | 'ready' | 'error';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadState('error');
      setLoadError('Lien de réinitialisation invalide : token manquant.');
      return;
    }
    getPasswordResetContext(token)
      .then((ctx) => {
        setEmail(ctx.email);
        setLoadState('ready');
      })
      .catch((err) => {
        setLoadError(extractApiErrorMessage(err, 'Lien de réinitialisation invalide ou expiré.'));
        setLoadState('error');
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');

    if (password.length < 10) {
      setSubmitError('Le mot de passe doit contenir au moins 10 caractères.');
      return;
    }
    if (password !== passwordConfirm) {
      setSubmitError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (!/^\d{6}$/.test(totpCode)) {
      setSubmitError('Le code doit contenir exactement 6 chiffres.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, password, totpCode);
      setDone(true);
    } catch (err) {
      setSubmitError(extractApiErrorMessage(err, 'Échec de la réinitialisation.'));
      setTotpCode('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[440px] animate-fade-in">
        <div className="mb-8 w-fit rounded-[10px] bg-white px-5 py-3.5">
          <img src={logo} alt="Talixman" className="block h-9" />
        </div>

        {loadState === 'loading' && (
          <div className="flex items-center gap-2.5" style={{ color: 'var(--text-dim)' }}>
            <Spinner size={16} />
            Vérification du lien…
          </div>
        )}

        {loadState === 'error' && (
          <div>
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: 'var(--danger-bg)', color: 'var(--red)' }}
            >
              <ShieldAlert size={20} />
            </div>
            <h2 className="mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Réinitialisation impossible
            </h2>
            <p className="text-[13.5px]" style={{ color: 'var(--red)' }}>
              {loadError}
            </p>
            <Link to="/forgot-password" className="mt-4 inline-block text-sm font-semibold" style={{ color: 'var(--orange)' }}>
              Demander un nouveau lien
            </Link>
          </div>
        )}

        {loadState === 'ready' && !done && (
          <form onSubmit={handleSubmit} noValidate>
            <h2 className="m-0 mb-1 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Nouveau mot de passe
            </h2>
            <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              {email}
            </p>

            {submitError && (
              <div role="alert" className="mb-4 text-center text-[13px] font-medium" style={{ color: 'var(--red)' }}>
                {submitError}
              </div>
            )}

            <div className="mb-4">
              <TextField
                label="Nouveau mot de passe (10 caractères minimum)"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="mb-4">
              <TextField
                label="Confirmer le mot de passe"
                type="password"
                autoComplete="new-password"
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </div>

            <div className="mb-2">
              <TextField
                label="Code à 6 chiffres (Google Authenticator)"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                className="text-center font-mono text-[20px] tracking-[0.3em]"
              />
            </div>
            <p className="mb-6 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Le second facteur reste exigé : le lien reçu par email ne suffit pas à reprendre le compte.
            </p>

            <Button type="submit" variant="primary" loading={submitting} className="w-full !py-[15px] !text-[14.5px]">
              Définir le mot de passe
            </Button>
          </form>
        )}

        {done && (
          <div className="animate-scale-in">
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: 'var(--success-bg)', color: 'var(--success)' }}
            >
              <CheckCircle2 size={22} />
            </div>
            <h2 className="m-0 mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Mot de passe modifié
            </h2>
            <p className="mb-6 text-[13.5px] leading-[1.6]" style={{ color: 'var(--text-dim)' }}>
              Vous pouvez maintenant vous connecter avec votre nouveau mot de passe. Toutes les
              sessions déjà ouvertes sur ce compte ont été déconnectées.
            </p>
            <Link
              to="/login"
              className="block w-full rounded-[var(--radius-md)] py-[15px] text-center text-[14.5px] font-bold tracking-wide text-white transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
              style={{ background: 'var(--gradient-brand)' }}
            >
              Aller à la connexion
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
