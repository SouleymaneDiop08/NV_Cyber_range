import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pause, Play, RotateCw, Server, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../lib/auth-context';
import { LAB_QUERY_KEY, useMyLab } from '../../lib/use-my-lab';
import {
  deleteMyLab,
  extractApiErrorMessage,
  pauseMyLab,
  resumeMyLab,
  startMyLab,
  stopMyLab,
  type LabStatus,
} from '../../lib/api';

const STATUS_META: Record<LabStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  ABSENT: { label: 'Non démarré', tone: 'neutral' },
  CREATING: { label: 'Création en cours', tone: 'warning' },
  STARTING: { label: 'Démarrage en cours', tone: 'warning' },
  RUNNING: { label: 'En cours d’exécution', tone: 'success' },
  STOPPING: { label: 'Arrêt en cours', tone: 'warning' },
  STOPPED: { label: 'Arrêté', tone: 'neutral' },
  PAUSED: { label: 'Suspendu', tone: 'warning' },
  ERROR: { label: 'Erreur', tone: 'danger' },
};

/**
 * Composant unique, branché par rôle : un ADMIN pilote son labo (démarrer /
 * arrêter / supprimer), un GUEST n'en voit que le statut (hérité du labo de
 * l'admin qui l'a créé, cf. LabsService.getStatusForGuest côté backend) sans
 * aucun contrôle. Monté dans PortailPage.tsx, au-dessus du catalogue de
 * services existant — pas de nouvelle route, ce projet n'a aujourd'hui aucune
 * redirection par rôle.
 */
export function LabCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmAction, setConfirmAction] = useState<'stop' | 'delete' | null>(null);

  const { data: lab, isLoading } = useMyLab();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: LAB_QUERY_KEY });

  const startMutation = useMutation({
    mutationFn: startMyLab,
    onSuccess: () => {
      invalidate();
      toast('success', 'Démarrage du laboratoire lancé.');
    },
    onError: (err) => toast('error', extractApiErrorMessage(err, 'Échec du démarrage du laboratoire.')),
  });

  const stopMutation = useMutation({
    mutationFn: stopMyLab,
    onSuccess: () => {
      invalidate();
      setConfirmAction(null);
      toast('success', 'Arrêt du laboratoire lancé.');
    },
    onError: (err) => {
      setConfirmAction(null);
      toast('error', extractApiErrorMessage(err, "Échec de l'arrêt du laboratoire."));
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseMyLab,
    onSuccess: () => {
      invalidate();
      toast('success', 'Laboratoire suspendu.');
    },
    onError: (err) => toast('error', extractApiErrorMessage(err, 'Échec de la suspension du laboratoire.')),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeMyLab,
    onSuccess: () => {
      invalidate();
      toast('success', 'Laboratoire repris.');
    },
    onError: (err) => toast('error', extractApiErrorMessage(err, 'Échec de la reprise du laboratoire.')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMyLab,
    onSuccess: () => {
      invalidate();
      setConfirmAction(null);
      toast('success', 'Laboratoire supprimé.');
    },
    onError: (err) => {
      setConfirmAction(null);
      toast('error', extractApiErrorMessage(err, 'Échec de la suppression du laboratoire.'));
    },
  });

  if (isLoading || !user) return null;

  const status = lab?.status ?? 'ABSENT';
  const isGuest = user.role === 'GUEST';
  const meta = STATUS_META[status];

  return (
    <>
      <Card className="mb-7">
        <CardHeader
          title="Dispatching Cyber Range"
          description={isGuest ? undefined : 'Laboratoire de simulation.'}
          action={<Badge tone={meta.tone}>{meta.label}</Badge>}
        />

        {isGuest ? (
          <GuestView status={status} />
        ) : (
          <AdminView
            status={status}
            starting={startMutation.isPending}
            pausing={pauseMutation.isPending}
            resuming={resumeMutation.isPending}
            onStart={() => startMutation.mutate()}
            onStop={() => setConfirmAction('stop')}
            onPause={() => pauseMutation.mutate()}
            onResume={() => resumeMutation.mutate()}
            onDelete={() => setConfirmAction('delete')}
          />
        )}
      </Card>

      <ConfirmDialog
        open={confirmAction === 'stop'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => stopMutation.mutate()}
        title="Arrêter le laboratoire ?"
        description="Les services seront arrêtés mais vos données (projets SCADA) sont conservées — vous pourrez redémarrer plus tard."
        confirmLabel="Arrêter"
        danger={false}
        loading={stopMutation.isPending}
      />
      <ConfirmDialog
        open={confirmAction === 'delete'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => deleteMutation.mutate()}
        title="Supprimer le laboratoire ?"
        description="Cette action est irréversible : le laboratoire et toutes ses données seront définitivement supprimés."
        confirmLabel="Supprimer"
        danger
        loading={deleteMutation.isPending}
      />
    </>
  );
}

function GuestView({ status }: { status: LabStatus }) {
  if (status === 'RUNNING') {
    return (
      <p className="text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Le laboratoire est disponible — retrouvez les services dans le catalogue ci-dessous.
      </p>
    );
  }
  return (
    <EmptyState
      icon={<Server size={20} />}
      title="Laboratoire indisponible"
      description="Le laboratoire n'a pas encore été démarré par votre administrateur."
    />
  );
}

function AdminView({
  status,
  starting,
  pausing,
  resuming,
  onStart,
  onStop,
  onPause,
  onResume,
  onDelete,
}: {
  status: LabStatus;
  starting: boolean;
  pausing: boolean;
  resuming: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  if (status === 'ABSENT') {
    return (
      <EmptyState
        icon={<Server size={20} />}
        title="Aucun laboratoire actif"
        description="Démarrez une instance isolée du laboratoire Dispatching."
        action={
          <Button variant="primary" leftIcon={<Play size={15} />} loading={starting} onClick={onStart}>
            Démarrer la simulation
          </Button>
        }
      />
    );
  }

  if (status === 'CREATING' || status === 'STARTING' || status === 'STOPPING') {
    return (
      <p className="text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Opération en cours, merci de patienter…
      </p>
    );
  }

  if (status === 'ERROR') {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--red)' }}>
          <AlertTriangle size={16} /> Le laboratoire a rencontré une erreur.
        </p>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" leftIcon={<Trash2 size={14} />} onClick={onDelete}>
            Supprimer
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'STOPPED') {
    return (
      <div className="flex gap-2">
        <Button variant="primary" leftIcon={<RotateCw size={15} />} loading={starting} onClick={onStart}>
          Redémarrer
        </Button>
        <Button variant="danger" leftIcon={<Trash2 size={15} />} onClick={onDelete}>
          Supprimer
        </Button>
      </div>
    );
  }

  if (status === 'PAUSED') {
    return (
      <div className="flex gap-2">
        <Button variant="primary" leftIcon={<Play size={15} />} loading={resuming} onClick={onResume}>
          Reprendre
        </Button>
        <Button variant="danger" leftIcon={<Trash2 size={15} />} onClick={onDelete}>
          Supprimer
        </Button>
      </div>
    );
  }

  // RUNNING
  return (
    <div className="flex gap-2">
      <Button variant="secondary" leftIcon={<Pause size={15} />} loading={pausing} onClick={onPause}>
        Suspendre
      </Button>
      <Button variant="secondary" leftIcon={<Square size={15} />} onClick={onStop}>
        Arrêter
      </Button>
      <Button variant="danger" leftIcon={<Trash2 size={15} />} onClick={onDelete}>
        Supprimer
      </Button>
    </div>
  );
}
