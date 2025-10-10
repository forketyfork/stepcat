import { useEffect, useRef } from 'react';
import { LogEntry } from './LogEntry';
import './LogsContainer.css';

interface LogEntryType {
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
  timestamp: number;
}

interface LogsContainerProps {
  logs: LogEntryType[];
}

export function LogsContainer({ logs }: LogsContainerProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="logs-container">
      <div className="logs-header">
        <span>📋</span>
        <span>Activity Log</span>
      </div>
      <div className="logs-content">
        {logs.map((log, index) => (
          <LogEntry key={index} message={log.message} level={log.level} timestamp={log.timestamp} />
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
