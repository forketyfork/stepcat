import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerConfig {
  workDir: string;
  minLevel?: LogLevel;
  logFileName?: string;
}

export class Logger {
  private static instance: Logger | null = null;
  private logFile: string;
  private minLevel: LogLevel;
  private stream: fs.WriteStream | null = null;

  private constructor(config: LoggerConfig) {
    const logDir = path.join(config.workDir, ".stepcat");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, config.logFileName ?? "stepcat.log");
    this.minLevel = config.minLevel ?? "debug";

    this.stream = fs.createWriteStream(this.logFile, { flags: "a" });
    this.stream.on("error", () => {
      // Silently ignore write errors (e.g., when directory is deleted during tests)
      this.stream = null;
    });
  }

  static initialize(config: LoggerConfig): Logger {
    if (Logger.instance) {
      Logger.instance.close();
    }
    Logger.instance = new Logger(config);
    return Logger.instance;
  }

  static getInstance(): Logger | null {
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private formatMessage(level: LogLevel, component: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${component}] ${message}`;
  }

  log(level: LogLevel, component: string, message: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formattedMessage = this.formatMessage(level, component, message);

    if (this.stream) {
      this.stream.write(formattedMessage + "\n");
    }
  }

  debug(component: string, message: string): void {
    this.log("debug", component, message);
  }

  info(component: string, message: string): void {
    this.log("info", component, message);
  }

  warn(component: string, message: string): void {
    this.log("warn", component, message);
  }

  error(component: string, message: string): void {
    this.log("error", component, message);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    Logger.instance = null;
  }

  getLogFilePath(): string {
    return this.logFile;
  }
}

export function getLogger(): Logger | null {
  return Logger.getInstance();
}
