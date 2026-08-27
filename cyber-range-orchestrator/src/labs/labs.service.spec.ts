import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortIngress } from '../ingress/port-ingress';
import { LabsService } from './labs.service';
import type {
  LabInspection,
  LabRuntimeDriver,
  LabTemplate,
} from './runtime/lab-runtime.driver';

/**
 * Driver factice : `LabsService` est censé ne rien connaître du runtime, ces
 * tests le vérifient en le pilotant avec une implémentation qui n'exécute
 * aucune commande Docker.
 */
class FakeDriver implements LabRuntimeDriver {
  calls: string[] = [];
  inspection: LabInspection = { instance: 'running', components: [] };
  createImpl: () => Promise<void> = () => Promise.resolve();

  async create(labId: string): Promise<void> {
    this.calls.push(`create:${labId}`);
    await this.createImpl();
  }
  // Pas d'`async` sur ces méthodes : elles n'attendent rien, et la promesse
  // explicite suffit à honorer le contrat de `LabRuntimeDriver`.
  start(labId: string): Promise<void> {
    this.calls.push(`start:${labId}`);
    return Promise.resolve();
  }
  stop(labId: string): Promise<void> {
    this.calls.push(`stop:${labId}`);
    return Promise.resolve();
  }
  pause(labId: string): Promise<void> {
    this.calls.push(`pause:${labId}`);
    return Promise.resolve();
  }
  resume(labId: string): Promise<void> {
    this.calls.push(`resume:${labId}`);
    return Promise.resolve();
  }
  delete(labId: string): Promise<void> {
    this.calls.push(`delete:${labId}`);
    return Promise.resolve();
  }
  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
  inspect(): Promise<LabInspection> {
    return Promise.resolve(this.inspection);
  }
}

const TEMPLATE: LabTemplate = {
  labImage: 'talixman-lab-dispatching:latest',
  composeProfile: 'core',
  composeFile: '/lab/docker-compose.yml',
};

let root: string;
let stateFile: string;
let driver: FakeDriver;
let service: LabsService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'labs-spec-'));
  stateFile = join(root, 'state', 'labs.json');

  const templateDir = join(root, 'templates', 'dispatching');
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(
    join(templateDir, 'lab-template.json'),
    JSON.stringify(TEMPLATE),
  );
  writeFileSync(
    join(templateDir, 'lab-components.json'),
    JSON.stringify([
      {
        key: 'scada-station-a',
        label: 'SCADA Station A',
        port: 1881,
        service: 'scada_station_a',
      },
      {
        key: 'scada-scentral',
        label: 'SCADA Central',
        port: 1884,
        service: 'scada_scentral',
      },
    ]),
  );

  const values: Record<string, string> = {
    TEMPLATES_DIR: join(root, 'templates'),
    LABS_STATE_FILE: stateFile,
    GATEWAY_PUBLIC_HOST: 'range.example',
    LAB_INGRESS_PORT_MIN: '20000',
    LAB_INGRESS_PORT_MAX: '20009',
  };
  const config = {
    getOrThrow: (key: string) => values[key],
    get: (key: string, fallback: string) => values[key] ?? fallback,
  } as unknown as ConfigService;

  driver = new FakeDriver();
  // Stratégie d'exposition réelle (allocation de ports) : c'est elle qui
  // produit les URLs que le portail relaiera, autant la tester telle quelle.
  service = new LabsService(config, driver, new PortIngress(config));
});

function readState() {
  return JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<
    string,
    { template: string; createdAt: string; lastSeenAt?: string }
  >;
}

