import { UIAdapter, UIAdapterConfig } from './ui-adapter.js';
import { OrchestratorEvent } from '../events.js';
import { Storage } from '../storage.js';
import { WebSocket } from 'ws';
import express, { Express } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer } from 'ws';
import open from 'open';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleDir = __dirname;

export interface WebSocketUIAdapterConfig extends UIAdapterConfig {
  port?: number;
  autoOpen?: boolean;
}

export class WebSocketUIAdapter implements UIAdapter {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private port: number;
  private autoOpen: boolean;
  private storage?: Storage;
  private clients: Set<WebSocket>;
  private latestStateSyncEvent: OrchestratorEvent | null = null;
  private eventHistory: OrchestratorEvent[] = [];
  private readonly MAX_EVENT_HISTORY = 1000;
  private initialized = false;

  constructor(config: WebSocketUIAdapterConfig) {
    this.port = config.port || 3742;
    this.autoOpen = config.autoOpen ?? true;
    this.storage = config.storage;
    this.clients = new Set();

    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

    this.setupRoutes();
    this.setupWebSocket();
  }

  getName(): string {
    return 'WebSocket UI';
  }

  private setupRoutes(): void {
    const frontendDistPath = path.resolve(moduleDir, '../../frontend/dist');

    this.app.use(express.static(frontendDistPath));

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', clients: this.clients.size });
    });

    this.app.get(/.*/, (req, res) => {
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');
      this.clients.add(ws);

      if (this.storage && this.latestStateSyncEvent) {
        const syncEvent = this.latestStateSyncEvent as { plan?: { id: number } };
        if (syncEvent.plan && syncEvent.plan.id) {
          const executionState = this.storage.getExecutionState(syncEvent.plan.id);

          const freshStateSyncEvent = {
            type: 'state_sync',
            timestamp: Date.now(),
            plan: syncEvent.plan,
            steps: executionState.steps,
            iterations: executionState.iterations,
            issues: executionState.issues
          };

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(freshStateSyncEvent));
          }
        }
      }

      if (this.eventHistory.length > 0 && ws.readyState === WebSocket.OPEN) {
        const nonStateSyncEvents = this.eventHistory.filter(event => event.type !== 'state_sync');
        if (nonStateSyncEvents.length > 0) {
          console.log(`Replaying ${nonStateSyncEvents.length} cached events to new client`);
          nonStateSyncEvents.forEach(event => {
            ws.send(JSON.stringify(event));
          });
        }
      }

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, () => {
        const url = `http://localhost:${this.port}`;
        console.log(`\n${'═'.repeat(80)}`);
        console.log(`🎨 Stepcat Web UI is running at: ${url}`);
        console.log(`${'═'.repeat(80)}\n`);

        if (this.autoOpen) {
          open(url).catch(err => {
            console.warn('Could not automatically open browser:', err.message);
          });
        }

        this.initialized = true;
        resolve();
      });

      this.httpServer.on('error', reject);
    });
  }

  onEvent(event: OrchestratorEvent): void {
    if (event.type === 'state_sync') {
      this.latestStateSyncEvent = event;
    }

    const shouldStoreInHistory = event.type !== 'state_sync' &&
                                 event.type !== 'log' &&
                                 event.type !== 'github_check';

    if (shouldStoreInHistory) {
      this.eventHistory.push(event);
      if (this.eventHistory.length > this.MAX_EVENT_HISTORY) {
        this.eventHistory.shift();
      }
    }

    this.broadcast(event);
  }

  private broadcast(data: OrchestratorEvent): void {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async shutdown(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach(client => client.close());
      this.wss.close(() => {
        this.httpServer.close(() => {
          this.initialized = false;
          resolve();
        });
      });
    });
  }
}
