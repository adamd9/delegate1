const MAX_LOG_LINES = 200;
const logBuffer: string[] = [];

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info' | 'debug';

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function addToBuffer(type: ConsoleMethod, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${type.toUpperCase()}: ${formatArgs(args)}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
}

(['log', 'error', 'warn', 'info', 'debug'] as ConsoleMethod[]).forEach((method) => {
  const original = console[method];
  console[method] = (...args: any[]) => {
    addToBuffer(method, args);
    original.apply(console, args);
  };
});

export function getLogs(): string[] {
  return [...logBuffer];
}
