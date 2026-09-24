// Loads .env into process.env using Node's built-in parser. Existing env vars win.

/**
 * @param {string} path
 * @returns {boolean} whether a file was loaded
 */
export function loadDotEnv(path) {
  try {
    process.loadEnvFile(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}
