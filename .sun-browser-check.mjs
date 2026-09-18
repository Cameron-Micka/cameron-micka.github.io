import { writeFile } from 'node:fs/promises';
const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const target = targets.find((target) => target.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(message.error);
    else item.resolve(message.result);
  } else if (['Runtime.exceptionThrown', 'Log.entryAdded'].includes(message.method)) {
    console.log(JSON.stringify(message));
  } else if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warn'].includes(message.params.type)) {
    console.log(JSON.stringify(message));
  }
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
const backend = process.argv[2] || 'webgl2';
await call('Runtime.enable');
await call('Log.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });
const script = await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('cm-portfolio-settings', JSON.stringify({forceBackend:'${backend}', quality:'low', reducedMotion:'on', debugHud:true}));`,
});
await call('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await new Promise((resolve) => setTimeout(resolve, 18000));
const result = await call('Runtime.evaluate', {
  expression: `JSON.stringify({hud:document.querySelector('.hud')?.innerText,text:document.body.innerText.slice(-1500),gpu:!!navigator.gpu})`,
  returnByValue: true,
});
console.log(backend, result.result);
const shot = await call('Page.captureScreenshot', { format: 'png' });
await writeFile(`.sun-${backend}.png`, Buffer.from(shot.data, 'base64'));
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
ws.close();
