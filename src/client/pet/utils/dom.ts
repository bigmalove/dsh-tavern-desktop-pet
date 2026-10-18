import { SCRIPT_NAME } from '../core/constants';

function getTargetConsole(): Console {
  try {
    const top = window.parent ?? window;
    if (top.console) return top.console;
  } catch {
    // ignore
  }
  return console;
}

/**
 * 日志输出辅助
 */
export function log(...args: unknown[]): void {
  getTargetConsole().log(`[${SCRIPT_NAME}]`, ...args);
}

export function warn(...args: unknown[]): void {
  getTargetConsole().warn(`[${SCRIPT_NAME}]`, ...args);
}

export function error(...args: unknown[]): void {
  getTargetConsole().error(`[${SCRIPT_NAME}]`, ...args);
}
