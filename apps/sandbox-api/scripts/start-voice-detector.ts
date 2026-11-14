import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { localAcousticEndpoint } from '../src/voice-acoustic.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const cache = process.env.VOICE_MODEL_CACHE || join(homedir(), 'Library', 'Caches', 'ZeroLeak', 'voice');
const python = process.env.VOICE_PYTHON || join(cache, 'venv', 'bin', 'python');
const endpoint = new URL(localAcousticEndpoint(process.env.VOICE_ACOUSTIC_URL || 'http://127.0.0.1:8081'));
if (endpoint.hostname !== '127.0.0.1') throw new Error('Local detector currently binds to 127.0.0.1.');
if (!existsSync(python)) throw new Error('Missing Voice Python environment. Follow docs/VOICE_DETECTOR_V3.md.');
const child = spawn(python, [fileURLToPath(new URL('voice_acoustic.py', import.meta.url)),
  '--xlsr-assets', resolve(cache, 'xlsr'), '--aasist-assets', resolve(cache, 'aasist'),
  '--vad', resolve(cache, 'silero_vad.jit'), '--head', fileURLToPath(new URL('../models/voice-linear-v3.json', import.meta.url)),
  '--port', endpoint.port || '80'], {
  stdio: 'inherit', env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Could not start the local Voice detector.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
