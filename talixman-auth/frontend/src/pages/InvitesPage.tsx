import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/Dialog';
import { TextField } from '../components/ui/Field';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import {
  createUser,
  deleteMyGuest,
  extractApiErrorMessage,
  listMyGuests,
} from '../lib/api';

const GUESTS_KEY = ['users', 'me', 'guests'];

export default function InvitesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: guests, isLoading } = useQuery({
    queryKey: GUESTS_KEY,
    queryFn: listMyGuests,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMyGuest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GUESTS_KEY });
      toast('success', 'Invité supprimé.');
      setConfirmId(null);
    },
    onError: (err) => {
      setListError(extractApiErrorMessage(err, "Échec de la suppression de l'invité."));
      setConfirmId(null);
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await createUser({ email, firstName, lastName, role: 'GUEST' });
      // La liste vient du serveur : on la réinterroge plutôt que d'y injecter
      // la réponse, pour qu'un rechargement affiche exactement la même chose.
      queryClient.invalidateQueries({ queryKey: GUESTS_KEY });
      setEmail('');
      setFirstName('');
      setLastName('');
      toast(
        user.emailSent ? 'success' : 'warning',
        user.emailSent
          ? `Invitation envoyée à ${user.email}.`
          : `Compte créé, mais l'email n'a pas pu être envoyé à ${user.email}.`,
      );
    } catch (err) {
      setError(extractApiErrorMessage(err, "Échec de la création de l'invité."));
    } finally {
      setSubmitting(false);
    }
  }

  const confirmTarget = guests?.find((g) => g.id === confirmId) ?? null;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        Invités
      </h1>
      <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Invitez de nouveaux comptes invités pour votre secteur.
      </p>

      <Card className="mb-8">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <UserPlus size={16} aria-hidden="true" style={{ color: 'var(--orange)' }} />
              Nouvel invité
            </span>
          }
        />
        <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <TextField label="Prénom" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="min-w-[160px]">
            <TextField label="Nom" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="min-w-[240px] flex-1">
            <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" loading={submitting}>
            Créer
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          <Mail size={13} aria-hidden="true" />
          Un email d'activation (avec QR code TOTP) est envoyé automatiquement à l'invité.
        </p>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Users size={16} aria-hidden="true" style={{ color: 'var(--orange)' }} />
              Mes invités
            </span>
          }
          description="Les comptes invités que vous avez créés."
        />
        {listError && (
          <p role="alert" className="mb-3 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
            {listError}
          </p>
        )}

        {isLoading && <SkeletonRows rows={3} cols={4} />}

        {!isLoading && (guests?.length ?? 0) === 0 && (
          <EmptyState
            icon={<Users size={18} />}
            title="Aucun invité"
            description="Les comptes que vous créez apparaîtront ici."
          />
        )}

        {!isLoading && (guests?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b pb-2 text-left text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    Nom
                  </th>
                  <th className="border-b pb-2 text-left text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    Email
                  </th>
                  <th className="border-b pb-2 text-left text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    Statut
                  </th>
                  <th className="border-b pb-2 text-right text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {guests?.map((guest) => (
                  <tr key={guest.id} className="transition-colors duration-[var(--dur-fast)] hover:bg-[var(--panel2)]">
                    <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                      {guest.firstName} {guest.lastName}
                    </td>
                    <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                      {guest.email}
                    </td>
                    <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                      <Badge tone={guest.status === 'ACTIVE' ? 'success' : 'neutral'}>{guest.status}</Badge>
                    </td>
                    <td className="border-b py-2.5 text-right" style={{ borderColor: 'var(--border)' }}>
                      <IconButton
                        aria-label={`Supprimer ${guest.email}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmId(guest.id)}
                      >
                        <Trash2 size={14} style={{ color: 'var(--red)' }} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ConfirmDialog
          open={!!confirmId}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => confirmId && deleteMutation.mutate(confirmId)}
          title="Supprimer cet invité ?"
          description={
            confirmTarget
              ? `${confirmTarget.email} perdra immédiatement son accès. Cette action est irréversible.`
              : 'Cette action est irréversible.'
          }
          confirmLabel="Supprimer"
          loading={deleteMutation.isPending}
        />
      </Card>
    </div>
  );
}
