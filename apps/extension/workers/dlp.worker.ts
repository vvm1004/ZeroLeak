import type { SensitiveDataType } from '@zeroleak/shared-types';
import { scanMultiLayerDlp } from '../utils/deterministic-dlp';

interface DlpWorkerRequest {
  id: string;
  text: string;
  enabledTypes: SensitiveDataType[];
}

interface DlpWorkerResponse {
  id: string;
  result: Awaited<ReturnType<typeof scanMultiLayerDlp>>;
  error?: string;
}

// Web Worker message listener
self.onmessage = async (e: MessageEvent<DlpWorkerRequest>) => {
  const { id, text, enabledTypes } = e.data;

  try {
    const result = await scanMultiLayerDlp(text, enabledTypes);
    const response: DlpWorkerResponse = {
      id,
      result,
    };
    self.postMessage(response);
  } catch (err: any) {
    self.postMessage({
      id,
      result: {
        sanitizedText: text,
        matches: [],
        scanLatencyMs: 0,
        entropyMax: 0,
      },
      error: err?.message || 'Worker scan failed',
    });
  }
};
