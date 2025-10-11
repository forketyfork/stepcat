import express, { Express } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { OrchestratorEventEmitter, OrchestratorEvent } from './events.js';
import { Storage } from './storage.js';
import { Iteration, Issue } from './models.js';
import open from 'open';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const moduleDir = (() => {
  try {
    const url = new Function('return import.meta.url')() as string;
    return dirname(fileURLToPath(url));
  } catch {
    return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  }
})();

export interface WebServerConfig {
  port?: number;
  eventEmitter: OrchestratorEventEmitter;
  autoOpen?: boolean;
  storage?: Storage;
}

export class WebServer {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private port: number;
  private clients: Set<WebSocket>;
  private eventEmitter: OrchestratorEventEmitter;
  private autoOpen: boolean;
  private storage?: Storage;
  private latestStateSyncEvent: OrchestratorEvent | null = null;
  private eventHistory: OrchestratorEvent[] = [];
  private readonly MAX_EVENT_HISTORY = 1000;

  constructor(config: WebServerConfig) {
    this.port = config.port || 3742;
    this.eventEmitter = config.eventEmitter;
    this.autoOpen = config.autoOpen ?? true;
    this.storage = config.storage;
    this.clients = new Set();

    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupRoutes(): void {
    const frontendDistPath = path.resolve(moduleDir, '../frontend/dist');

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
          const steps = this.storage.getSteps(syncEvent.plan.id);
          const allIterations: Iteration[] = [];
          const allIssues: Issue[] = [];

          steps.forEach(step => {
            const iterations = this.storage!.getIterations(step.id);
            allIterations.push(...iterations);
            iterations.forEach(iteration => {
              const issues = this.storage!.getIssues(iteration.id);
              allIssues.push(...issues);
            });
          });

          const freshStateSyncEvent = {
            type: 'state_sync',
            timestamp: Date.now(),
            plan: syncEvent.plan,
            steps,
            iterations: allIterations,
            issues: allIssues
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

    this.eventEmitter.on('event', (event: OrchestratorEvent) => {
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
    });
  }

  private broadcast(data: OrchestratorEvent): void {
    const message = JSON.stringify(data);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async start(): Promise<string> {
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

        resolve(url);
      });

      this.httpServer.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach(client => client.close());
      this.wss.close(() => {
        this.httpServer.close(() => {
          resolve();
        });
      });
    });
  }
}
