/**
 * Simple structured logger.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function log(level: LogLevel, message: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };

  const prefix = `[${entry.timestamp}] ${level.toUpperCase()}:`;
  const extra = data ? ` ${JSON.stringify(data)}` : '';

  // stdout for debug/info, stderr for warn/error
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${prefix} ${message}${extra}\n`);
}
