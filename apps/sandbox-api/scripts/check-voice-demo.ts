import { createHash } from 'node:crypto';
import { localAcousticEndpoint } from '../src/voice-acoustic.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: repo + '.env', quiet: true });
const { values } = parseArgs({ options: { 'api-base': { type: 'string', default: 'http://127.0.0.1:8080' }, strategy:{type:'string',default:'gemini'}, 'acoustic-base':{type:'string',default:'http://127.0.0.1:8081'} } });
if (!['gemini','hybrid'].includes(values.strategy!)) throw new Error('strategy must be gemini or hybrid');
const startCommand=values.strategy==='hybrid'?'pnpm dev:voice-pro':'pnpm dev:voice-extended';
const expectedModel = 'gemini-3.8-live-extended-thinking';
const checks: { name: string; ok: boolean; action?: string }[] = [];
const add = (name: string, ok: boolean, action?: string) => checks.push({ name, ok, ...(!ok ? { action } : {}) });
add('Node >=22 and native WebSocket', Number(process.versions.node.split('.')[0]) >= 22 && typeof WebSocket === 'function', 'Dùng Node.js >=22.');
const extension = repo + 'apps/extension/.output/chrome-mv3/';
add('Voice extension bundle', ['manifest.json', 'voice.html', 'voice-worklet.js'].every(file => existsSync(extension + file)), 'Chạy pnpm build:extension rồi reload extension.');
if (existsSync(extension + 'manifest.json')) {
  try { const manifest = JSON.parse(readFileSync(extension + 'manifest.json', 'utf8')); add('Manifest V3', manifest.manifest_version === 3, 'Build lại Chrome extension.'); }
  catch { add('Manifest V3', false, 'Build lại Chrome extension.'); }
}
let base: URL | undefined;
try {
  const url = new URL(values['api-base']!);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error();
  base = url;
} catch { add('API URL', false, 'Dùng địa chỉ HTTPS hoặc HTTP loopback, không đặt token trong URL.'); }
if (base) {
  const address = base.href.replace(/\/$/, '');
  try {
    const response = await fetch(address + '/health', { signal: AbortSignal.timeout(2500), redirect: 'error' });
    const health = await response.json() as any;
    const ownService = response.ok && health.service === 'zeroleak-sandbox-api';
    add('API health', ownService, 'Khởi động API bằng pnpm dev:voice-extended.');
    if (ownService) {
      add('Voice strategy: '+values.strategy, health.voice?.analysisStrategy === values.strategy, 'Dừng API cũ và chạy '+startCommand+'.');
      add('Extended-only route', JSON.stringify(health.voice?.modelRoute) === JSON.stringify([expectedModel]), 'Dừng API cũ và chạy pnpm dev:voice-extended.');
      if(values.strategy==='hybrid'){
        add('Acoustic endpoint configured',health.voice?.localAcousticConfigured===true,'Khởi động bằng pnpm dev:voice-pro.');
        try{
          const endpoint=new URL(localAcousticEndpoint(values['acoustic-base']!));
          const response=await fetch(endpoint.origin+'/health',{signal:AbortSignal.timeout(2500),redirect:'error'});
          const worker=await response.json() as any;
          const version=createHash('sha256').update(readFileSync(repo+'apps/sandbox-api/models/voice-linear-v3.json')).digest('hex');
          add('Acoustic worker ready and matching V3',response.ok&&worker.ready===true&&worker.warmupComplete===true&&worker.modelVersion===version,'Kiểm tra worker/asset hoặc --acoustic-base.');
        }catch{add('Acoustic worker reachable',false,'Kiểm tra worker/asset hoặc --acoustic-base.');}
      }
      add('Live API runtime', health.voice?.liveApi === true, 'Khởi động API bằng Node.js >=22.');
      // Deliberately invalid input must fail validation before any Google call.
      const headers: Record<string,string> = { 'Content-Type':'application/json' };
      if (process.env.VOICE_API_TOKEN) headers.Authorization = 'Bearer ' + process.env.VOICE_API_TOKEN;
      const invalid = await fetch(address + '/api/v1/analyze-voice', { method:'POST', headers, body:'{}', signal:AbortSignal.timeout(2500), redirect:'error' });
      const body = await invalid.json() as any;
      add('Reject invalid audio before analysis', invalid.status === 400 && body.error?.code === 'INVALID_INPUT', 'Kiểm tra mã truy cập và phiên bản API; không sử dụng kết quả SAFE thay cho lỗi.');
    }
  } catch { add('API reachable', false, 'Kiểm tra API/địa chỉ; mặc định pnpm dev:voice-extended chạy cổng8080.'); }
}
const passed = checks.every(check => check.ok);
console.log(JSON.stringify({ passed, checks, providerCalls:0, providerVerified:false, scope:'Chỉ kiểm tra cấu hình cục bộ. Chưa xác minh key/quota, độ chính xác hoặc độ trễ Gemini; cần thử audio riêng.' }, null, 2));
process.exitCode = passed ? 0 : 1;
