import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Resolve the checkout from the test module URL, never URL.pathname (which is `/C:/...` on Windows).
export function repositoryRootFromTestUrl(moduleUrl) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..');
}
