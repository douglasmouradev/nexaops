type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  level: LogLevel;
  msg: string;
  time: string;
  [key: string]: unknown;
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const entry: LogFields = {
    level,
    msg,
    time: new Date().toISOString(),
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};
