import express, { Express } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { OrchestratorEventEmitter, OrchestratorEvent } from './events';
import { Database } from './database';
import { Iteration, Issue } from './models';
import open from 'open';

export interface WebServerConfig {
  port?: number;
  eventEmitter: OrchestratorEventEmitter;
  autoOpen?: boolean;
  database?: Database;
}

export class WebServer {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private port: number;
  private clients: Set<WebSocket>;
  private eventEmitter: OrchestratorEventEmitter;
  private autoOpen: boolean;
  private database?: Database;
  private latestStateSyncEvent: OrchestratorEvent | null = null;
  private eventHistory: OrchestratorEvent[] = [];
  private readonly MAX_EVENT_HISTORY = 1000;

  constructor(config: WebServerConfig) {
    this.port = config.port || 3742;
    this.eventEmitter = config.eventEmitter;
    this.autoOpen = config.autoOpen ?? true;
    this.database = config.database;
    this.clients = new Set();

    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupRoutes(): void {
    this.app.get('/', (req, res) => {
      res.send(this.getHTML());
    });

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', clients: this.clients.size });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');
      this.clients.add(ws);

      if (this.database && this.latestStateSyncEvent) {
        const syncEvent = this.latestStateSyncEvent as { plan?: { id: number } };
        if (syncEvent.plan && syncEvent.plan.id) {
          const steps = this.database.getSteps(syncEvent.plan.id);
          const allIterations: Iteration[] = [];
          const allIssues: Issue[] = [];

          steps.forEach(step => {
            const iterations = this.database!.getIterations(step.id);
            allIterations.push(...iterations);
            iterations.forEach(iteration => {
              const issues = this.database!.getIssues(iteration.id);
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

  private getHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stepcat - Agent Orchestration</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --purple-50: #faf5ff;
      --purple-100: #f3e8ff;
      --purple-200: #e9d5ff;
      --purple-300: #d8b4fe;
      --purple-400: #c084fc;
      --purple-500: #a855f7;
      --purple-600: #9333ea;
      --purple-700: #7e22ce;
      --purple-800: #6b21a8;

      --pink-100: #fce7f3;
      --pink-200: #fbcfe8;
      --pink-300: #f9a8d4;

      --blue-100: #dbeafe;
      --blue-200: #bfdbfe;

      --green-100: #dcfce7;
      --green-500: #22c55e;

      --red-100: #fee2e2;
      --red-500: #ef4444;

      --orange-100: #ffedd5;
      --orange-500: #f97316;

      --gray-50: #f9fafb;
      --gray-100: #f3f4f6;
      --gray-200: #e5e7eb;
      --gray-300: #d1d5db;
      --gray-600: #4b5563;
      --gray-700: #374151;
      --gray-800: #1f2937;
      --gray-900: #111827;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, var(--purple-50) 0%, var(--pink-100) 50%, var(--blue-100) 100%);
      min-height: 100vh;
      padding: 2rem;
      color: var(--gray-900);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      margin-bottom: 3rem;
      animation: fadeInDown 0.6s ease-out;
    }

    h1 {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--purple-600) 0%, var(--purple-400) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
      text-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .subtitle {
      font-size: 1.2rem;
      color: var(--gray-600);
      font-weight: 500;
    }

    .status-banner {
      background: white;
      border-radius: 1rem;
      padding: 1.5rem 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      display: flex;
      justify-content: space-between;
      align-items: center;
      animation: fadeInUp 0.6s ease-out;
      border: 2px solid var(--purple-200);
    }

    .status-item {
      text-align: center;
      padding: 0 2rem;
    }

    .status-item:not(:last-child) {
      border-right: 2px solid var(--purple-100);
    }

    .status-label {
      font-size: 0.875rem;
      color: var(--gray-600);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .status-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--purple-600);
    }

    .connection-status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--green-100);
      color: var(--green-500);
      border-radius: 2rem;
      font-weight: 600;
      font-size: 0.875rem;
      animation: pulse 2s ease-in-out infinite;
    }

    .connection-status.disconnected {
      background: var(--red-100);
      color: var(--red-500);
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }

    .steps-container {
      display: grid;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .step-card {
      background: white;
      border-radius: 1rem;
      padding: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border: 2px solid var(--purple-100);
      transition: all 0.3s ease;
      opacity: 0;
      animation: fadeInUp 0.6s ease-out forwards;
    }

    .step-card.active {
      border-color: var(--purple-400);
      box-shadow: 0 10px 15px -3px rgba(139, 92, 246, 0.2), 0 4px 6px -2px rgba(139, 92, 246, 0.1);
      transform: scale(1.02);
    }

    .step-card.completed {
      border-color: var(--green-500);
      opacity: 0.9;
    }

    .step-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .step-number {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      background: var(--purple-100);
      color: var(--purple-700);
      flex-shrink: 0;
    }

    .step-card.active .step-number {
      background: var(--purple-500);
      color: white;
      animation: pulse 2s ease-in-out infinite;
    }

    .step-card.completed .step-number {
      background: var(--green-500);
      color: white;
    }

    .step-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--gray-800);
      flex: 1;
    }

    .step-status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--purple-100);
      color: var(--purple-700);
      border-radius: 2rem;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .phases {
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
    }

    .phase {
      background: var(--gray-50);
      border-radius: 0.75rem;
      padding: 1rem 1.5rem;
      border: 2px solid var(--gray-200);
      transition: all 0.3s ease;
    }

    .phase.active {
      background: var(--purple-50);
      border-color: var(--purple-300);
    }

    .phase.completed {
      background: var(--green-100);
      border-color: var(--green-500);
    }

    .phase.warning {
      background: var(--orange-100);
      border-color: var(--orange-500);
    }

    .phase-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 600;
      color: var(--gray-700);
    }