describe('createOrGet', () => {
  it('refuse un labId qui n’est pas un identifiant sûr', async () => {
    // Ce nom finit en argument de commandes Docker : la validation est une
    // barrière d'injection, pas seulement une contrainte de forme.
    await expect(
      service.createOrGet('../evil', 'dispatching'),
    ).rejects.toThrow();
    expect(driver.calls).toEqual([]);
  });

  it('rejette un template inexistant sans rien créer', async () => {
    await expect(service.createOrGet('lab-abc', 'inconnu')).rejects.toThrow(
      /Template inconnu/,
    );
    expect(driver.calls).toEqual([]);
  });

  it('ne crée qu’une seule fois pour deux appels concurrents', async () => {
    // Double-clic sur « Démarrer » pendant une création qui dure : sans le
    // verrou, deux `docker run --name <labId>` entreraient en conflit.
    let release: () => void = () => undefined;
    driver.createImpl = () => new Promise<void>((r) => (release = r));

    const first = service.createOrGet('lab-abc', 'dispatching');
    const second = service.createOrGet('lab-abc', 'dispatching');
    release();
    await Promise.all([first, second]);

    expect(driver.calls.filter((c) => c.startsWith('create:'))).toHaveLength(1);
  });

  it('ne laisse aucune entrée d’état si la création échoue', async () => {
    driver.createImpl = () => Promise.reject(new Error('boom'));

    await expect(
      service.createOrGet('lab-abc', 'dispatching'),
    ).rejects.toThrow();

    // Le driver est prié de nettoyer, et l'état ne doit pas référencer un labo
    // qui n'existe pas.
    expect(driver.calls).toContain('delete:lab-abc');
    expect(() => readState()).toThrow();
  });
});

describe('getStatus', () => {
  beforeEach(async () => {
    await service.createOrGet('lab-abc', 'dispatching');
  });

  it('renvoie ABSENT pour un labo inconnu', async () => {
    const status = await service.getStatus('lab-inconnu');
    expect(status).toEqual({
      labId: 'lab-inconnu',
      exists: false,
      status: 'ABSENT',
      services: [],
    });
  });

  it('donne à chaque composant sa PROPRE origine', async () => {
    // Le point crucial : les applications du labo construisent leurs URLs à la
    // racine, elles ne peuvent donc pas partager une origine sous un préfixe.
    const status = await service.getStatus('lab-abc');
    const urls = status.services.map((s) => s.url);

    expect(urls[0]).toMatch(/^http:\/\/range\.example:\d+$/);
    expect(new Set(urls).size).toBe(urls.length);
    urls.forEach((u) => expect(new URL(u).pathname).toBe('/'));
  });

  it('rapporte ERROR — et non ABSENT — si l’instance a disparu', async () => {
    // Distinction volontaire : ABSENT déclenche le nettoyage de la ligne Lab
    // côté portail. Un incident ne doit pas être confondu avec un arrêt normal.
    driver.inspection = { instance: 'absent', components: [] };

    const status = await service.getStatus('lab-abc');

    expect(status.status).toBe('ERROR');
    expect(status.exists).toBe(true);
  });

  it('rapporte STARTING tant que le démon du labo ne répond pas', async () => {
    driver.inspection = { instance: 'running', components: [] };
    expect((await service.getStatus('lab-abc')).status).toBe('STARTING');
  });

  it('rapporte RUNNING quand tous les composants tournent', async () => {
    driver.inspection = {
      instance: 'running',
      components: [
        { service: 'scada_station_a', state: 'running' },
        { service: 'scada_scentral', state: 'running' },
      ],
    };
    expect((await service.getStatus('lab-abc')).status).toBe('RUNNING');
  });

  it('rapporte ERROR dès qu’un composant est mort', async () => {
    driver.inspection = {
      instance: 'running',
      components: [
        { service: 'scada_station_a', state: 'running' },
        { service: 'scada_scentral', state: 'dead' },
      ],
    };
    expect((await service.getStatus('lab-abc')).status).toBe('ERROR');
  });

  it('rapporte PAUSED d’après l’instance, sans interroger les composants', async () => {
    driver.inspection = { instance: 'paused', components: [] };
    expect((await service.getStatus('lab-abc')).status).toBe('PAUSED');
  });

  it('marque un composant absent du compose comme non démarré', async () => {
    driver.inspection = {
      instance: 'running',
      components: [{ service: 'scada_station_a', state: 'running' }],
    };

    const status = await service.getStatus('lab-abc');
    const central = status.services.find((s) => s.name === 'scada-scentral');

    expect(central).toMatchObject({ state: 'absent', running: false });
  });

  it('enregistre la consultation dans lastSeenAt quand le marqueur a vieilli', async () => {
    // C'est ce marqueur qui empêche le reaper de faucher un labo consulté.
    // On antidate le labo pour sortir de la fenêtre anti-réécriture.
    const state = readState();
    state['lab-abc'].createdAt = new Date(Date.now() - 3_600_000).toISOString();
    writeFileSync(stateFile, JSON.stringify(state));

    await service.getStatus('lab-abc');

    const seen = readState()['lab-abc'].lastSeenAt;
    expect(seen).toBeDefined();
    expect(Date.now() - Date.parse(seen as string)).toBeLessThan(5_000);
  });

  it('ne réécrit pas l’état à chaque sondage rapproché', async () => {
    // Le portail sonde en boucle tant qu'un labo est affiché : sans ce
    // garde-fou, chaque sondage réécrirait le fichier d'état.
    const state = readState();
    const aged = new Date(Date.now() - 3_600_000).toISOString();
    state['lab-abc'].createdAt = aged;
    writeFileSync(stateFile, JSON.stringify(state));

    await service.getStatus('lab-abc');
    const first = readState()['lab-abc'].lastSeenAt;
    await service.getStatus('lab-abc');

    expect(readState()['lab-abc'].lastSeenAt).toBe(first);
  });
});

