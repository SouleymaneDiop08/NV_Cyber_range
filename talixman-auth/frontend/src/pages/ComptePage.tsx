import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';
import { changePassword, extractApiErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super Administrateur',
  ADMIN: 'Administrateur',
  GUEST: 'Invité',
};

export default function ComptePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fullName = user && (user.firstName || user.lastName) ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 10) {
      setError('Le nouveau mot de passe doit contenir au moins 10 caractères.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast('success', 'Mot de passe mis à jour avec succès.');
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Échec de la mise à jour du mot de passe.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        Mon compte
      </h1>
      <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Gérez les informations de sécurité de votre compte.
      </p>

      <Card className="max-w-[440px]">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <KeyRound size={16} aria-hidden="true" style={{ color: 'var(--orange)' }} />
              Sécurité
            </span>
          }
          description={fullName ? `${fullName} · ${user ? ROLE_LABEL[user.role] : ''}` : user ? ROLE_LABEL[user.role] : undefined}
        />

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-[13px] font-medium" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}

          <TextField
            label="Mot de passe actuel"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          <TextField
            label="Nouveau mot de passe (10 caractères minimum)"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          <TextField
            label="Confirmer le nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            required
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
          />

          <Button type="submit" variant="primary" loading={submitting} className="mt-1 self-start">
            Mettre à jour
          </Button>
        </form>
      </Card>
    </div>
  );
}