    .phase.active .phase-header {
      color: var(--purple-700);
    }

    .phase.completed .phase-header {
      color: var(--green-500);
    }

    .phase.warning .phase-header {
      color: var(--orange-500);
    }

    .phase-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--gray-300);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
    }

    .phase.active .phase-icon {
      background: var(--purple-500);
      color: white;
      animation: spin 2s linear infinite;
    }

    .phase.completed .phase-icon {
      background: var(--green-500);
      color: white;
    }

    .phase.warning .phase-icon {
      background: var(--orange-500);
      color: white;
    }

    .step-header-clickable {
      cursor: pointer;
      user-select: none;
    }

    .step-header-clickable:hover {
      opacity: 0.8;
    }

    .step-meta {
      font-size: 0.875rem;
      color: var(--gray-600);
      font-weight: 500;
    }

    .iterations-container {
      margin-top: 1.5rem;
      padding-left: 2rem;
      border-left: 3px solid var(--purple-200);
      display: none;
    }

    .iterations-container.expanded {
      display: block;
    }

    .iteration {
      background: var(--gray-50);
      border-radius: 0.75rem;
      padding: 1rem 1.5rem;
      margin-bottom: 1rem;
      border: 2px solid var(--gray-200);
      transition: all 0.3s ease;
    }

    .iteration.in_progress {
      background: var(--blue-100);
      border-color: var(--purple-300);
    }

    .iteration.completed {
      background: var(--green-100);
      border-color: var(--green-500);
      opacity: 0.8;
    }

    .iteration.failed {
      background: var(--red-100);
      border-color: var(--red-500);
    }

    .iteration-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      font-weight: 600;
      color: var(--gray-700);
      cursor: pointer;
      user-select: none;
    }

    .iteration-header:hover {
      opacity: 0.8;
    }

    .iteration-title {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .iteration-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--gray-300);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      color: white;
    }

    .iteration.in_progress .iteration-icon {
      background: var(--purple-500);
      animation: spin 2s linear infinite;
    }

    .iteration.completed .iteration-icon {
      background: var(--green-500);
    }

    .iteration.failed .iteration-icon {
      background: var(--red-500);
    }

    .iteration-type {
      padding: 0.25rem 0.75rem;
      background: var(--purple-100);
      color: var(--purple-700);
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .commit-sha {
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 0.75rem;
      background: var(--gray-200);
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      color: var(--gray-700);
    }

    .issues-container {
      margin-top: 1rem;
      padding-left: 1.5rem;
      border-left: 2px solid var(--gray-300);
      display: none;
    }

    .issues-container.expanded {
      display: block;
    }

    .issue {
      background: white;
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      border: 2px solid var(--gray-200);
      transition: all 0.2s ease;
      animation: slideInRight 0.3s ease-out;
    }

    .issue.open {
      border-color: var(--red-300);
      background: var(--red-50);
    }

    .issue.fixed {
      border-color: var(--green-300);
      background: var(--green-50);
      opacity: 0.7;
    }

    .issue:hover {
      transform: translateX(4px);
    }

    .issue-header {
      display: flex;
      align-items: start;
      gap: 0.75rem;
    }

    .issue-severity {
      font-size: 1.2rem;
      flex-shrink: 0;
    }

    .issue-content {
      flex: 1;
    }

    .issue-description {
      font-size: 0.875rem;
      color: var(--gray-700);
      margin-bottom: 0.5rem;
      line-height: 1.5;
    }

    .issue-location {
      font-size: 0.75rem;
      color: var(--gray-600);
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      background: var(--gray-100);
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      display: inline-block;
    }

    .issue-status {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      margin-left: 0.5rem;
    }

    .issue-status.open {
      background: var(--red-100);
      color: var(--red-700);
    }

    .issue-status.fixed {
      background: var(--green-100);
      color: var(--green-700);
    }

    .expand-icon {
      transition: transform 0.3s ease;
      font-size: 1rem;
      color: var(--gray-600);
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .github-status {
      background: white;
      border-radius: 1rem;
      padding: 1.5rem 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border: 2px solid var(--purple-100);
      animation: fadeInUp 0.6s ease-out;
      display: none;
    }

    .github-status.visible {
      display: block;
    }

    .github-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .github-icon {
      width: 32px;
      height: 32px;
      background: var(--purple-500);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
    }

    .github-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--gray-800);
    }

    .github-info {
      font-size: 0.875rem;
      color: var(--gray-600);
      margin-top: 0.5rem;
    }

    .logs-container {
      background: white;
      border-radius: 1rem;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border: 2px solid var(--purple-100);
      max-height: 600px;
      overflow-y: auto;
      animation: fadeInUp 0.6s ease-out;
    }

    .logs-header {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--gray-800);
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid var(--purple-100);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .log-entry {
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      border-left: 4px solid transparent;
      animation: slideInRight 0.3s ease-out;
      transition: all 0.2s ease;
    }

    .log-entry:hover {
      transform: translateX(4px);
    }

    .log-entry.info {
      background: var(--blue-100);
      border-left-color: var(--purple-400);
    }

    .log-entry.success {
      background: var(--green-100);
      border-left-color: var(--green-500);
    }

    .log-entry.warn {
      background: var(--orange-100);
      border-left-color: var(--orange-500);
    }

    .log-entry.error {
      background: var(--red-100);
      border-left-color: var(--red-500);
    }

    .log-timestamp {
      color: var(--gray-600);
      margin-right: 0.5rem;
      font-size: 0.75rem;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--purple-100);
      border-radius: 1rem;
      overflow: hidden;
      margin-top: 1rem;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--purple-500), var(--purple-400));
      border-radius: 1rem;
      transition: width 0.5s ease;
      animation: shimmer 2s infinite;
    }

    @keyframes fadeInDown {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    @keyframes shimmer {
      0% {
        background-position: -1000px 0;
      }
      100% {
        background-position: 1000px 0;
      }
    }

    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--gray-600);
    }

    .empty-state-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }

    .empty-state-text {
      font-size: 1.25rem;
      font-weight: 600;
    }

    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--purple-50);
      border-radius: 1rem;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--purple-300);
      border-radius: 1rem;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--purple-400);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🐱 Stepcat</h1>
      <p class="subtitle">Agent Orchestration Dashboard</p>
    </header>

    <div class="status-banner">
      <div class="status-item">
        <div class="status-label">Total Steps</div>
        <div class="status-value" id="totalSteps">0</div>
      </div>
      <div class="status-item">
        <div class="status-label">Completed</div>
        <div class="status-value" id="completedSteps" style="color: var(--green-500);">0</div>
      </div>
      <div class="status-item">
        <div class="status-label">Remaining</div>
        <div class="status-value" id="remainingSteps" style="color: var(--orange-500);">0</div>
      </div>
      <div class="status-item">
        <div id="connectionStatus" class="connection-status">
          <span class="connection-dot"></span>
          <span>Connected</span>
        </div>
      </div>
    </div>

    <div id="githubStatus" class="github-status">
      <div class="github-header">
        <div class="github-icon">GH</div>
        <div>
          <div class="github-title" id="githubTitle">GitHub Actions</div>
          <div class="github-info" id="githubInfo"></div>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="githubProgress" style="width: 0%"></div>
      </div>
    </div>

    <div class="steps-container" id="stepsContainer">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Waiting for steps to load...</div>
      </div>
    </div>

    <div class="logs-container">
      <div class="logs-header">
        <span>📋</span>
        <span>Activity Log</span>
      </div>
      <div id="logsContent"></div>
    </div>
  </div>

  <script>
    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const state = {
      plan: null,
      steps: new Map(),
      iterations: new Map(),
      issues: new Map(),
      totalSteps: 0,
      completedSteps: 0,
      remainingSteps: 0,
      expandedSteps: new Set(),
      expandedIterations: new Set()
    };

    function loadExpansionState() {
      try {
        const saved = localStorage.getItem('stepcat_expanded_state');
        if (saved) {
          const parsed = JSON.parse(saved);
          state.expandedSteps = new Set(parsed.steps || []);
          state.expandedIterations = new Set(parsed.iterations || []);
        }
      } catch (e) {
        console.error('Failed to load expansion state:', e);
      }
    }

    function saveExpansionState() {
      try {
        localStorage.setItem('stepcat_expanded_state', JSON.stringify({
          steps: Array.from(state.expandedSteps),
          iterations: Array.from(state.expandedIterations)
        }));
      } catch (e) {
        console.error('Failed to save expansion state:', e);
      }
    }

    loadExpansionState();

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);

      ws.onopen = () => {
        console.log('Connected to Stepcat');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
      };

      ws.onclose = () => {
        console.log('Disconnected from Stepcat');
        updateConnectionStatus(false);

        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          setTimeout(connect, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleEvent(data);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };
    }

    function updateConnectionStatus(connected) {
      const status = document.getElementById('connectionStatus');
      if (connected) {
        status.className = 'connection-status';
        status.innerHTML = '<span class="connection-dot"></span><span>Connected</span>';
      } else {
        status.className = 'connection-status disconnected';
        status.innerHTML = '<span class="connection-dot"></span><span>Disconnected</span>';
      }
    }

    function handleEvent(event) {
      console.log('Event:', event);

      switch (event.type) {
        case 'state_sync':
          handleStateSync(event);
          break;
        case 'init':
          handleInit(event);
          break;
        case 'step_start':
          handleStepStart(event);
          break;
        case 'step_complete':
          handleStepComplete(event);
          break;
        case 'iteration_start':
          handleIterationStart(event);
          break;
        case 'iteration_complete':
          handleIterationComplete(event);
          break;
        case 'issue_found':
          handleIssueFound(event);
          break;
        case 'issue_resolved':
          handleIssueResolved(event);
          break;
        case 'codex_review_start':
          handleCodexReviewStart(event);
          break;
        case 'codex_review_complete':
          handleCodexReviewComplete(event);
          break;
        case 'log':
          handleLog(event);
          break;
        case 'github_check':
          handleGitHubCheck(event);
          break;
        case 'error':
          handleError(event);
          break;
        case 'all_complete':
          handleAllComplete(event);
          break;
      }
    }

    function handleStateSync(event) {
      state.plan = event.plan;
      state.steps.clear();
      state.iterations.clear();
      state.issues.clear();

      event.steps.forEach(step => {
        state.steps.set(step.id, { ...step, iterations: [] });
      });

      event.iterations.forEach(iteration => {
        state.iterations.set(iteration.id, { ...iteration, issues: [] });
        const step = state.steps.get(iteration.stepId);
        if (step) {
          step.iterations.push(iteration.id);
        }
      });

      event.issues.forEach(issue => {
        state.issues.set(issue.id, issue);
        const iteration = state.iterations.get(issue.iterationId);
        if (iteration) {
          iteration.issues.push(issue.id);
        }
      });

      state.totalSteps = state.steps.size;
      state.completedSteps = Array.from(state.steps.values()).filter(s => s.status === 'completed').length;
      state.remainingSteps = state.totalSteps - state.completedSteps;

      updateStatusBanner();
      renderSteps();
    }

    function handleInit(event) {
      state.totalSteps = event.totalSteps;
      state.completedSteps = event.doneSteps;
      state.remainingSteps = event.pendingSteps;

      updateStatusBanner();
    }

    function handleStepStart(event) {
      const step = Array.from(state.steps.values()).find(s => s.stepNumber === event.stepNumber);
      if (step) {
        step.status = 'in_progress';
        state.expandedSteps.add(step.id);
        saveExpansionState();
      }
      renderSteps();
    }

    function handleStepComplete(event) {
      const step = Array.from(state.steps.values()).find(s => s.stepNumber === event.stepNumber);
      if (step) {
        step.status = 'completed';
      }
      state.completedSteps++;
      state.remainingSteps--;
      updateStatusBanner();
      renderSteps();
    }

    function handleIterationStart(event) {
      const newIteration = {
        id: Date.now(),
        stepId: event.stepId,
        iterationNumber: event.iterationNumber,
        type: event.iterationType,
        commitSha: null,
        claudeLog: null,
        codexLog: null,
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        issues: []
      };

      state.iterations.set(newIteration.id, newIteration);
      const step = state.steps.get(event.stepId);
      if (step) {
        step.iterations.push(newIteration.id);
        state.expandedSteps.add(event.stepId);
        state.expandedIterations.add(newIteration.id);
        saveExpansionState();
      }
      renderSteps();
      addLog(\`Iteration \${event.iterationNumber}: \${event.iterationType}\`, 'info', event.timestamp);
    }

    function handleIterationComplete(event) {
      const iteration = Array.from(state.iterations.values()).find(
        i => i.stepId === event.stepId && i.iterationNumber === event.iterationNumber
      );
      if (iteration) {
        iteration.status = event.status;
        iteration.commitSha = event.commitSha;
        iteration.updatedAt = new Date().toISOString();
      }
      renderSteps();
    }

    function handleIssueFound(event) {
      const newIssue = {
        id: Date.now() + Math.random(),
        iterationId: event.iterationId,
        type: event.issueType,
        description: event.description,
        filePath: event.filePath || null,
        lineNumber: event.lineNumber || null,
        severity: event.severity || null,
        status: 'open',
        createdAt: new Date().toISOString(),
        resolvedAt: null
      };

      state.issues.set(newIssue.id, newIssue);
      const iteration = state.iterations.get(event.iterationId);
      if (iteration) {
        iteration.issues.push(newIssue.id);
        state.expandedIterations.add(event.iterationId);
        saveExpansionState();
      }
      renderSteps();
      addLog(\`Issue found: \${event.description}\`, 'warn', event.timestamp);
    }

    function handleIssueResolved(event) {
      const issue = state.issues.get(event.issueId);
      if (issue) {
        issue.status = 'fixed';
        issue.resolvedAt = new Date().toISOString();
      }
      renderSteps();
      addLog(\`Issue resolved\`, 'success', event.timestamp);
    }

    function handleCodexReviewStart(event) {
      addLog(\`Codex review starting (\${event.promptType})...\`, 'info', event.timestamp);
    }

    function handleCodexReviewComplete(event) {
      const statusMsg = event.result === 'PASS'
        ? \`Codex review passed (\${event.issueCount} issues)\`
        : \`Codex review failed (\${event.issueCount} issues)\`;
      addLog(statusMsg, event.result === 'PASS' ? 'success' : 'warn', event.timestamp);
    }

    function handleLog(event) {
      addLog(event.message, event.level, event.timestamp);
    }

    function handleGitHubCheck(event) {
      const githubStatus = document.getElementById('githubStatus');
      const githubInfo = document.getElementById('githubInfo');
      const githubProgress = document.getElementById('githubProgress');

      githubStatus.classList.add('visible');

      const statusText = {
        'waiting': '⏳ Waiting for checks to start...',
        'running': '🔄 Checks running...',
        'success': '✓ All checks passed!',
        'failure': '✗ Checks failed'
      };

      const statusMessage = event.checkName
        ? \`\${statusText[event.status]} - \${event.checkName} (SHA: \${event.sha.substring(0, 7)})\`
        : \`\${statusText[event.status]} (SHA: \${event.sha.substring(0, 7)})\`;

      githubInfo.textContent = statusMessage;

      if (event.status === 'waiting') {
        githubProgress.style.width = '10%';
      } else if (event.status === 'running') {
        githubProgress.style.width = '50%';
      } else if (event.status === 'success') {
        githubProgress.style.width = '100%';
      } else if (event.status === 'failure') {
        githubProgress.style.width = '100%';
        githubProgress.style.background = 'var(--red-500)';
      }
    }

    function handleError(event) {
      addLog(\`ERROR: \${event.error}\`, 'error', event.timestamp);

      const banner = document.querySelector('.status-banner');
      if (banner) {
        banner.style.borderColor = 'var(--red-500)';
        banner.style.background = 'var(--red-100)';
      }
    }

    function handleAllComplete(event) {
      const minutes = Math.floor(event.totalTime / 60000);
      const seconds = Math.floor((event.totalTime % 60000) / 1000);
      addLog(\`All steps completed in \${minutes}m \${seconds}s\`, 'success', event.timestamp);
    }

    function updateStatusBanner() {
      document.getElementById('totalSteps').textContent = state.totalSteps;
      document.getElementById('completedSteps').textContent = state.completedSteps;
      document.getElementById('remainingSteps').textContent = state.remainingSteps;
    }

    function toggleStep(stepId) {
      if (state.expandedSteps.has(stepId)) {
        state.expandedSteps.delete(stepId);
      } else {
        state.expandedSteps.add(stepId);
      }
      saveExpansionState();
      renderSteps();
    }

    function toggleIteration(iterationId) {
      if (state.expandedIterations.has(iterationId)) {
        state.expandedIterations.delete(iterationId);
      } else {
        state.expandedIterations.add(iterationId);
      }
      saveExpansionState();
      renderSteps();
    }

    function renderSteps() {
      const container = document.getElementById('stepsContainer');
      if (state.steps.size === 0) {
        return;
      }

      const stepsArray = Array.from(state.steps.values()).sort((a, b) => a.stepNumber - b.stepNumber);

      container.innerHTML = stepsArray.map(step => {
        const isExpanded = state.expandedSteps.has(step.id);
        const isActive = step.status === 'in_progress';
        const isCompleted = step.status === 'completed';
        const isFailed = step.status === 'failed';

        const iterationIds = step.iterations || [];
        const iterationsHTML = renderIterations(iterationIds);

        const statusIcon = isCompleted ? '✓' : isActive ? '⟳' : isFailed ? '✗' : '◯';
        const statusText = isCompleted ? 'Complete' : isActive ? 'In Progress' : isFailed ? 'Failed' : 'Pending';

        return \`
          <div class="step-card \${isActive ? 'active' : ''} \${isCompleted ? 'completed' : ''}" style="animation-delay: \${step.stepNumber * 0.1}s" data-step-id="\${step.id}">
            <div class="step-header step-header-clickable" onclick="toggleStep(\${step.id})">
              <div class="step-number">\${step.stepNumber}</div>
              <div class="step-title">\${escapeHtml(step.title)}</div>
              <div class="step-meta">\${iterationIds.length} iteration\${iterationIds.length !== 1 ? 's' : ''}</div>
              <div class="step-status">
                \${statusIcon} \${statusText}
              </div>
              <span class="expand-icon \${isExpanded ? 'expanded' : ''}">▸</span>
            </div>
            <div class="iterations-container \${isExpanded ? 'expanded' : ''}">
              \${iterationsHTML || '<div style="padding: 1rem; color: var(--gray-600); font-size: 0.875rem;">No iterations yet</div>'}
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderIterations(iterationIds) {
      if (!iterationIds || iterationIds.length === 0) return '';

      return iterationIds.map(iterationId => {
        const iteration = state.iterations.get(iterationId);
        if (!iteration) return '';

        const isExpanded = state.expandedIterations.has(iteration.id);
        const statusClass = iteration.status;
        const typeLabel = iteration.type.replace('_', ' ');

        const iconContent = iteration.status === 'in_progress' ? '⟳' : iteration.status === 'completed' ? '✓' : '✗';

        const issueIds = iteration.issues || [];
        const issuesHTML = renderIssues(issueIds);

        return \`
          <div class="iteration \${statusClass}" data-iteration-id="\${iteration.id}">
            <div class="iteration-header" onclick="toggleIteration(\${iteration.id})">
              <div class="iteration-title">
                <div class="iteration-icon">\${iconContent}</div>
                <span>Iteration \${iteration.iterationNumber}</span>
                <span class="iteration-type">\${typeLabel}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                \${iteration.commitSha ? \`<span class="commit-sha">\${iteration.commitSha.substring(0, 7)}</span>\` : ''}
                <span style="font-size: 0.75rem; color: var(--gray-600);">\${issueIds.length} issue\${issueIds.length !== 1 ? 's' : ''}</span>
                <span class="expand-icon \${isExpanded ? 'expanded' : ''}">▸</span>
              </div>
            </div>
            <div class="issues-container \${isExpanded ? 'expanded' : ''}">
              \${issuesHTML || '<div style="padding: 0.75rem; color: var(--gray-600); font-size: 0.875rem;">No issues</div>'}
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderIssues(issueIds) {
      if (!issueIds || issueIds.length === 0) return '';

      return issueIds.map(issueId => {
        const issue = state.issues.get(issueId);
        if (!issue) return '';

        const severityIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        const statusClass = issue.status;
        const location = issue.filePath
          ? \`\${issue.filePath}\${issue.lineNumber ? ':' + issue.lineNumber : ''}\`
          : '';

        return \`
          <div class="issue \${statusClass}" data-issue-id="\${issue.id}">
            <div class="issue-header">
              <span class="issue-severity">\${severityIcon}</span>
              <div class="issue-content">
                <div class="issue-description">\${escapeHtml(issue.description)}</div>
                <div>
                  \${location ? \`<span class="issue-location">\${escapeHtml(location)}</span>\` : ''}
                  <span class="issue-status \${statusClass}">\${issue.status === 'fixed' ? '✓ Fixed' : '⚠ Open'}</span>
                </div>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function addLog(message, level = 'info', timestamp) {
      const logsContent = document.getElementById('logsContent');
      const logEntry = document.createElement('div');
      logEntry.className = \`log-entry \${level}\`;

      const date = new Date(timestamp);
      const timeStr = date.toLocaleTimeString();

      logEntry.innerHTML = \`
        <span class="log-timestamp">[\${timeStr}]</span>
        <span>\${escapeHtml(message)}</span>
      \`;

      logsContent.appendChild(logEntry);
      logsContent.scrollTop = logsContent.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    connect();
  </script>
</body>
</html>`;
  }
}
