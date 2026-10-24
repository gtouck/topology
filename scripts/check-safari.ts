import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

// Safari 27's built-in MCP can inspect actual Safari without a third-party driver.
// Serve the build on a fresh origin so testing never edits the user's saved graphs.
if (process.platform !== 'darwin') throw new Error('实际 Safari 检查需要 macOS 和 Safari 27 或更新版本');
const root = resolve('dist'), output = resolve('test-results/safari');
let screenshotBytes: Uint8Array | undefined;
await mkdir(output, { recursive: true });
await readFile(resolve(root, 'index.html'));
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/__safari-check.png') return screenshotBytes ? new Response(screenshotBytes, { headers: { 'Content-Type': 'image/png' } }) : new Response(null, { status: 404 });
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
  if (!path.startsWith(root + sep)) return new Response(null, { status: 403 });
  const file = Bun.file(path);
  return await file.exists() ? new Response(file) : new Response(null, { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
const child = spawn('/usr/bin/safaridriver', ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', sequence = 0, tab: string | undefined;
const waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
const diagnostics: string[] = [];
child.stderr.on('data', data => diagnostics.push(String(data)));
child.on('error', error => { for (const request of waiting.values()) request.reject(error); });
child.on('exit', () => { for (const request of waiting.values()) request.reject(new Error('Safari MCP 已退出，请确认 Safari 27 及远程自动化设置')); });
child.stdout.on('data', data => {
  buffer += data;
  let end: number;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try { const result = JSON.parse(line); waiting.get(result.id)?.resolve(result); } catch { /* Non-JSON diagnostic line. */ }
  }
});
async function rpc(method: string, params: unknown) {
  const id = ++sequence;
  try {
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), 30_000);
      waiting.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  } finally { waiting.delete(id); }
}
async function tool(name: string, args: unknown) {
  let response: any;
  try { response = await rpc('tools/call', { name, arguments: args }); }
  catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : error}`); }
  if (response.error || response.result?.isError) throw new Error(JSON.stringify(response.error || response.result));
  return response.result;
}
async function evaluate(body: string, label: string) {
  await tool('switch_tab', { handle: tab });
  const result = await tool('evaluate_javascript', { expression: `return (async()=>{if(location.origin!==${JSON.stringify(origin)}) throw new Error('测试已离开专用页面'); ${body}; return ${JSON.stringify('PASS ' + label)};})();` });
  assert(JSON.stringify(result).includes('PASS ' + label), `${label}: ${JSON.stringify(result)}`);
  console.log('Safari PASS: ' + label);
}
async function paint(label: string) {
  const path = resolve(output, `${label}.png`);
  await tool('switch_tab', { handle: tab });
  // Native Safari shares the desktop's available window size. Center the probe
  // at 100% so clipping and subpixel rails cannot masquerade as a paint error.
  await tool('evaluate_javascript', { expression: `if(location.origin!==${JSON.stringify(origin)})throw new Error('测试页面已改变');const graph=window.stationPrototype.graph;graph.zoomTo(1);graph.centerCell(graph.getCellById('ant-01'));return 'camera ready';` });
  await tool('evaluate_javascript', { expression: "return Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve('paint ready')))),new Promise(resolve=>setTimeout(()=>resolve('paint settle'),1000))]);" });
  await tool('screenshot', { savePath: path, full_page: true });
  screenshotBytes = await readFile(path);
  // Let Safari decode its screenshot; no screenshot library is needed.
  try {
    const result = await tool('evaluate_javascript', { expression: `return (async()=>{
      if(location.origin!==${JSON.stringify(origin)})throw new Error('测试页面已改变');
      const card=document.querySelector('[data-device-node="ant-01"]'), rect=card.getBoundingClientRect();
      const rgb=[1,3,5].map(n=>parseInt(getComputedStyle(card).getPropertyValue('--device-state-color').trim().slice(n,n+2),16));
      const img=new Image(); const ready=new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject});
      img.src='/__safari-check.png?t='+Date.now(); await ready;
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const ratio=img.width/innerWidth;
      let count=0;for(let y=Math.ceil((rect.y+12)*ratio);y<(rect.bottom-12)*ratio;y++){
        for(let x=Math.ceil((rect.x+1)*ratio);x<(rect.x+5)*ratio;x++){
          const pixel=ctx.getImageData(x,y,1,1).data;if(rgb.every((n,i)=>Math.abs(n-pixel[i])<18)){count++;break;}
        }
      }
      if(count<(rect.height-24)*ratio*.7)throw new Error('实际节点绘制未对齐：'+count);
      return 'PASS ${label} paint';
    })();` });
    assert(JSON.stringify(result).includes(`PASS ${label} paint`), JSON.stringify(result));
    console.log(`Safari PASS: ${label} screenshot pixels`);
  } finally { screenshotBytes = undefined; }
}

try {
  const initialized = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'topology-compatibility-check', version: '1.0' } });
  assert(initialized.result, JSON.stringify(initialized));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const created = await tool('create_tab', { url: origin });
  await writeFile(resolve(output, 'created-tab.json'), JSON.stringify(created, null, 2));
  tab = JSON.parse(created.content.find((item: any) => item.type === 'text').text).handle;
  assert(tab, `无法取得新建测试标签页：${JSON.stringify(created)}`);
  console.log('Actual Safari test origin: ' + origin);
  await new Promise<void>((resolve, reject) => { const opener = spawn('/usr/bin/open', ['-a', 'Safari']); opener.on('error', reject); opener.on('exit', () => resolve()); });
  await evaluate(`if(document.querySelectorAll('.device-card').length!==8)throw new Error('节点未加载');document.querySelector('.canvas-controls [data-action="fit"]').click();window.__compatSnapshot=JSON.stringify(window.stationPrototype.snapshot());window.__compatErrors=[];addEventListener('error',e=>window.__compatErrors.push(e.message));`, 'initial load');
  await writeFile(resolve(output, 'browser.json'), JSON.stringify(await tool('evaluate_javascript', { expression: 'return JSON.stringify({userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],devicePixelRatio});' }), null, 2));
  await paint('initial');
  await evaluate(`document.querySelector('.mode-switch [data-action="edit"]').click();window.stationPrototype.graph.resetSelection(['ant-01']);document.querySelector('#device-title').value='Safari 尚未应用的输入';window.stationPrototype.updateTelemetry('DEV-001',{azimuth:88.8},'warning');if(document.querySelector('[data-device-node="ant-01"]').dataset.status!=='warning'||document.querySelector('#device-title').value!=='Safari 尚未应用的输入')throw new Error('状态更新或输入保留失败');if(JSON.stringify(window.stationPrototype.snapshot())!==window.__compatSnapshot)throw new Error('运行值修改了文档');document.querySelector('.canvas-controls [data-action="fit"]').click();`, 'runtime state and input preservation');
  await paint('warning');
  await evaluate(`document.querySelector('[data-action="lock-selected"]').click();if(!document.querySelector('.device-lock-indicator'))throw new Error('锁定标记缺失');`, 'locking');
  await paint('locked');
  await evaluate(`document.querySelector('[data-action="unlock-selected"]').click();if(JSON.stringify(window.stationPrototype.snapshot())!==window.__compatSnapshot)throw new Error('解锁后文档改变');document.querySelector('[data-action="save"]').click();`, 'save and unchanged geometry');
  await evaluate(`
    const original=HTMLAnchorElement.prototype.click;let download;
    HTMLAnchorElement.prototype.click=function(){if(this.download)download=this.href;else original.call(this)};
    async function capture(format){
      download=undefined;document.querySelector('[data-action="export-'+format+'"]').click();
      for(let i=0;i<300&&!download;i++)await new Promise(resolve=>setTimeout(resolve,20));
      if(!download)throw new Error(format+' 未生成下载文件');return await (await fetch(download)).blob();
    }
    try{
      document.querySelector('[data-action="export-options"]').click();
      const svg=await (await capture('svg')).text(), xml=new DOMParser().parseFromString(svg,'image/svg+xml');
      if(xml.querySelector('parsererror')||xml.querySelectorAll('[data-node-id]').length!==8||xml.querySelectorAll('[data-edge-id]').length!==8)throw new Error('SVG 内容不完整');
      const png=await capture('png'), image=new Image(), loaded=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});
      const url=URL.createObjectURL(png);image.src=url;await loaded;
      try{
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;let colored=0;
        for(let i=0;i<pixels.length;i+=64)if(pixels[i+3]>200&&(Math.abs(pixels[i]-pixels[i+1])>10||Math.abs(pixels[i+2]-pixels[i+1])>10))colored++;
        if(colored<100||image.width!==Number(xml.documentElement.getAttribute('width'))*2)throw new Error('PNG 解码或绘制失败');
      }finally{URL.revokeObjectURL(url)}
      const html=await (await capture('html')).text();
      if(/<script\\s+src=|<link\\b/.test(html))throw new Error('HTML 引用了外部脚本');
      const frame=document.createElement('iframe');frame.srcdoc=html;document.body.appendChild(frame);
      try{
        for(let i=0;i<300&&!frame.contentWindow.topologyViewer;i++)await new Promise(resolve=>setTimeout(resolve,20));
        const viewer=frame.contentWindow.topologyViewer;if(!viewer||frame.contentDocument.querySelectorAll('.device-card').length!==8)throw new Error('HTML 展示组件未加载');
        const node=viewer.getDefinition().topology.nodes[0];viewer.updateData({[node.data.binding?.source||node.data.deviceId]:{status:'offline'}});
        if(!frame.contentDocument.querySelector('.device-card[data-status="offline"]'))throw new Error('HTML 宿主更新失败');
        viewer.destroy();
      }finally{frame.remove()}
      if(window.__compatErrors.length)throw new Error(window.__compatErrors.join(';'));
      if(JSON.stringify(window.stationPrototype.snapshot())!==window.__compatSnapshot)throw new Error('导出改变了文档');
    }finally{HTMLAnchorElement.prototype.click=original}
  `, 'SVG content, decoded PNG and self-contained HTML');
  await tool('navigate_to_url', { tab_uuid: tab, url: origin + '/viewer.html' });
  await evaluate(`if(!window.topologyViewer||!document.querySelectorAll('.device-card').length)throw new Error('展示组件未加载');const node=window.topologyViewer.getDefinition().topology.nodes[0];window.topologyViewer.updateData({[node.data.binding?.source||node.data.deviceId]:{status:'warning'}});if(!document.querySelector('.device-card[data-status="warning"]'))throw new Error('展示组件状态未更新');`, 'standalone viewer');
  console.log('Safari native checks passed. Screenshots: ' + output);
} finally {
  if (tab) await tool('close_tab', { handle: tab }).catch(() => {});
  child.kill(); server.stop(true);
}
