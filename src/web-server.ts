import express, { Express } from 'express';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { OrchestratorEventEmitter, OrchestratorEvent } from './events';
import open from 'open';

export interface WebServerConfig {
  port?: number;
  eventEmitter: OrchestratorEventEmitter;
  autoOpen?: boolean;
}

export class WebServer {
  private app: Express;
  private httpServer: HTTPServer;
  private wss: WebSocketServer;
  private port: number;
  private clients: Set<WebSocket>;
  private eventEmitter: OrchestratorEventEmitter;
  private autoOpen: boolean;
  private latestInitEvent: OrchestratorEvent | null = null;
  private eventHistory: OrchestratorEvent[] = [];

  constructor(config: WebServerConfig) {
    this.port = config.port || 3742;
    this.eventEmitter = config.eventEmitter;
    this.autoOpen = config.autoOpen ?? true;
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

      if (this.eventHistory.length > 0 && ws.readyState === WebSocket.OPEN) {
        console.log(`Replaying ${this.eventHistory.length} cached events to new client`);
        this.eventHistory.forEach(event => {
          ws.send(JSON.stringify(event));
        });
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
      if (event.type === 'init') {
        this.latestInitEvent = event;
      }
      this.eventHistory.push(event);
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
      steps: [],
      currentStep: null,
      totalSteps: 0,
      completedSteps: 0,
      remainingSteps: 0
    };

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
        case 'init':
          handleInit(event);
          break;
        case 'step_start':
          handleStepStart(event);
          break;
        case 'step_complete':
          handleStepComplete(event);
          break;
        case 'phase_start':
          handlePhaseStart(event);
          break;
        case 'phase_complete':
          handlePhaseComplete(event);
          break;
        case 'log':
          handleLog(event);
          break;
        case 'github_check':
          handleGitHubCheck(event);
          break;
        case 'build_attempt':
          handleBuildAttempt(event);
          break;
        case 'review_start':
          handleReviewStart(event);
          break;
        case 'review_complete':
          handleReviewComplete(event);
          break;
        case 'error':
          handleError(event);
          break;
        case 'all_complete':
          handleAllComplete(event);
          break;
      }
    }

    function handleInit(event) {
      state.totalSteps = event.totalSteps;
      state.completedSteps = event.doneSteps;
      state.remainingSteps = event.pendingSteps;
      state.steps = event.steps.map(s => ({
        ...s,
        status: s.phase === 'done' ? 'completed' : 'pending',
        completedPhases: s.phase === 'done' ? ['implementation', 'build', 'review'] :
                        s.phase === 'review' ? ['implementation', 'build'] :
                        s.phase === 'implementation' ? ['implementation'] : [],
        currentPhase: s.phase === 'implementation' ? 'implementation' :
                     s.phase === 'review' ? 'review' :
                     s.phase === 'done' ? null : null
      }));

      updateStatusBanner();
      renderSteps();
    }

    function handleStepStart(event) {
      state.currentStep = event.stepNumber;
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        step.status = 'active';
      }
      renderSteps();
    }

    function handleStepComplete(event) {
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        step.status = 'completed';
        step.phase = 'done';
      }
      state.completedSteps++;
      state.remainingSteps--;
      updateStatusBanner();
      renderSteps();
    }

    function handlePhaseStart(event) {
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        step.currentPhase = event.phase;
      }
      renderSteps();
    }

    function handlePhaseComplete(event) {
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        if (!step.completedPhases) step.completedPhases = [];
        step.completedPhases.push(event.phase);
      }
      renderSteps();
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

    function handleBuildAttempt(event) {
      const githubStatus = document.getElementById('githubStatus');
      const githubInfo = document.getElementById('githubInfo');
      const githubProgress = document.getElementById('githubProgress');

      githubStatus.classList.add('visible');
      githubInfo.textContent = \`Build attempt \${event.attempt}/\${event.maxAttempts} - SHA: \${event.sha.substring(0, 7)}\`;
      githubProgress.style.width = '0%';
      githubProgress.style.background = 'linear-gradient(90deg, var(--purple-500), var(--purple-400))';
    }

    function handleReviewStart(event) {
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        step.reviewInProgress = true;
      }
      renderSteps();
      addLog('🔍 Starting Codex code review...', 'info', event.timestamp);
    }

    function handleReviewComplete(event) {
      const step = state.steps.find(s => s.number === event.stepNumber);
      if (step) {
        step.reviewInProgress = false;
        step.reviewHasIssues = event.hasIssues;
      }
      renderSteps();

      if (event.hasIssues) {
        addLog('⚠️  Code review identified issues - addressing feedback...', 'warn', event.timestamp);
      } else {
        addLog('✓ Code review passed with no issues', 'success', event.timestamp);
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

    function renderSteps() {
      const container = document.getElementById('stepsContainer');
      if (state.steps.length === 0) return;

      container.innerHTML = state.steps.map(step => {
        const isActive = step.status === 'active' || step.number === state.currentStep;
        const isCompleted = step.phase === 'done';
        const completedPhases = step.completedPhases || [];
        const currentPhase = step.currentPhase || '';

        const phases = [
          { id: 'implementation', label: '1. Implementation', icon: '⚡' },
          { id: 'build', label: '2. Build Verification', icon: '🔨' },
          { id: 'review', label: '3. Code Review', icon: '🔍' }
        ];

        const phasesHTML = phases.map(phase => {
          const phaseCompleted = completedPhases.includes(phase.id);
          const phaseActive = currentPhase === phase.id;
          let phaseClass = phaseCompleted ? 'completed' : phaseActive ? 'active' : '';
          let phaseLabel = phase.label;
          let phaseIconContent = phaseCompleted ? '✓' : phaseActive ? '⟳' : phase.icon;

          if (phase.id === 'review') {
            if (step.reviewInProgress) {
              phaseClass = 'active';
              phaseIconContent = '🔄';
              phaseLabel = '3. Code Review (Running...)';
            } else if (step.reviewHasIssues !== undefined) {
              if (step.reviewHasIssues) {
                phaseClass = phaseCompleted ? 'completed' : 'warning';
                phaseIconContent = '⚠️';
                phaseLabel = '3. Code Review (Issues Found)';
              } else if (phaseCompleted || currentPhase === 'review') {
                phaseLabel = '3. Code Review (No Issues)';
              }
            }
          }

          return \`
            <div class="phase \${phaseClass}">
              <div class="phase-header">
                <div class="phase-icon">\${phaseIconContent}</div>
                <span>\${phaseLabel}</span>
              </div>
            </div>
          \`;
        }).join('');

        return \`
          <div class="step-card \${isActive ? 'active' : ''} \${isCompleted ? 'completed' : ''}" style="animation-delay: \${step.number * 0.1}s">
            <div class="step-header">
              <div class="step-number">\${step.number}</div>
              <div class="step-title">\${escapeHtml(step.title)}</div>
              <div class="step-status">
                \${isCompleted ? '✓ Complete' : isActive ? '⟳ In Progress' : '◯ Pending'}
              </div>
            </div>
            <div class="phases">
              \${phasesHTML}
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
