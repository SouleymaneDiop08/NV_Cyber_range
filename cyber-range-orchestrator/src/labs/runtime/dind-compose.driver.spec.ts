import { ConfigService } from '@nestjs/config';
import { DindComposeDriver } from './dind-compose.driver';
import type { LabTemplate } from './lab-runtime.driver';

/**
 * `promisify(execFile)` est résolu à l'import du driver : le mock doit donc
 * porter le symbole `promisify.custom`, sinon promisify enveloppe le mock en
 * style callback et ne restitue que `stdout` au lieu de `{ stdout, stderr }`.
 */
const mockExec = jest.fn();

jest.mock('node:child_process', () => {
  const util = jest.requireActual<typeof import('node:util')>('node:util');
  return {
    execFile: Object.assign(jest.fn(), {
      // Retour typé `unknown` : c'est le mock lui-même qui décide de la valeur
      // résolue dans chaque test.
      [util.promisify.custom]: (...args: unknown[]): unknown =>
        mockExec(...args),
    }),
  };
});

const TEMPLATE: LabTemplate = {
  labImage: 'talixman-lab-dispatching:latest',
  composeProfile: 'core',
  composeFile: '/lab/docker-compose.yml',
};

/** Config minimale : uniquement les valeurs par défaut du driver. */
function makeDriver(overrides: Record<string, string> = {}): DindComposeDriver {
  const config = {
    get: (key: string, fallback: string) => overrides[key] ?? fallback,
  } as unknown as ConfigService;
  return new DindComposeDriver(config);
}

/** Arguments docker du n-ième appel (le 1er argument est toujours `docker`). */
function argsOfCall(index: number): string[] {
  const calls = mockExec.mock.calls as unknown as unknown[][];
  return calls[index][1] as string[];
}

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockResolvedValue({ stdout: '', stderr: '' });
});

describe('create', () => {
  it('crée un volume labellisé avant de lancer le conteneur', async () => {
    await makeDriver().create('lab-abc123', TEMPLATE);

    expect(argsOfCall(0)).toEqual([
      'volume',
      'create',
      '--label',
      'talixman.lab=lab-abc123',
      'lab-data-lab-abc123',
    ]);
  });

  it('applique réseau, volume, quotas, profil et image au conteneur', async () => {
    await makeDriver().create('lab-abc123', TEMPLATE);
    const args = argsOfCall(1);

    expect(args.slice(0, 4)).toEqual(['run', '-d', '--name', 'lab-abc123']);
    // Réseau dédié aux labos : c'est lui qui les tient à l'écart du réseau du
    // portail (Postgres/Redis/Keycloak).
    expect(args).toContain('talixman_labs');
    expect(args).toContain(
      'lab-data-lab-abc123:/home/rootless/.local/share/docker',
    );
    expect(args).toContain('--memory');
    expect(args).toContain('--pids-limit');
    expect(args).toContain('COMPOSE_PROFILES=core');
    // L'image doit rester le DERNIER argument, sinon docker la prendrait pour
    // une option et les arguments suivants pour la commande du conteneur.
    expect(args[args.length - 1]).toBe('talixman-lab-dispatching:latest');
  });

  it('ne publie aucun port sur l’hôte', async () => {
    await makeDriver().create('lab-abc123', TEMPLATE);
    const args = argsOfCall(1);

    // Les composants ne doivent être joignables que par la gateway du
    // middleware — jamais directement depuis l'hôte.
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--publish');
  });

  it('supprime le volume si le lancement du conteneur échoue', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // volume create
      .mockRejectedValueOnce(new Error('boom')); // run

    await expect(makeDriver().create('lab-abc123', TEMPLATE)).rejects.toThrow();

    // Sans ce nettoyage, chaque création ratée laisserait un volume orphelin.
    expect(argsOfCall(2)).toEqual([
      'volume',
      'rm',
      '-f',
      'lab-data-lab-abc123',
    ]);
  });

  it('bascule sur un confinement sans --privileged quand demandé', async () => {
    await makeDriver({ LAB_PRIVILEGED: 'false' }).create(
      'lab-abc123',
      TEMPLATE,
    );
    const args = argsOfCall(1);

    expect(args).not.toContain('--privileged');
    expect(args).toContain('seccomp=unconfined');
    expect(args).toContain('/dev/fuse');
  });
});

describe('delete', () => {
  it('retire le conteneur avec ses volumes anonymes ET le volume nommé', async () => {
    await makeDriver().delete('lab-abc123');

    // Régression : `docker rm -f` seul laissait plusieurs Go derrière chaque
    // labo supprimé (volumes anonymes de l'image dind + volume de données).
    expect(argsOfCall(0)).toEqual(['rm', '-f', '-v', 'lab-abc123']);
    expect(argsOfCall(1)).toEqual([
      'volume',
      'rm',
      '-f',
      'lab-data-lab-abc123',
    ]);
  });

  it('reste idempotent si le labo a déjà disparu', async () => {
    mockExec.mockRejectedValue(new Error('No such container'));

    await expect(makeDriver().delete('lab-abc123')).resolves.toBeUndefined();
  });
});

describe('inspect', () => {
  it('ne consulte pas le compose si l’instance n’est pas démarrée', async () => {
    mockExec.mockResolvedValueOnce({ stdout: 'exited|false', stderr: '' });

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result).toEqual({ instance: 'exited', components: [] });
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('rapporte `absent` quand le conteneur n’existe plus', async () => {
    mockExec.mockRejectedValueOnce(new Error('No such object'));

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result.instance).toBe('absent');
  });

  it('rapporte `paused` même si le statut brut dit `running`', async () => {
    mockExec.mockResolvedValueOnce({ stdout: 'running|true', stderr: '' });

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result.instance).toBe('paused');
  });

  it('lit les composants quand le compose répond un tableau JSON', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'running|false', stderr: '' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { Service: 'plc_station_a', State: 'running' },
          { Service: 'scada_scentral', State: 'exited' },
        ]),
        stderr: '',
      });

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result.components).toEqual([
      { service: 'plc_station_a', state: 'running' },
      { service: 'scada_scentral', state: 'exited' },
    ]);
  });

  it('lit les composants au format JSON Lines', async () => {
    // Selon la version du plugin compose embarquée dans l'image de labo, la
    // sortie est un tableau ou une ligne JSON par conteneur.
    mockExec
      .mockResolvedValueOnce({ stdout: 'running|false', stderr: '' })
      .mockResolvedValueOnce({
        stdout:
          '{"Service":"plc_station_a","State":"running"}\n' +
          '{"Service":"router_r1_r3","State":"running"}\n',
        stderr: '',
      });

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result.components).toHaveLength(2);
    expect(result.components[1]).toEqual({
      service: 'router_r1_r3',
      state: 'running',
    });
  });

  it('traite un démon interne pas encore prêt comme « aucun composant »', async () => {
    // Le conteneur tourne mais son démon démarre encore : `docker exec` échoue.
    // LabsService en déduit STARTING plutôt qu'une erreur.
    mockExec
      .mockResolvedValueOnce({ stdout: 'running|false', stderr: '' })
      .mockRejectedValueOnce(new Error('daemon not ready'));

    const result = await makeDriver().inspect('lab-abc123', TEMPLATE);

    expect(result).toEqual({ instance: 'running', components: [] });
  });
});
