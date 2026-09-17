import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'http';
import type { SystemSnapshot } from '../types/index.js';

export class WsBroadcaster {
  private wss: WebSocketServer;
  private lastSnapshot: SystemSnapshot | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupHandlers();
    this.startPingLoop();
    console.log('[WS] WebSocket server initialized on /ws');
  }

  private setupHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip = req.socket.remoteAddress ?? 'unknown';
      console.log(`[WS] Client connected: ${ip} (total=${this.wss.clients.size})`);

      // Send current state immediately on connect
      if (this.lastSnapshot) {
        this.sendTo(ws, this.lastSnapshot);
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${ip} (total=${this.wss.clients.size})`);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error: ${err.message}`);
      });
    });
  }

  private startPingLoop(): void {
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      });
    }, 30_000);
  }

  broadcast(snapshot: SystemSnapshot): void {
    this.lastSnapshot = snapshot;
    const payload = JSON.stringify(snapshot);
    let sent = 0;

    this.wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent++;
      }
    });

    if (sent > 0) {
      // debug log (comment out in production)
      // console.debug(`[WS] Broadcast to ${sent} client(s) — latency=${snapshot.poll_latency_ms}ms`);
    }
  }

  private sendTo(ws: WebSocket, snapshot: SystemSnapshot): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(snapshot));
    }
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.wss.close();
  }
}
