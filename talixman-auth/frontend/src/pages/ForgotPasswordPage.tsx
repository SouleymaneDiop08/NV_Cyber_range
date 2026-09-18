import { ArrowLeft, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import logo from '../assets/logo.png';
import { extractApiErrorMessage, requestPasswordReset } from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Échec de la demande. Réessayez.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[420px] animate-fade-in">
        <div className="mb-8 w-fit rounded-[10px] bg-white px-5 py-3.5">
          <img src={logo} alt="Talixman" className="block h-9" />
        </div>

        {!sent && (
          <form onSubmit={handleSubmit} noValidate>
            <h2 className="m-0 mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Mot de passe oublié
            </h2>
            <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
              Saisissez votre adresse email. Si un compte y est associé, vous recevrez un lien pour
              définir un nouveau mot de passe.
            </p>

            {error && (
              <div role="alert" className="mb-4 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <div className="mb-6">
              <TextField
                label="Adresse email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <Button type="submit" variant="primary" loading={submitting} className="w-full !py-[15px] !text-[14.5px]">
              Envoyer le lien
            </Button>

            <Link
              to="/login"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold"
              style={{ color: 'var(--orange)' }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Retour à la connexion
            </Link>
          </form>
        )}

        {sent && (
          <div className="animate-scale-in">
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: 'var(--success-bg)', color: 'var(--success)' }}
            >
              <MailCheck size={22} />
            </div>
            <h2 className="m-0 mb-2 text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>
              Demande enregistrée
            </h2>
            {/* Formulation délibérément neutre : la page ne confirme jamais
                qu'un compte existe pour cette adresse. */}
            <p className="mb-6 text-[13.5px] leading-[1.6]" style={{ color: 'var(--text-dim)' }}>
              Si un compte est associé à <strong style={{ color: 'var(--text)' }}>{email}</strong>, un
              email contenant un lien de réinitialisation vient d'être envoyé. Ce lien est valable
              <strong style={{ color: 'var(--text)' }}> 1 heure</strong> et ne peut servir qu'une fois.
              Le code de votre application d'authentification vous sera demandé.
            </p>
            <Link
              to="/login"
              className="block w-full rounded-[var(--radius-md)] py-[15px] text-center text-[14.5px] font-bold tracking-wide text-white transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
              style={{ background: 'var(--gradient-brand)' }}
            >
              Retour à la connexion
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
