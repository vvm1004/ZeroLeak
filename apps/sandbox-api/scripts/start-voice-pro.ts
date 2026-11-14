/** Launch and clean up only owned services; optionally reuse a verified worker. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import { localAcousticEndpoint } from '../src/voice-acoustic.js';

dotenv.config({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const owned:ChildProcess[]=[];let stopping=false;
const alive=(child:ChildProcess)=>child.exitCode===null&&child.signalCode===null;
async function stop(code:number){
 if(stopping)return;stopping=true;
 for(const child of owned)if(alive(child))child.kill('SIGTERM');
 await Promise.race([Promise.all(owned.map(child=>alive(child)?new Promise<void>(resolve=>child.once('exit',()=>resolve())):Promise.resolve())),delay(3000)]);
 for(const child of owned)if(alive(child))child.kill('SIGKILL');
 process.exit(code);
}
process.once('SIGINT',()=>void stop(0));process.once('SIGTERM',()=>void stop(0));
async function freePort(port:number){
 await new Promise<void>((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(new Error(`Cổng ${port} đang được dùng. Dừng dịch vụ cũ hoặc chọn PORT/VOICE_ACOUSTIC_URL khác.`)));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve()));});
}
async function health(url:string):Promise<any>{
 try{const response=await fetch(url,{signal:AbortSignal.timeout(1000),redirect:'error'});return response.ok?await response.json():null;}catch{return null;}
}
async function waitReady(check:()=>Promise<boolean>,milliseconds:number){
 const end=Date.now()+milliseconds;
 while(!stopping&&Date.now()<end){if(await check())return;await delay(300);}
 throw new Error('Dịch vụ chưa sẵn sàng trong thời gian khởi động. Kiểm tra asset/venv và cổng đang dùng.');
}
function own(child:ChildProcess){
 owned.push(child);child.once('error',()=>{console.error('[Voice Pro] Không khởi động được dịch vụ con.');void stop(1);});
 child.once('exit',()=>{if(!stopping){console.error('[Voice Pro] Một dịch vụ đã dừng; đang đóng các tiến trình do lệnh này tạo.');void stop(1);}});return child;
}
try{
 if(Number(process.versions.node.split('.')[0])<22||typeof WebSocket!=='function')throw new Error('Cần Node.js >=22.');
 if(!process.env.GEMINI_API_KEY?.trim())throw new Error('Thiếu GEMINI_API_KEY trong .env.');
 const port=Number(process.env.PORT??8080);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT cần từ1024 đến65535.');
 const acoustic=new URL(localAcousticEndpoint(process.env.VOICE_ACOUSTIC_URL||'http://127.0.0.1:8081'));
 const workerPort=Number(acoustic.port||80);
 if(acoustic.hostname!=='127.0.0.1'||workerPort<1024||workerPort===port)throw new Error('Detector cần cổng loopback127.0.0.1 riêng, từ1024 trở lên.');
 await freePort(port);
 const head=fileURLToPath(new URL('../models/voice-linear-v3.json',import.meta.url));
 const version=createHash('sha256').update(readFileSync(head)).digest('hex');
 const workerHealth=`http://127.0.0.1:${workerPort}/health`;
 const validWorker=async()=>{const value=await health(workerHealth);return value?.ready===true&&value.modelVersion===version&&value.warmupComplete===true;};
 if(await validWorker())console.log('[Voice Pro] Dùng detector đang sẵn sàng, đúng phiên bản. Lệnh này sẽ không dừng worker có sẵn khi thoát.');
 else{
  await freePort(workerPort);
  const cache=process.env.VOICE_MODEL_CACHE||join(homedir(),'Library','Caches','ZeroLeak','voice');
  const python=process.env.VOICE_PYTHON||join(cache,'venv','bin','python');
  if(!existsSync(python))throw new Error('Thiếu môi trường Python/asset. Xem docs/VOICE_DETECTOR_V3.md.');
  console.log('[Voice Pro] Đang nạp và làm nóng detector trên máy…');
  own(spawn(python,[fileURLToPath(new URL('./voice_acoustic.py',import.meta.url)),
   '--xlsr-assets',join(cache,'xlsr'),'--aasist-assets',join(cache,'aasist'),'--vad',join(cache,'silero_vad.jit'),
   '--head',head,'--port',String(workerPort)],{stdio:'inherit',env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}}));
  await waitReady(validWorker,90000);
 }
 if(stopping)throw new Error('Đã hủy khởi động.');
 const model='gemini-3.8-live-extended-thinking';
 // Direct Node import hook avoids leaving watcher grandchildren after Ctrl+C.
 own(spawn(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../src/index.ts',import.meta.url))],{
  stdio:'inherit',env:{...process.env,NODE_ENV:'development',PORT:String(port),VOICE_ANALYSIS_STRATEGY:'hybrid',VOICE_ACOUSTIC_URL:acoustic.origin,
   GEMINI_MODEL_VOICE:model,GEMINI_MODEL_VOICE_REVIEW:model,GEMINI_MODEL_VOICE_LIVE_FALLBACK:model,GEMINI_MODEL_VOICE_FALLBACK:model},
 }));
 await waitReady(async()=>{const value=await health(`http://127.0.0.1:${port}/health`);return value?.service==='zeroleak-sandbox-api'&&value.voice?.analysisStrategy==='hybrid'&&JSON.stringify(value.voice.modelRoute)===JSON.stringify([model]);},15000);
 console.log(`[Voice Pro] Sẵn sàng tại http://127.0.0.1:${port} — Gemini phân tích nội dung, detector local phân tích giọng. Ctrl+C để dừng.`);
 console.log('[Voice Pro] Startup chỉ kiểm tra readiness; key/quota Google được xác minh khi bạn gửi audio. Sau khi sửa code, khởi động lại lệnh này.');
}catch(error){console.error('[Voice Pro] '+(error instanceof Error?error.message:'Không khởi động được Voice.'));await stop(1);}
