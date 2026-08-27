import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, Eye, Factory, Gauge, LayoutGrid, Monitor, Skull, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCardGrid } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { LabCard } from '../components/lab/LabCard';
import { listMyServices, type Service, type ServiceCategory } from '../lib/api';
import { useMyLab } from '../lib/use-my-lab';

const LAB_STATUS_MESSAGES: Record<string, string> = {
  absent: "Le laboratoire n'a pas encore été démarré par votre administrateur.",
  not_running: 'Le laboratoire est arrêté — demandez à votre administrateur de le redémarrer.',
};

const CATEGORY_META: Record<ServiceCategory, { icon: LucideIcon; color: string; label: string }> = {
  WORKSTATION: { icon: Monitor, color: '#6b7fd7', label: 'Workstation' },
  ATTACKER: { icon: Skull, color: '#e05252', label: 'Attacker' },
  SUPERVISION: { icon: Gauge, color: '#3aa8a0', label: 'Supervision' },
  AUTOMATE: { icon: Bot, color: '#e8792a', label: 'Automate' },
  TERRAIN: { icon: Factory, color: '#a45a8a', label: 'Terrain' },
};
const DEFAULT_META = { icon: LayoutGrid, color: '#8892a0', label: 'Service' };

function launch(service: Service) {
  // Passe toujours par le backend : pour un service SSO (ssoTarget renseigné) il orchestre le
  // pont Keycloak avant de rediriger ; sinon il redirige directement vers launchUrl, comme
  // avant. Le frontend n'a pas besoin de distinguer les deux cas.
  const launchEndpoint = `${import.meta.env.VITE_API_URL}/me/services/${service.id}/launch`;
  window.open(launchEndpoint, '_blank', 'noopener,noreferrer');
}

function ServiceCard({ service, index, available }: { service: Service; index: number; available: boolean }) {
  const meta = service.category ? CATEGORY_META[service.category] : DEFAULT_META;
  const Icon = meta.icon;
  // Tant que le laboratoire n'est pas RUNNING, aucune carte n'est cliquable :
  // couleur neutre (grisâtre), badge "Indisponible", pas d'effet hover/lancement.
  const color = available ? meta.color : 'var(--text-dim)';
  return (
    <button
      type="button"
      onClick={available ? () => launch(service) : undefined}
      disabled={!available}
      aria-disabled={!available}
      style={{ borderColor: 'var(--border)', background: 'var(--panel)', animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={`group animate-slide-up relative overflow-hidden rounded-[var(--radius-xl)] border p-6 text-left shadow-[var(--shadow-sm)] transition-all duration-[var(--dur-base)] ease-[var(--ease-out)] ${
        available
          ? 'cursor-pointer hover:-translate-y-1.5 hover:shadow-[var(--shadow-md)] focus-visible:-translate-y-1.5'
          : 'cursor-not-allowed grayscale opacity-60'
      }`}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }}
      />
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity duration-[var(--dur-slow)] group-hover:opacity-35"
        style={{ background: color }}
      />
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-[var(--dur-base)] group-hover:-rotate-6 group-hover:scale-110"
            style={{ background: `${color}26`, color }}
          >
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
          </div>
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase"
            style={{ borderColor: `${color}70`, color, background: `${color}1f` }}
          >
            {meta.label}
          </span>
        </div>
        <div>
          <p className="m-0 text-[17.5px] font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
            {service.name}
          </p>
          {service.accessLevel === 'VIEW_ONLY' && (
            <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
              <Eye size={12} aria-hidden="true" />
              Vue seule
            </div>
          )}
        </div>
        <p className="flex-1 text-[13px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
          {service.description || 'Aucune description.'}
        </p>
        <div
          className="flex items-center justify-between border-t pt-3 font-mono text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
        >
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: available ? 'var(--success)' : 'var(--text-dim)' }} />
            {available ? 'Disponible' : 'Indisponible'}
          </span>
          {available && (
            <span
              className="flex translate-x-[-6px] items-center gap-1 font-bold uppercase opacity-0 transition-all duration-[var(--dur-base)] group-hover:translate-x-0 group-hover:opacity-100"
              style={{ color }}
            >
              Lancer <ArrowRight size={12} aria-hidden="true" />
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function PortailPage() {
  const { data: services, isLoading } = useQuery({ queryKey: ['me', 'services'], queryFn: listMyServices });
  // Même hook que LabCard.tsx — cache partagé, une seule requête réseau, et
  // surtout la même politique de rafraîchissement. Détermine si les cartes de
  // service ci-dessous sont cliquables ou grisées (cf. ServiceCard) : c'est ce
  // qui les grise tout seules quand l'ADMIN arrête le labo, y compris sur
  // l'écran d'un GUEST qui n'a rien fait.
  const { data: lab } = useMyLab();
  const isLabRunning = lab?.status === 'RUNNING';
  const [activeCategory, setActiveCategory] = useState<ServiceCategory | 'TOUS'>('TOUS');
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  // Retour de /me/services/:id/launch quand le labo n'est pas prêt (cf. me.controller.ts) —
  // même formulation que l'état "non démarré" de LabCard.tsx, retirée de l'URL après lecture
  // pour ne pas la réafficher à un rafraîchissement de page.
  useEffect(() => {
    const labStatus = searchParams.get('labStatus');
    if (!labStatus) return;
    toast('info', LAB_STATUS_MESSAGES[labStatus] ?? "Le laboratoire n'est pas disponible pour le moment.");
    const next = new URLSearchParams(searchParams);
    next.delete('labStatus');
    setSearchParams(next, { replace: true });
  }, [searchParams, toast, setSearchParams]);

  const categoriesPresent = useMemo(() => {
    const set = new Set<ServiceCategory>();
    (services ?? []).forEach((s) => s.category && set.add(s.category));
    return Array.from(set);
  }, [services]);

  const filtered = (services ?? []).filter(
    (s) => activeCategory === 'TOUS' || s.category === activeCategory,
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        Portail
      </h1>
      <p className="mb-6 text-[13.5px]" style={{ color: 'var(--text-dim)' }}>
        Vos environnements de simulation disponibles.
      </p>

      <LabCard />

      {categoriesPresent.length > 0 && (
        <div className="mb-7 flex flex-wrap gap-2.5">
          {(['TOUS', ...categoriesPresent] as const).map((c) => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className="rounded-full border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wide transition-colors duration-[var(--dur-fast)]"
              style={{
                borderColor: activeCategory === c ? 'var(--orange)' : 'var(--border-strong)',
                background: activeCategory === c ? 'var(--orange)' : 'var(--panel2)',
                color: activeCategory === c ? '#fff' : 'var(--text-dim)',
              }}
              aria-pressed={activeCategory === c}
            >
              {c === 'TOUS' ? 'Tous' : CATEGORY_META[c].label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <SkeletonCardGrid count={6} />}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon={<LayoutGrid size={20} />}
          title="Aucun service disponible"
          description="Aucun service n'est pour le moment accessible pour votre secteur."
        />
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((service, index) => (
          <ServiceCard key={service.id} service={service} index={index} available={isLabRunning} />
        ))}
      </div>
    </div>
  );
}
