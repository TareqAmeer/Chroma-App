// Minimal CDP client for the Android WebView (adb forward -> webview_devtools_remote_<pid>).
import { execFileSync } from 'node:child_process';
import os from 'node:os'; import path from 'node:path';
const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'android-tools', 'sdk');
export const ADB = path.join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
export const adb = (...a) => execFileSync(ADB, a, { maxBuffer: 1 << 28 });
export const adbText = (...a) => adb(...a).toString().replace(/\r/g, '');
export const PKG = 'com.tareq.chromasmith';

export function webviewPid() {
  const m = adbText('shell', 'cat', '/proc/net/unix').match(/webview_devtools_remote_(\d+)/g) || [];
  const appPid = adbText('shell', 'pidof', PKG).trim().split(/\s+/)[0];
  const hit = m.map(s => s.split('_').pop()).find(p => p === appPid);
  if (!hit) throw new Error('no devtools socket for app pid ' + appPid);
  return hit;
}
export async function connect(port = 9222) {
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${webviewPid()}`);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pg = pages.find(p => p.type === 'page');
  const ws = new WebSocket(pg.webSocketDebuggerUrl.replace("localhost", "127.0.0.1"));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id).resolve(d); pending.delete(d.id); } else events.push(d); };
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('Android WebView disconnected')); pending.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error('Android WebView is disconnected'));
    const i = ++id; pending.set(i, {resolve, reject});
    try { ws.send(JSON.stringify({ id: i, method, params })); } catch (error) { pending.delete(i); reject(error); }
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  const screenY = JSON.parse(pg.description || '{}').screenY || 0; // webview top edge in device px
  return { send, ev, events, screenY, close: () => ws.close() };
}
