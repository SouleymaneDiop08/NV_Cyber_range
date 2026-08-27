import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  Pencil,
  Plus,
  Power,
  Server,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Checkbox, SelectField, TextField } from '../components/ui/Field';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import {
  createService,
  createUser,
  deleteService,
  deleteUser,
  extractApiErrorMessage,
  listLabComponents,
  listSectors,
  listServices,
  listUsers,
  updateService,
  type AccessLevel,
  type ListedUser,
  type Sector,
  type Service,
  type ServiceCategory,
} from '../lib/api';

const CATEGORY_OPTIONS: ServiceCategory[] = ['WORKSTATION', 'ATTACKER', 'SUPERVISION', 'AUTOMATE', 'TERRAIN'];

interface ServiceFormValues {
  name: string;
  description: string;
  labComponent: string;
  category: ServiceCategory;
  guestAccess: boolean;
  ssoTarget: string;
}

function ServiceForm({
  sectorId,
  submitLabel,
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  sectorId: string;
  submitLabel: string;
  initial?: ServiceFormValues;
  onCancel?: () => void;
  onSubmit: (values: ServiceFormValues) => void;
  submitting: boolean;
}) {
  const { data: components, isLoading: loadingComponents } = useQuery({
    queryKey: ['lab-components', sectorId],
    queryFn: () => listLabComponents(sectorId),
  });

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [labComponent, setLabComponent] = useState(initial?.labComponent ?? '');
  const [category, setCategory] = useState<ServiceCategory>(initial?.category ?? 'SUPERVISION');
  const [guestAccess, setGuestAccess] = useState(initial?.guestAccess ?? false);
  const [ssoTarget, setSsoTarget] = useState(initial?.ssoTarget ?? '');

  const noComponents = !loadingComponents && (components ?? []).length === 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, description, labComponent, category, guestAccess, ssoTarget });
      }}
      className="mb-5 flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border p-4 animate-slide-up"
      style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
    >
      <div className="min-w-[160px]">
        <TextField label="Nom" required value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: HMI Poste C" />
      </div>
      <div className="min-w-[200px] flex-1">
        <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="min-w-[200px]">
        <SelectField
          label="Composant du labo"
          required
          disabled={noComponents}
          value={labComponent}
          onChange={(e) => setLabComponent(e.target.value)}
          placeholder={loadingComponents ? 'Chargement…' : 'Choisir…'}
          hint={noComponents ? "Cette filière n'a pas encore de labo K8s configuré." : undefined}
        >
          {(components ?? []).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <SelectField label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value as ServiceCategory)}>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <SelectField
          label="Connexion unique (SSO)"
          value={ssoTarget}
          onChange={(e) => setSsoTarget(e.target.value)}
          hint="Si activé, l'utilisateur arrive déjà connecté, sans ressaisir d'identifiants."
        >
          <option value="">Lien direct (aucun SSO)</option>
          <option value="FUXA">FUXA</option>
        </SelectField>
      </div>
      <div className="pb-2.5">
        <Checkbox label="Accès invités (VIEW_ONLY)" checked={guestAccess} onChange={(e) => setGuestAccess(e.target.checked)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={submitting} disabled={noComponents}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

function ServicesPanel({ sector }: { sector: Sector }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: services, isLoading } = useQuery({
    queryKey: ['services', sector.id],
    queryFn: () => listServices(sector.id),
  });

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['services', sector.id] });

  const createMutation = useMutation({
    mutationFn: (values: ServiceFormValues) =>
      createService(sector.id, {
        name: values.name,
        description: values.description || undefined,
        labComponent: values.labComponent,
        category: values.category,
        accessLevel: (values.guestAccess ? 'VIEW_ONLY' : 'FULL') as AccessLevel,
        ssoTarget: values.ssoTarget || null,
      }),
    onSuccess: (service) => {
      invalidate();
      setShowForm(false);
      toast('success', `Service « ${service.name} » créé.`);
    },
    onError: (err) => setError(extractApiErrorMessage(err, 'Échec de la création du service.')),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateService(sector.id, id, { enabled }),
    onSuccess: invalidate,
    onError: (err) => setError(extractApiErrorMessage(err, 'Échec de la mise à jour du service.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ServiceFormValues }) =>
      updateService(sector.id, id, {
        name: values.name,
        description: values.description || undefined,
        labComponent: values.labComponent,
        category: values.category,
        accessLevel: (values.guestAccess ? 'VIEW_ONLY' : 'FULL') as AccessLevel,
        ssoTarget: values.ssoTarget || null,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast('success', 'Service modifié.');
    },
    onError: (err) => setError(extractApiErrorMessage(err, 'Échec de la modification du service.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteService(sector.id, id),
    onSuccess: () => {
      invalidate();
      toast('success', 'Service supprimé.');
      setDeleteTarget(null);
    },
    onError: (err) => {
      setError(extractApiErrorMessage(err, 'Échec de la suppression du service.'));
      setDeleteTarget(null);
    },
  });

  return (
    <Card>
      <CardHeader
        title={`Services — ${sector.label}`}
        action={
          !showForm && (
            <Button size="sm" variant="secondary" leftIcon={<Plus size={14} />} onClick={() => setShowForm(true)}>
              Nouveau service
            </Button>
          )
        }
      />

      {showForm && (
        <ServiceForm
          sectorId={sector.id}
          submitLabel="Ajouter"
          submitting={createMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(values) => {
            setError('');
            createMutation.mutate(values);
          }}
        />
      )}
      {error && (
        <p role="alert" className="mb-3 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {isLoading && <SkeletonRows rows={3} cols={3} />}

      {!isLoading && (services?.length ?? 0) === 0 && (
        <EmptyState icon={<Server size={18} />} title="Aucun service" description="Ce secteur n'a pas encore de service configuré." />
      )}

      <div className="flex flex-col gap-1">
        {(services ?? []).map((sv) =>
          editingId === sv.id ? (
            <div key={sv.id}>
              <ServiceForm
                sectorId={sector.id}
                submitLabel="Enregistrer"
                submitting={updateMutation.isPending}
                initial={{
                  name: sv.name,
                  description: sv.description ?? '',
                  labComponent: sv.labComponent,
                  category: sv.category ?? 'SUPERVISION',
                  guestAccess: sv.accessLevel === 'VIEW_ONLY',
                  ssoTarget: sv.ssoTarget ?? '',
                }}
                onCancel={() => setEditingId(null)}
                onSubmit={(values) => {
                  setError('');
                  updateMutation.mutate({ id: sv.id, values });
                }}
              />
            </div>
          ) : (
            <div
              key={sv.id}
              className="flex flex-wrap items-center gap-3 border-b py-3 transition-colors duration-[var(--dur-fast)] last:border-b-0 hover:bg-[var(--panel2)]"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-[160px] flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>
                  {sv.name}
                  {sv.ssoTarget && (
                    <Badge tone="info">SSO {sv.ssoTarget}</Badge>
                  )}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  {sv.category ?? '—'} · {sv.accessLevel}
                </div>
              </div>
              <IconButton aria-label={`Modifier ${sv.name}`} size="sm" onClick={() => setEditingId(sv.id)}>
                <Pencil size={14} />
              </IconButton>
              <Button
                size="sm"
                variant={sv.enabled ? 'primary' : 'secondary'}
                leftIcon={<Power size={13} />}
                onClick={() => toggleMutation.mutate({ id: sv.id, enabled: !sv.enabled })}
              >
                {sv.enabled ? 'Actif' : 'Inactif'}
              </Button>
              <IconButton aria-label={`Supprimer ${sv.name}`} size="sm" variant="ghost" onClick={() => setDeleteTarget(sv)}>
                <Trash2 size={14} style={{ color: 'var(--red)' }} />
              </IconButton>
            </div>
          ),
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Supprimer ce service ?"
        description={deleteTarget ? `« ${deleteTarget.name} » sera définitivement supprimé.` : undefined}
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
      />
    </Card>
  );
}

function SecteursTab() {
  const { data: sectors, isLoading } = useQuery({ queryKey: ['sectors'], queryFn: listSectors });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div>
      {isLoading && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(sectors ?? []).map((sector) => {
          const isOpen = expanded === sector.id;
          return (
            <button
              key={sector.id}
              onClick={() => setExpanded((e) => (e === sector.id ? null : sector.id))}
              aria-expanded={isOpen}
              className="rounded-[var(--radius-lg)] border p-5 text-left shadow-[var(--shadow-sm)] transition-all duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
              style={{
                borderColor: isOpen ? 'var(--orange)' : 'var(--border)',
                background: 'var(--panel)',
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]"
                  style={{ background: 'var(--panel2)', color: 'var(--orange)' }}
                >
                  <Building2 size={18} aria-hidden="true" />
                </div>
                <ChevronDown
                  size={16}
                  className="mt-1 transition-transform duration-[var(--dur-base)]"
                  style={{ color: 'var(--text-faint)', transform: isOpen ? 'rotate(180deg)' : undefined }}
                  aria-hidden="true"
                />
              </div>
              <div className="mt-3 text-[16px] font-bold" style={{ color: 'var(--text)' }}>
                {sector.label}
              </div>
              <div className="mt-0.5 font-mono text-[11px]" style={{ color: 'var(--text-dim)' }}>
                {sector.name}
              </div>
            </button>
          );
        })}
      </div>

      {expanded && sectors && (
        <ServicesPanel sector={sectors.find((s) => s.id === expanded)!} />
      )}
    </div>
  );
}

function AdministrateursTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: listSectors });
  const { data: admins, isLoading: loadingAdmins } = useQuery({ queryKey: ['users', 'ADMIN'], queryFn: () => listUsers('ADMIN') });
  const { data: superadmins, isLoading: loadingSuperadmins } = useQuery({
    queryKey: ['users', 'SUPERADMIN'],
    queryFn: () => listUsers('SUPERADMIN'),
  });
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'SUPERADMIN'>('ADMIN');
  const [sectorId, setSectorId] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ListedUser | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['users', 'ADMIN'] });
    queryClient.invalidateQueries({ queryKey: ['users', 'SUPERADMIN'] });
  };

  const mutation = useMutation({
    mutationFn: () =>
      createUser({ email, firstName, lastName, role, sectorId: role === 'ADMIN' ? sectorId : undefined }),
    onSuccess: (user) => {
      invalidate();
      setEmail('');
      setFirstName('');
      setLastName('');
      toast(
        user.emailSent ? 'success' : 'warning',
        user.emailSent
          ? `Compte créé, invitation envoyée à ${user.email}.`
          : `Compte créé, mais l'email d'invitation n'a pas pu être envoyé à ${user.email}.`,
      );
    },
    onError: (err) => setError(extractApiErrorMessage(err, 'Échec de la création du compte.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['users', 'GUEST'] });
      toast('success', 'Administrateur supprimé.');
      setDeleteTarget(null);
    },
    onError: (err) => {
      setError(extractApiErrorMessage(err, "Échec de la suppression de l'administrateur."));
      setDeleteTarget(null);
    },
  });

  const accounts: ListedUser[] = [...(superadmins ?? []), ...(admins ?? [])];
  const isLoading = loadingAdmins || loadingSuperadmins;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <UserCog size={16} aria-hidden="true" style={{ color: 'var(--orange)' }} />
            Administrateurs
          </span>
        }
        description="Créez des comptes administrateur (rattachés à un secteur) ou super administrateur."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="mb-5 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-[140px]">
          <TextField label="Prénom" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="min-w-[140px]">
          <TextField label="Nom" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <SelectField label="Rôle" value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'SUPERADMIN')}>
            <option value="ADMIN">Administrateur</option>
            <option value="SUPERADMIN">Super Administrateur</option>
          </SelectField>
        </div>
        {role === 'ADMIN' && (
          <div>
            <SelectField
              label="Secteur"
              required
              placeholder="Choisir…"
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
            >
              {(sectors ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <Button type="submit" variant="primary" loading={mutation.isPending} leftIcon={<UserPlus size={14} />}>
          Créer
        </Button>
      </form>
      {error && (
        <p role="alert" className="mb-3 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {isLoading && <SkeletonRows rows={3} cols={4} />}

      {!isLoading && accounts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                {['Nom', 'Email', 'Rôle', 'Secteur', 'Statut', ''].map((h) => (
                  <th key={h} className="border-b pb-2 text-left text-[12px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((u) => (
                <tr key={u.id} className="transition-colors duration-[var(--dur-fast)] hover:bg-[var(--panel2)]">
                  <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                    {u.email}
                  </td>
                  <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                    <Badge tone={u.role === 'SUPERADMIN' ? 'brand' : 'neutral'}>
                      {u.role === 'SUPERADMIN' ? (
                        <>
                          <ShieldCheck size={11} /> Super Admin
                        </>
                      ) : (
                        'Administrateur'
                      )}
                    </Badge>
                  </td>
                  <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                    {u.sectorId ? sectors?.find((s) => s.id === u.sectorId)?.label ?? u.sectorId : '—'}
                  </td>
                  <td className="border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                    <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>{u.status}</Badge>
                  </td>
                  <td className="border-b py-2.5 text-right" style={{ borderColor: 'var(--border)' }}>
                    {u.role === 'ADMIN' && (
                      <IconButton aria-label={`Supprimer ${u.email}`} size="sm" variant="ghost" onClick={() => setDeleteTarget(u)}>
                        <Trash2 size={14} style={{ color: 'var(--red)' }} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && accounts.length === 0 && (
        <EmptyState icon={<UserCog size={18} />} title="Aucun administrateur" description="Créez le premier compte administrateur ci-dessus." />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Supprimer cet administrateur ?"
        description={
          deleteTarget
            ? `${deleteTarget.email} et tous les invités qu'il a créés seront supprimés automatiquement. Cette action est irréversible.`
            : undefined
        }
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
      />
    </Card>
  );
}

function InvitesTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: guests, isLoading } = useQuery({ queryKey: ['users', 'GUEST'], queryFn: () => listUsers('GUEST') });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users', 'GUEST'] });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => deleteUser(id))),
    onSuccess: (_result, ids) => {
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      invalidate();
      toast('success', ids.length > 1 ? `${ids.length} invités supprimés.` : 'Invité supprimé.');
      setConfirmIds(null);
    },
    onError: (err) => {
      setError(extractApiErrorMessage(err, 'Échec de la suppression des invités.'));
      setConfirmIds(null);
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = new Map<string, { label: string; guests: ListedUser[] }>();
  for (const guest of guests ?? []) {
    const key = guest.createdBy?.id ?? 'unknown';
    const label = guest.createdBy?.email ?? 'Créateur supprimé';
    if (!groups.has(key)) groups.set(key, { label, guests: [] });
    groups.get(key)!.guests.push(guest);
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Users size={16} aria-hidden="true" style={{ color: 'var(--orange)' }} />
            Invités
          </span>
        }
        description="Tous les comptes invités, groupés par administrateur créateur."
        action={
          <Button
            size="sm"
            variant="danger"
            leftIcon={<Trash2 size={13} />}
            onClick={() => setConfirmIds(Array.from(selected))}
            disabled={selected.size === 0}
          >
            Supprimer la sélection ({selected.size})
          </Button>
        }
      />
      {error && (
        <p role="alert" className="mb-3 text-[13px] font-medium" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}

      {isLoading && <SkeletonRows rows={4} cols={3} />}

      {!isLoading && groups.size === 0 && (
        <EmptyState icon={<Users size={18} />} title="Aucun invité" description="Les invités créés par les administrateurs apparaîtront ici." />
      )}

      <div className="flex flex-col gap-6">
        {Array.from(groups.entries()).map(([key, group]) => (
          <div key={key}>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Créé par {group.label}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <tbody>
                  {group.guests.map((guest) => (
                    <tr key={guest.id} className="transition-colors duration-[var(--dur-fast)] hover:bg-[var(--panel2)]">
                      <td className="w-9 border-b py-2.5" style={{ borderColor: 'var(--border)' }}>
                        <Checkbox
                          label={<span className="sr-only">Sélectionner {guest.email}</span>}
                          checked={selected.has(guest.id)}
                          onChange={() => toggle(guest.id)}
                        />
                      </td>
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
                        <IconButton aria-label={`Supprimer ${guest.email}`} size="sm" variant="ghost" onClick={() => setConfirmIds([guest.id])}>
                          <Trash2 size={14} style={{ color: 'var(--red)' }} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmIds && confirmIds.length > 0}
        onCancel={() => setConfirmIds(null)}
        onConfirm={() => confirmIds && deleteMutation.mutate(confirmIds)}
        title={confirmIds && confirmIds.length > 1 ? `Supprimer ${confirmIds.length} invités ?` : 'Supprimer cet invité ?'}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
      />
    </Card>
  );
}

const TABS = [
  { key: 'secteurs', label: 'Secteurs & Services', icon: Building2 },
  { key: 'admins', label: 'Administrateurs', icon: UserCog },
  { key: 'invites', label: 'Invités', icon: Users },
] as const;

export default function GestionPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('secteurs');

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        Gestion de la plateforme
      </h1>
      <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Secteurs, services, administrateurs et invités.
      </p>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Sections de gestion">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-[11.5px] font-bold uppercase tracking-wide transition-colors duration-[var(--dur-fast)]"
              style={{
                borderColor: active ? 'transparent' : 'var(--border-strong)',
                background: active ? 'linear-gradient(135deg,#EB640A,#BF2D31)' : 'var(--panel2)',
                color: active ? '#fff' : 'var(--text-dim)',
              }}
            >
              <Icon size={13} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div key={tab} className="animate-fade-in">
        {tab === 'secteurs' && <SecteursTab />}
        {tab === 'admins' && <AdministrateursTab />}
        {tab === 'invites' && <InvitesTab />}
      </div>
    </div>
  );
}
