import type { ApiErrorResponse, SessionResponse } from '../shared/api';
import { escapeHtml } from './icons';
import './server-storage.css';

export const isServerMode = () => document.querySelector('meta[name="topology-storage"]')?.getAttribute('content') === 'server';
let loginTask: Promise<void> | undefined;

async function request(path: string, init: RequestInit = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
  try { return await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal }); }
  catch (error) { throw new Error(error instanceof Error && error.name === 'AbortError' ? '服务器响应超时，请检查连接后重试' : '无法连接服务器，请检查网络后重试'); }
  finally { clearTimeout(timer); }
}

export async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as ApiErrorResponse | null;
  return body?.error?.message || `服务器请求失败（${response.status}）`;
}

function login(): Promise<void> {
  const dialog = document.createElement('dialog'); dialog.className = 'server-login';
  dialog.innerHTML = '<form id="server-login-form"><span class="server-eyebrow">TOPOLOGY</span><h1>登录拓扑工作台</h1><p>使用服务器账户访问共享拓扑库。</p><label class="field">用户名<input id="server-username" name="username" autocomplete="username" value="admin" required maxlength="100" /></label><label class="field">密码<input id="server-password" name="password" type="password" autocomplete="current-password" required maxlength="256" /></label><p id="server-login-error" role="alert"></p><button class="button primary" type="submit">登录</button></form>';
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('cancel', event => event.preventDefault());
  return new Promise(resolve => {
    dialog.querySelector('form')!.addEventListener('submit', async event => {
      event.preventDefault(); const button = dialog.querySelector('button')!, message = dialog.querySelector('#server-login-error')!;
      button.disabled = true; message.textContent = '';
      try {
        const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: (dialog.querySelector('#server-username') as HTMLInputElement).value, password: (dialog.querySelector('#server-password') as HTMLInputElement).value }) });
        if (!response.ok) throw new Error(await responseError(response));
        dialog.close(); dialog.remove(); resolve();
      } catch (error) { message.textContent = error instanceof Error ? error.message : '登录失败'; }
      finally { button.disabled = false; }
    });
  });
}

export async function retryServerConnection(error: unknown): Promise<void> {
  const dialog = document.createElement('dialog'); dialog.className = 'server-login';
  dialog.innerHTML = `<h2>服务器暂时不可用</h2><p role="alert">${escapeHtml(error instanceof Error ? error.message : '无法读取拓扑库')}</p><p>服务器中的图和本机未同步副本会保留。连接恢复后可继续。</p><button class="button primary" id="server-reconnect">重新连接</button>`;
  document.body.append(dialog); dialog.showModal(); dialog.addEventListener('cancel', event => event.preventDefault());
  await new Promise<void>(resolve => { dialog.querySelector('button')!.onclick = () => { dialog.close(); dialog.remove(); resolve(); }; });
}

export async function ensureServerSession(force = false): Promise<void> {
  if (!isServerMode()) return;
  if (loginTask) return loginTask;
  loginTask = (async () => {
    if (!force) {
      while (true) {
        try {
          const response = await request('/api/session');
          if (!response.ok) throw new Error(await responseError(response));
          if ((await response.json() as SessionResponse).authenticated) return;
          break;
        } catch (error) { await retryServerConnection(error); }
      }
    }
    await login();
  })();
  try { await loginTask; } finally { loginTask = undefined; }
}

export async function serverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let response = await request(path, init);
  if (response.status === 401) { await ensureServerSession(true); response = await request(path, init); }
  return response;
}
export async function logoutServer() {
  const response = await serverFetch('/api/logout', { method: 'POST' });
  if (!response.ok) throw new Error(await responseError(response));
}
export function showServerError(error: unknown): void {
  let notice = document.querySelector<HTMLElement>('#server-connection-error');
  if (!notice) { notice = document.createElement('div'); notice.id = 'server-connection-error'; notice.setAttribute('role', 'status'); document.body.append(notice); }
  notice.textContent = error instanceof Error ? error.message : '服务器数据更新失败';
}