describe('delete', () => {
  it('retire l’entrée d’état après avoir détruit l’instance', async () => {
    await service.createOrGet('lab-abc', 'dispatching');

    await service.delete('lab-abc');

    expect(driver.calls).toContain('delete:lab-abc');
    expect(readState()['lab-abc']).toBeUndefined();
  });

  it('reste sans effet pour un labo inconnu', async () => {
    await expect(service.delete('lab-inconnu')).resolves.toBeUndefined();
    expect(driver.calls).toEqual([]);
  });
});

describe('listIngressRoutes', () => {
  it('décrit chaque point d’entrée avec sa cible interne', async () => {
    await service.createOrGet('lab-abc', 'dispatching');

    const routes = service.listIngressRoutes();

    expect(routes).toHaveLength(2);
    const central = routes.find((r) => r.component === 'scada-scentral');
    // La cible reste le conteneur du labo (résolu par le DNS Docker) sur le
    // port interne du composant — inchangé par la stratégie d'exposition.
    expect(central?.target).toEqual({ host: 'lab-abc', port: 1884 });
    expect(central?.binding.port).toBeGreaterThanOrEqual(20000);
  });

  it('n’expose rien tant qu’aucun labo n’existe', () => {
    expect(service.listIngressRoutes()).toEqual([]);
  });

  it('n’attribue jamais le même port à deux labos', async () => {
    await service.createOrGet('lab-abc', 'dispatching');
    await service.createOrGet('lab-def', 'dispatching');

    const ports = service.listIngressRoutes().map((r) => r.binding.port);

    expect(ports).toHaveLength(4);
    expect(new Set(ports).size).toBe(4);
  });

  it('libère les ports d’un labo supprimé au profit du suivant', async () => {
    await service.createOrGet('lab-abc', 'dispatching');
    const before = service.listIngressRoutes().map((r) => r.binding.port);
    await service.delete('lab-abc');
    await service.createOrGet('lab-def', 'dispatching');

    const after = service.listIngressRoutes().map((r) => r.binding.port);

    // Sans réutilisation, la plage s'épuiserait au fil des créations.
    expect(after).toEqual(before);
  });

  it('échoue explicitement quand la plage est épuisée', async () => {
    // 10 ports configurés, 2 composants par labo -> le 6e labo déborde.
    for (let i = 0; i < 5; i++) {
      await service.createOrGet(`lab-${i}`, 'dispatching');
    }
    await expect(
      service.createOrGet('lab-trop', 'dispatching'),
    ).rejects.toThrow(/port d'exposition disponible/);
  });
});
