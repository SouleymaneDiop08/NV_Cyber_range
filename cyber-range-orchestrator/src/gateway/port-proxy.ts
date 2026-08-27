import { Logger } from '@nestjs/common';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { IngressRoute } from '../labs/labs.service';

/**
 * Côté gateway de la stratégie « une origine = un port » (cf. PortIngress).
 *
 * Pour chaque port alloué à un composant, on ouvre un serveur HTTP dédié qui
 * proxifie TOUT vers `http://<labId>:<port interne>`. L'application du labo se
 * voit donc à la racine d'une origine à elle : ses `<base href="/">`, ses
 * redirections `Location: /login`, ses appels `/api/...` et ses WebSockets
 * fonctionnent sans aucune réécriture de chemin — ce que le proxy par préfixe
 * (`/apps/<labo>/<composant>/`) ne pouvait structurellement pas offrir.
 *
 * Les points d'entrée sont synchronisés périodiquement avec l'état des labos :
 * le rôle `control` écrit l'état, celui-ci le lit (en lecture seule) et ouvre
 * ou ferme ses serveurs au fil des créations et suppressions.
 */
export class LabPortProxy {
  private readonly logger = new Logger(LabPortProxy.name);
  /** port public -> serveur ouvert + cible servie (pour détecter un changement). */
  private readonly listeners = new Map<
    number,
    { server: Server; target: string }
  >();

  constructor(
    private readonly listRoutes: () => IngressRoute[],
    private readonly intervalMs: number,
  ) {}

  start(): NodeJS.Timeout {
    this.sync();
    const timer = setInterval(() => this.sync(), this.intervalMs);
    // Ne doit pas retenir le processus à lui seul lors d'un arrêt propre.
    timer.unref();
    return timer;
  }

  private sync(): void {
    let routes: IngressRoute[];
    try {
      routes = this.listRoutes();
    } catch (err) {
      // État illisible (écriture concurrente du rôle `control`, fichier absent
      // au démarrage…) : on garde les points d'entrée actuels plutôt que de
      // couper l'accès aux labos en cours d'utilisation.
      this.logger.warn(
        `Lecture des routes impossible, points d'entrée inchangés : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    const wanted = new Map<number, string>();
    for (const route of routes) {
      // Cette stratégie ne sert que les liaisons par port ; une liaison par nom
      // d'hôte (future stratégie) est ignorée ici, sans erreur.
      if (route.binding.port === undefined) continue;
      wanted.set(
        route.binding.port,
        `http://${route.target.host}:${route.target.port}`,
      );
    }

    // Fermer ce qui n'a plus lieu d'être, ou dont la cible a changé (un labo
    // détruit puis recréé peut réutiliser le même port pour un autre composant).
    for (const [port, entry] of this.listeners) {
      if (wanted.get(port) === entry.target) continue;
      entry.server.close();
      this.listeners.delete(port);
      this.logger.log(`Point d'entrée fermé sur le port ${port}`);
    }

    for (const [port, target] of wanted) {
      if (this.listeners.has(port)) continue;
      this.open(port, target);
    }
  }

  private open(port: number, target: string): void {
    // `ws: true` est indispensable : le temps réel de FUXA et le noVNC des
    // postes passent par WebSocket.
    const proxy = createProxyMiddleware({
      target,
      ws: true,
      changeOrigin: true,
    });

    // http-proxy-middleware est typé pour Express, mais fonctionne sur les
    // objets `http` bruts — ce point d'entrée n'a besoin d'aucune couche
    // Express, il proxifie tout sans routage ni réécriture.
    const handle = proxy as unknown as (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void,
    ) => void;

    const server = createServer((req, res) =>
      handle(req, res, () => {
        res.statusCode = 502;
        res.end('Composant de laboratoire injoignable.');
      }),
    );
    if (proxy.upgrade) server.on('upgrade', proxy.upgrade);

    server.on('error', (err) => {
      this.logger.error(`Point d'entrée ${port} en erreur : ${err.message}`);
      server.close();
      this.listeners.delete(port);
    });

    server.listen(port, () => {
      this.logger.log(`Point d'entrée ouvert : ${port} -> ${target}`);
    });
    this.listeners.set(port, { server, target });
  }
}
