import { useEffect, useRef, useState } from 'react';
import { OrchestratorEvent } from '../types/events';

interface UseWebSocketResult {
  isConnected: boolean;
  events: OrchestratorEvent[];
}

const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket(onEvent: (event: OrchestratorEvent) => void): UseWebSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<OrchestratorEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const connectRef = useRef<() => void>(() => {});

  // Keep a stable reference to the event handler to avoid reconnects on re-render
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const isViteDev = window.location.port === '5173';
      const hostname = window.location.hostname;
      const port = isViteDev ? '3742' : (window.location.port || (protocol === 'wss:' ? '443' : '80'));
      const url = `${protocol}//${hostname}:${port}/ws`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('Connected to Stepcat');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onclose = () => {
        console.log('Disconnected from Stepcat');
        setIsConnected(false);

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectTimeoutRef.current = window.setTimeout(() => connectRef.current(), delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as OrchestratorEvent;
          setEvents((prev) => [...prev, data]);
          onEventRef.current(data);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      wsRef.current = ws;
    };

    connectRef.current = connect;
    connect();

    return () => {
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return { isConnected, events };
}
