import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';

const MESSAGES = {
  missing: 'Codexが見つかりません',
  timeout: '取得がタイムアウトしました',
  connection: 'Codexに接続できませんでした',
  account: 'Codexの残量を取得できませんでした',
  response: '残量データを確認できませんでした',
  cancelled: '取得を中止しました',
  cleanup: '取得用プロセスの終了を確認できませんでした'
};
export class UsageReadError extends Error {
  constructor(code) { super(MESSAGES[code] || MESSAGES.response); this.code = code; }
}

// This is the sole RPC construction boundary. No generation, account change,
// purchase, message or reset-redemption method can pass it.
export function makeReadRequest(method, id) {
  if (!['initialize', 'account/rateLimits/read'].includes(method)) throw new Error('RPC method not allowed');
  if (!Number.isSafeInteger(id)) throw new Error('RPC id not allowed');
  return method === 'initialize'
    ? { id, method, params: { clientInfo: { name: 'codex-usage-overlay', title: 'Codex 残量', version: '1.1.0' } } }
    : { id, method };
}

function windowValue(value) {
  if (!value || typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)
      || value.usedPercent < 0 || value.usedPercent > 100) return null;
  const minutes = Number.isFinite(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null;
  const label = minutes === 10080 ? '週間枠'
    : minutes === 300 ? '5時間枠'
    : minutes && minutes % 1440 === 0 ? `${minutes / 1440}日間枠`
    : minutes && minutes % 60 === 0 ? `${minutes / 60}時間枠`
    : minutes ? `${minutes}分間枠` : '利用枠';
  return { label, usedPercent: value.usedPercent,
    remainingPercent: Math.round((100 - value.usedPercent) * 10) / 10,
    resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 && Number.isFinite(new Date(value.resetsAt*1000).getTime()) ? value.resetsAt : null };
}
function creditValue(value) {
  if (value?.unlimited === true) return { kind: 'unlimited', balance: null };
  const raw = typeof value?.balance === 'number' ? String(value.balance) : value?.balance;
  if (typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim()) && Number.isFinite(Number(raw))) {
    return { kind: 'balance', balance: raw.trim() };
  }
  return { kind: 'unavailable', balance: null };
}
export function normalizeUsage(response, now = Date.now()) {
  if (!response || (!response.rateLimits && !response.rateLimitsByLimitId)) throw new Error('Missing rate limit response');
  const entries = new Map();
  const legacy = response.rateLimits;
  if (legacy && typeof legacy === 'object') entries.set(legacy.limitId || 'codex', legacy);
  const map = response.rateLimitsByLimitId;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [id, value] of Object.entries(map)) if (value && typeof value === 'object') entries.set(id, value);
  }
  const ordered = [...entries].sort(([a], [b]) => a === 'codex' ? -1 : b === 'codex' ? 1 : a.localeCompare(b));
  if (!ordered.length) throw new Error('Missing rate limit buckets');
  const buckets = ordered.map(([id, value]) => ({
    id, title: id === 'codex' ? 'Codex' : String(value.limitName || id).replace(/[\x00-\x1f]/g, '').slice(0, 80),
    primary: windowValue(value.primary), secondary: windowValue(value.secondary)
  }));
  const credits = ordered.map(([, value]) => creditValue(value.credits)).find(value => value.kind !== 'unavailable')
    || { kind: 'unavailable', balance: null };
  const rawPlan = ordered[0][1].planType;
  const plan = ['free','go','plus','pro','prolite','promax','team','business','enterprise','edu','edu_plus','edu_pro'].includes(rawPlan) ? rawPlan : null;
  return { status: 'ready', updatedAt: new Date(now).toISOString(), plan, buckets, credits };
}

export async function resolveCodexExecutable() {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe');
    try { await access(candidate); return candidate; } catch { /* Try next installed CLI. */ }
  }
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const candidates = await Promise.all((await readdir(base, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(async entry => {
        const candidate = path.join(base, entry.name, 'codex.exe');
        try { return { candidate, modified: (await stat(candidate)).mtimeMs }; } catch { return null; }
      }));
    const latest = candidates.filter(Boolean).sort((a, b) => b.modified - a.modified)[0];
    if (latest) return latest.candidate;
  } catch { /* The desktop bundle need not exist on every PC. */ }
  throw new UsageReadError('missing');
}

export async function readAccountUsage({ executable, spawnProcess = spawn, timeoutMs = 60000, closeTimeoutMs = 2000, signal } = {}) {
  const command = executable || await resolveCodexExecutable();
  if(signal?.aborted)throw new UsageReadError('cancelled');
  return new Promise((resolve, reject) => {
    let child;
    let finished = false;
    let buffer = '';
    let stage = 'initialize';
    let timer;
    let exited=false;
    const abort=()=>finish(new UsageReadError('cancelled'));
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      const settle=()=>error?reject(error):resolve(value);
      try{child?.stdin?.end();}catch{}
      if(!child||exited){settle();return;}
      const closeTimer=setTimeout(()=>reject(new UsageReadError('cleanup')),closeTimeoutMs);
      child.once('exit',()=>{clearTimeout(closeTimer);settle();});
      try{child.kill();}catch{}
    };
    const send = (method, id) => child.stdin.write(JSON.stringify(makeReadRequest(method, id)) + '\n');
    try {
      child = spawnProcess(command, ['app-server'], { cwd:tmpdir(),windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      child.stdout.setEncoding('utf8');
      // Do not copy stderr, auth files, conversation logs or account identities.
      child.stderr.on('data', () => {});
      child.on('error', () => {if(child.pid==null)exited=true;finish(new UsageReadError('connection'));});
      child.stdin.on('error', () => finish(new UsageReadError('connection')));
      child.on('exit', () => {exited=true;finish(new UsageReadError('connection'));});
      child.stdout.on('data', chunk => {
        if (finished) return;
        buffer += chunk.toString('utf8');
        if (buffer.length > 1024 * 1024) return finish(new UsageReadError('response'));
        let end;
        while (!finished && (end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1 && stage === 'initialize') {
            if (message.error) return finish(new UsageReadError('connection'));
            stage = 'read';
            child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
            send('account/rateLimits/read', 2);
          } else if (message.id === 2 && stage === 'read') {
            if (message.error) return finish(new UsageReadError('account'));
            try { finish(null, normalizeUsage(message.result)); }
            catch { finish(new UsageReadError('response')); }
          }
        }
      });
      timer = setTimeout(() => finish(new UsageReadError('timeout')), timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      send('initialize', 1);
    } catch { finish(new UsageReadError('connection')); }
  });
}
