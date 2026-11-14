import { VoiceWindowBuffer, VOICE_SAMPLE_RATE } from './voice-audio';

export type VoiceSource = 'microphone' | 'tab';
export interface VoiceCaptureCallbacks {
  onWindow: (samples: Float32Array) => void;
  onProgress: (seconds: number) => void;
  onAnalyser: (analyser: AnalyserNode | null) => void;
  onEnded: () => void;
}

export class VoiceCapture {
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private callbacks: VoiceCaptureCallbacks | null = null;

  async start(source: VoiceSource, callbacks: VoiceCaptureCallbacks): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.callbacks = callbacks;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      // Call the permission picker directly in the user's click, before other awaits.
      stream = source === 'microphone'
        ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
        : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { displaySurface: 'browser' } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      if (!stream.getAudioTracks().length) throw new Error('Tab chưa chia sẻ âm thanh. Chọn thẻ trình duyệt và bật “Chia sẻ âm thanh”.');
      this.stream = stream;
      context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
      this.context = context;
      if (context.sampleRate !== VOICE_SAMPLE_RATE) throw new Error('Trình duyệt chưa hỗ trợ thu âm 16 kHz. Hãy dùng Chrome mới.');
      await context.audioWorklet.addModule(chrome.runtime.getURL('/voice-worklet.js'));
      if (generation !== this.generation) return;
      const input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser = context.createAnalyser(); analyser.fftSize = 256;
      const node = new AudioWorkletNode(context, 'zeroleak-voice');
      this.node = node;
      const windows = new VoiceWindowBuffer();
      let received = 0;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (generation !== this.generation) return;
        received += event.data.length;
        callbacks.onProgress(Math.floor(received / VOICE_SAMPLE_RATE));
        for (const window of windows.push(event.data)) callbacks.onWindow(window);
      };
      input.connect(analyser); analyser.connect(node); node.connect(context.destination);
      await context.resume();
      if (generation !== this.generation) return;
      callbacks.onAnalyser(analyser);
      for (const track of stream.getTracks()) track.onended = () => {
        if (generation !== this.generation) return;
        this.stop(); callbacks.onEnded();
      };
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.generation++;
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
    this.callbacks?.onAnalyser(null);
    this.callbacks = null;
  }
}
