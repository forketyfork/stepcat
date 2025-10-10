import './StatusBanner.css';

interface StatusBannerProps {
  executionId: string;
  totalSteps: number;
  completedSteps: number;
  remainingSteps: number;
  isConnected: boolean;
}

export function StatusBanner({
  executionId,
  totalSteps,
  completedSteps,
  remainingSteps,
  isConnected,
}: StatusBannerProps) {
  return (
    <div className="status-banner">
      <div className="status-item">
        <div className="status-label">Execution ID</div>
        <div className="status-value execution-id">{executionId}</div>
      </div>
      <div className="status-item">
        <div className="status-label">Total Steps</div>
        <div className="status-value">{totalSteps}</div>
      </div>
      <div className="status-item">
        <div className="status-label">Completed</div>
        <div className="status-value completed">{completedSteps}</div>
      </div>
      <div className="status-item">
        <div className="status-label">Remaining</div>
        <div className="status-value remaining">{remainingSteps}</div>
      </div>
      <div className="status-item">
        <div className={`connection-status ${isConnected ? '' : 'disconnected'}`}>
          <span className="connection-dot"></span>
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  );
}
