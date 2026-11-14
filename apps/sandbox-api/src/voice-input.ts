import type { AnalyzeVoiceRequest } from '@zeroleak/shared-types';

export const MAX_VOICE_BYTES = 160_044; // 5s, PCM16 mono, 16kHz + WAV header.
export const MAX_VOICE_REQUEST_BYTES = 220_000;
export const MAX_VOICE_REVIEW_BYTES = 480_044; // 15s, review files only.
export const MAX_VOICE_REVIEW_REQUEST_BYTES = 650_000;

export class VoiceInputError extends Error {}

/** Bound and verify actual PCM frames; do not trust a client duration/MIME label. */
export function parseVoiceRequest(value: unknown): AnalyzeVoiceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VoiceInputError('Yêu cầu phải là một đối tượng JSON.');
  }
  const { audioBase64, mimeType, analysisMode } = value as Record<string, unknown>;
  if (analysisMode !== undefined && analysisMode !== 'realtime' && analysisMode !== 'review') throw new VoiceInputError('Chế độ phân tích không hợp lệ.');
  const maxBytes = analysisMode === 'review' ? MAX_VOICE_REVIEW_BYTES : MAX_VOICE_BYTES;
  const maxSeconds = analysisMode === 'review' ? 15 : 5;
  if (mimeType !== 'audio/wav' || typeof audioBase64 !== 'string' ||
      audioBase64.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)) {
    throw new VoiceInputError(`Cần âm thanh WAV Base64 hợp lệ, tối đa ${maxSeconds} giây.`);
  }
  const wav = Buffer.from(audioBase64, 'base64');
  if (wav.length < 44 || wav.length > maxBytes || wav.toString('ascii', 0, 4) !== 'RIFF' ||
      wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) + 8 !== wav.length) {
    throw new VoiceInputError('File WAV không hợp lệ hoặc vượt giới hạn dung lượng.');
  }
  let format = false;
  let data: Buffer | undefined;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const name = wav.toString('ascii', pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (start + size > wav.length) throw new VoiceInputError('File WAV bị thiếu dữ liệu.');
    if (name === 'fmt ') {
      if (format || size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 ||
          wav.readUInt32LE(start + 4) !== 16000 || wav.readUInt32LE(start + 8) !== 32000 ||
          wav.readUInt16LE(start + 12) !== 2 || wav.readUInt16LE(start + 14) !== 16) {
        throw new VoiceInputError('WAV cần ở định dạng PCM16, mono, 16 kHz.');
      }
      format = true;
    } else if (name === 'data') {
      if (data) throw new VoiceInputError('WAV chứa nhiều khối âm thanh.');
      data = wav.subarray(start, start + size);
    }
    pos = start + size + (size % 2);
  }
  if (!format || !data || data.length < 16000 || data.length > maxSeconds * 32000 || data.length % 2) {
    throw new VoiceInputError(`Cần từ 0,5 đến ${maxSeconds} giây âm thanh hợp lệ.`);
  }
  let energy = 0;
  for (let i = 0; i < data.length; i += 2) energy += (data.readInt16LE(i) / 32768) ** 2;
  if (Math.sqrt(energy / (data.length / 2)) < 0.001) {
    throw new VoiceInputError('Âm thanh quá nhỏ hoặc im lặng. Hãy thử thu lại.');
  }
  return { audioBase64, mimeType, ...(analysisMode === 'review' || analysisMode === 'realtime' ? { analysisMode } : {}) };
}

/** Extract the validated data chunk, including WAVs containing JUNK/LIST metadata chunks. */
export function voicePcmBytes(input: AnalyzeVoiceRequest): Buffer {
  const checked = parseVoiceRequest(input);
  const wav = Buffer.from(checked.audioBase64, 'base64');
  for (let pos = 12; pos + 8 <= wav.length;) {
    const size = wav.readUInt32LE(pos + 4);
    if (wav.toString('ascii', pos, pos + 4) === 'data') return wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  throw new VoiceInputError('WAV không chứa âm thanh.');
}


/** Remove only digital silence outside speech; never alter nonzero samples or internal pauses.
 * PCM has already passed WAV/RMS validation. Keep 200ms context and at least 0.5s.
 * This is lossless transport trimming, not speech/identity/deepfake detection.
 */
export function trimVoicePcm(pcm: Buffer): Buffer {
  let first = 0, last = pcm.length;
  while (first < last && pcm.readInt16LE(first) === 0) first += 2;
  if (first === last) return pcm;
  while (last > first && pcm.readInt16LE(last - 2) === 0) last -= 2;
  const start = Math.max(0, Math.min(first - 6400, pcm.length - 16000));
  const end = Math.min(pcm.length, Math.max(last + 6400, start + 16000));
  return pcm.subarray(start, end);
}
