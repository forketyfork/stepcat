import { LogLevel } from '../types/events';
import './LogEntry.css';

interface LogEntryProps {
  message: string;
  level: LogLevel;
  timestamp: number;
}

export function LogEntry({ message, level, timestamp }: LogEntryProps) {
  const date = new Date(timestamp);
  const timeStr = date.toLocaleTimeString();

  return (
    <div className={`log-entry ${level}`}>
      <span className="log-timestamp">[{timeStr}]</span>
      <span>{message}</span>
    </div>
  );
}
