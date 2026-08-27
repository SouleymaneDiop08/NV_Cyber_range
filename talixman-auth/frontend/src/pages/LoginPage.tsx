import { Eye, EyeOff } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import logo from '../assets/logo.png';
import { extractApiErrorMessage, login, verifyOtp } from '../lib/api';
import { useAuth } from '../lib/auth-context';

type Step = 'password' | 'otp';

function BrandPanel() {
  return (
    <div
      className="relative hidden flex-col justify-center overflow-hidden px-12 py-16 text-white md:flex"
      style={{ background: 'linear-gradient(150deg,#2c0f1e 0%,#572438 45%,#7a3248 100%)' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,.09) 1px,transparent 1.4px)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="pointer-events-none absolute -right-[100px] -top-[120px] h-[360px] w-[360px] rounded-full bg-[#EB640A] opacity-35 blur-[50px]" />
      <div className="pointer-events-none absolute -bottom-[100px] -left-[80px] h-[300px] w-[300px] rounded-full bg-[#BF2D31] opacity-30 blur-[50px]" />
      <div className="animate-fade-in relative z-10 max-w-[440px]">
        <div className="mb-10 w-fit rounded-[10px] bg-white px-5 py-3.5">
          <img src={logo} alt="Talixman" className="block h-9" />
        </div>
        <p className="mb-3.5 font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#ffb98a]">
          Cyber Range Industriel
        </p>
        <h1 className="mb-[18px] text-[42px] font-extrabold leading-[1.1] tracking-[-0.01em]">
          Entraînez vos équipes face aux{' '}
          <span className="bg-gradient-to-r from-[#ff9c52] to-[#ff6f61] bg-clip-text text-transparent">
            cybermenaces réelles
          </span>
        </h1>
        <p className="text-[15px] leading-[1.6] text-white/80">
          Environnements de simulation SCADA, ferroviaire et raffinerie pour l'entraînement à la
          cybersécurité des systèmes industriels.
        </p>
      </div>
    </div>
  );
}

function FloatingField({
  label,
  type,
  value,
  onChange,
  autoFocus,
  rightSlot,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="relative mb-6">
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'current-password' : 'username'}
        required
        className="peer w-full border-0 border-b-2 bg-transparent py-3.5 pl-0.5 pr-8 text-[15.5px] outline-none transition-colors duration-[var(--dur-base)] focus:border-[var(--orange)]"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-0.5 top-3.5 text-[15px] transition-all duration-[var(--dur-base)] peer-focus:-translate-y-5 peer-focus:scale-[0.72] peer-focus:text-[var(--orange)] peer-[:not(:placeholder-shown)]:-translate-y-5 peer-[:not(:placeholder-shown)]:scale-[0.72]"
        style={{ color: 'var(--text-dim)', transformOrigin: 'left top' }}
      >
        {label}
      </label>
      {rightSlot && <div className="absolute right-0.5 top-3.5">{rightSlot}</div>}
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { refetch } = useAuth();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  function triggerError(message: string) {
    setError(message);
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { pendingToken } = await login(email, password);
      setPendingToken(pendingToken);
      setOtp('');
      setStep('otp');
    } catch (err) {
      triggerError(extractApiErrorMessage(err, 'Identifiants invalides.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { user } = await verifyOtp(pendingToken, otp);
      await refetch();
      navigate(user.role === 'SUPERADMIN' ? '/gestion' : '/', { replace: true });
    } catch (err) {
      triggerError(extractApiErrorMessage(err, 'Code invalide.'));
      setOtp('');
      otpInputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[1.05fr_1fr]" style={{ background: 'var(--bg)' }}>
      <BrandPanel />
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className={`w-full max-w-[380px] animate-fade-in ${shake ? 'animate-[shake_0.4s]' : ''}`}>
          <div className="mb-10 w-fit rounded-[10px] bg-white px-5 py-3.5 md:hidden">
            <img src={logo} alt="Talixman" className="block h-9" />
          </div>

          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} noValidate>
              <h2 className="m-0 mb-2 text-[27px] font-extrabold" style={{ color: 'var(--text)' }}>
                Bienvenue
              </h2>
              <p className="mb-8 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
                Connectez-vous pour accéder à votre espace.
              </p>
              {error && (
                <div role="alert" className="-mt-1.5 mb-3.5 text-center text-[13px] font-medium" style={{ color: 'var(--red)' }}>
                  {error}
                </div>
              )}
              <FloatingField label="Identifiant" type="email" value={email} onChange={setEmail} autoFocus />
              <FloatingField
                label="Mot de passe"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                rightSlot={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="flex h-6 w-6 items-center justify-center rounded"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                className="mt-2 w-full !py-[15px] !text-[14.5px] shadow-[0_12px_26px_-8px_rgba(235,100,10,0.65)]"
              >
                Se connecter
              </Button>
              <div className="mt-5 text-center">
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-semibold transition-colors duration-[var(--dur-fast)] hover:underline"
                  style={{ color: 'var(--text-dim)' }}
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit} noValidate>
              <p className="m-0 mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--orange)' }}>
                Étape 2 / 2
              </p>
              <h2 className="m-0 mb-2 text-[27px] font-extrabold" style={{ color: 'var(--text)' }}>
                Vérification
              </h2>
              <p className="mb-8 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
                Entrez le code généré par votre application d'authentification.
              </p>
              {error && (
                <div role="alert" className="-mt-1.5 mb-3.5 text-center text-[13px] font-medium" style={{ color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              <div className="relative mb-5 flex justify-center">
                <div className="flex gap-2.5" aria-hidden="true">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex h-[58px] w-12 items-center justify-center rounded-[10px] font-mono text-[26px] font-semibold transition-all duration-[var(--dur-fast)]"
                      style={{
                        border: `1px solid ${otp[i] ? 'var(--orange)' : 'var(--border-strong)'}`,
                        background: 'var(--panel2)',
                        color: 'var(--text)',
                        boxShadow: otp[i] ? '0 0 0 3px rgba(235,100,10,0.25)' : undefined,
                      }}
                    >
                      {otp[i] ?? ''}
                    </div>
                  ))}
                </div>
                <input
                  ref={otpInputRef}
                  id="otp-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="Code de vérification à 6 chiffres"
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  className="absolute inset-0 w-full border-0 text-2xl opacity-0"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                disabled={otp.length !== 6}
                className="w-full !py-[15px] !text-[14.5px]"
              >
                Vérifier
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStep('password');
                  setOtp('');
                  setError('');
                }}
                className="mt-3 w-full"
              >
                Retour
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
