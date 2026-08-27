import { Check, CheckCircle2, Copy, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import logo from '../assets/logo.png';
import { activate, extractApiErrorMessage, getActivationContext } from '../lib/api';

type LoadState = 'loading' | 'ready' | 'error';

export default function ActivatePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadState('error');
      setLoadError("Lien d'activation invalide : token manquant.");
      return;
    }
    getActivationContext(token)
      .then((ctx) => {
        setEmail(ctx.email);
        setQrCodeDataUrl(ctx.qrCodeDataUrl);
        setLoadState('ready');
      })
      .catch((err) => {
        setLoadError(extractApiErrorMessage(err, "Lien d'activation invalide ou expiré."));
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
      const { recoveryCodes } = await activate(token, password, totpCode);
      setRecoveryCodes(recoveryCodes);
    } catch (err) {
      setSubmitError(extractApiErrorMessage(err, "Échec de l'activation."));
      setTotpCode('');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papier indisponible (permissions navigateur) : l'utilisateur peut toujours copier
      // manuellement, ce n'est pas bloquant pour l'activation.
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[460px] animate-fade-in">
        <div className="mb-8 w-fit rounded-[10px] bg-white px-5 py-3.5">
          <img src={logo} alt="Talixman" className="block h-9" />
        </div>

        {loadState === 'loading' && (
          <div className="flex items-center gap-2.5" style={{ color: 'var(--text-dim)' }}>
            <Spinner size={16} />
            Chargement de votre invitation…
          </div>
        )}

        {loadState === 'error' && (
          <div>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--danger-bg)', color: 'var(--red)' }}>
              <ShieldAlert size={20} />
            </div>
            <h2 className="mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Activation impossible
            </h2>
            <p className="text-[13.5px]" style={{ color: 'var(--red)' }}>
              {loadError}
            </p>
            <Link to="/login" className="mt-4 inline-block text-sm font-semibold" style={{ color: 'var(--orange)' }}>
              Retour à la connexion
            </Link>
          </div>
        )}

        {loadState === 'ready' && !recoveryCodes && (
          <form onSubmit={handleSubmit} noValidate>
            <h2 className="m-0 mb-1 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Activation du compte
            </h2>
            <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              {email}
            </p>

            <div
              className="mb-6 flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border p-5"
              style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
            >
              <p className="m-0 text-center text-[13px]" style={{ color: 'var(--text-dim)' }}>
                Scannez ce QR code avec Google Authenticator (ou une app compatible TOTP)
              </p>
              {qrCodeDataUrl && (
                <img src={qrCodeDataUrl} alt="QR code TOTP" className="h-[180px] w-[180px] rounded-lg bg-white p-2" />
              )}
            </div>

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

            <div className="mb-6">
              <TextField
                label="Code à 6 chiffres (Google Authenticator)"
                inputMode="numeric"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                className="text-center font-mono text-[20px] tracking-[0.3em]"
              />
            </div>

            <Button type="submit" variant="primary" loading={submitting} className="w-full !py-[15px] !text-[14.5px]">
              Activer mon compte
            </Button>
          </form>
        )}

        {recoveryCodes && (
          <div className="animate-scale-in">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
              <CheckCircle2 size={22} />
            </div>
            <h2 className="m-0 mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Compte activé
            </h2>
            <p className="mb-4 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              Conservez ces codes de récupération en lieu sûr — ils ne seront plus jamais affichés et
              chacun ne peut être utilisé qu'une seule fois.
            </p>
            <div
              className="mb-3 grid grid-cols-2 gap-2 rounded-[var(--radius-lg)] border p-4 font-mono text-[14px]"
              style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--text)' }}
            >
              {recoveryCodes.map((code) => (
                <div key={code}>{code}</div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={copyRecoveryCodes}
              leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}
              className="mb-6 w-full"
            >
              {copied ? 'Copié !' : 'Copier les codes'}
            </Button>
            <Link
              to="/login"
              className="block w-full rounded-[var(--radius-md)] py-[15px] text-center text-[14.5px] font-bold tracking-wide text-white transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
              style={{ background: 'linear-gradient(135deg,#EB640A,#BF2D31)' }}
            >
              Aller à la connexion
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
