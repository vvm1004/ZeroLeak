export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_WINDOW_SAMPLES = VOICE_SAMPLE_RATE * 5;

/** Each request is an independent PCM WAV, not an undecodable WebM fragment. */
export function encodeVoiceWav(samples: Float32Array): Uint8Array {
  if (samples.length < 8000 || samples.length > VOICE_WINDOW_SAMPLES) throw new Error('Cần từ 0,5 đến 5 giây âm thanh.');
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true); view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Âm thanh chứa dữ liệu không hợp lệ.');
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export function audioToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function audioRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export class VoiceWindowBuffer {
  private buffer = new Float32Array(VOICE_WINDOW_SAMPLES);
  private offset = 0;
  push(chunk: Float32Array): Float32Array[] {
    const windows: Float32Array[] = [];
    let pos = 0;
    while (pos < chunk.length) {
      const count = Math.min(chunk.length - pos, this.buffer.length - this.offset);
      this.buffer.set(chunk.subarray(pos, pos + count), this.offset);
      this.offset += count; pos += count;
      if (this.offset === this.buffer.length) {
        windows.push(this.buffer);
        this.buffer = new Float32Array(VOICE_WINDOW_SAMPLES);
        this.offset = 0;
      }
    }
    return windows;
  }
}

/** Decode locally and send only the first 5 seconds; never upload the original file. */
export async function readVoiceFile(file: File): Promise<Float32Array> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Chọn file âm thanh nhỏ hơn 10 MB.');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = Math.min(VOICE_WINDOW_SAMPLES, Math.floor(decoded.duration * VOICE_SAMPLE_RATE));
    if (length < 8000) throw new Error('File cần có ít nhất 0,5 giây âm thanh.');
    const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    return (await offline.startRendering()).getChannelData(0).slice();
  } finally { await context.close(); }
}
