import { useEffect, useRef, useCallback } from 'react';
import { useTrainStore } from '../store/useTrainStore.js';
import type { SystemSnapshot } from '../types/index.js';

function buildWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return `${configured}/ws`;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

const WS_URL = buildWsUrl();
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const PING_INTERVAL_MS = 25_000;

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY_MS);
  const unmountedRef = useRef(false);

  const { setWsStatus, applySnapshot } = useTrainStore();

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const startPingTimer = useCallback(() => {
    clearPingTimer();
    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_INTERVAL_MS);
  }, [clearPingTimer]);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setWsStatus('connecting');
    console.log(`[WS] Connecting to ${WS_URL}…`);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      setWsStatus('connected');
      reconnectDelay.current = RECONNECT_DELAY_MS;
      startPingTimer();
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as { type: string };
        if (msg.type === 'snapshot') {
          applySnapshot(msg as SystemSnapshot);
        }
        // pong: ignore (heartbeat ack)
      } catch {
        console.warn('[WS] Failed to parse message');
      }
    };

    ws.onclose = (event) => {
      console.log(`[WS] Closed (code=${event.code})`);
      clearPingTimer();
      wsRef.current = null;

      if (!unmountedRef.current) {
        setWsStatus('reconnecting');
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      console.error('[WS] Connection error');
      setWsStatus('offline');
      ws.close();
    };
  }, [setWsStatus, applySnapshot, startPingTimer, clearPingTimer]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;

    const delay = reconnectDelay.current;
    console.log(`[WS] Reconnecting in ${delay}ms…`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectDelay.current = Math.min(
        reconnectDelay.current * 1.5,
        MAX_RECONNECT_DELAY_MS,
      );
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearPingTimer();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close(1000, 'Component unmounted');
    };
  }, [connect, clearPingTimer]);
}
