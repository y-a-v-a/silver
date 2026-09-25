// macOS notifications via osascript. Silent (and harmless) on other platforms or on error:
// a missed notification must never fail a shift.
import { execFile } from 'node:child_process';

/** AppleScript string literal. */
export const appleString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * @param {string} title
 * @param {string} message
 * @param {{platform?: string, run?: typeof execFile}} [opts]
 * @returns {Promise<boolean>} whether a notification was attempted and succeeded
 */
export function notify(title, message, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'darwin') return Promise.resolve(false);
  const script = `display notification ${appleString(message)} with title ${appleString(title)}`;
  return new Promise((resolve) => run('osascript', ['-e', script], (err) => resolve(!err)));
}
