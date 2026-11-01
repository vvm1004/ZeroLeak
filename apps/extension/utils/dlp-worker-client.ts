import type { DlpScanResult, SensitiveDataType } from '@zeroleak/shared-types';
import { scanMultiLayerDlp } from './deterministic-dlp';

class DlpWorkerClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (res: DlpScanResult) => void; reject: (err: any) => void }
  >();

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        // Create Web Worker using modern ESM URL resolver compatible with Vite/WXT
        this.worker = new Worker(
          new URL('../workers/dlp.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (e: MessageEvent) => {
          const { id, result, error } = e.data;
          const handler = this.pendingRequests.get(id);
          if (handler) {
            this.pendingRequests.delete(id);
            if (error) {
              handler.reject(new Error(error));
            } else {
              handler.resolve(result);
            }
          }
        };

        this.worker.onerror = (err) => {
          console.warn('[ZeroLeak Worker] Worker error, falling back to main-thread execution:', err);
        };
      }
    } catch (e) {
      console.warn('[ZeroLeak Worker] Worker initialization skipped, running on main thread:', e);
      this.worker = null;
    }
  }

  /**
   * Scans text with Web Worker if available and text is non-trivial;
   * otherwise executes asynchronously on main thread with zero latency overhead.
   */
  public async scan(
    text: string,
    enabledTypes: SensitiveDataType[]
  ): Promise<DlpScanResult> {
    // For small texts (< 300 chars) or if worker is unavailable, execute directly
    if (!this.worker || text.length < 300) {
      return scanMultiLayerDlp(text, enabledTypes);
    }

    const id = 'req_' + Math.random().toString(36).substring(2, 9);

    return new Promise<DlpScanResult>((resolve) => {
      // Safety timeout: 1500ms fallback
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          // Fallback to direct scan
          scanMultiLayerDlp(text, enabledTypes).then(resolve);
        }
      }, 1500);

      this.pendingRequests.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: () => {
          clearTimeout(timer);
          scanMultiLayerDlp(text, enabledTypes).then(resolve);
        },
      });

      this.worker!.postMessage({
        id,
        text,
        enabledTypes,
      });
    });
  }
}

export const dlpClient = new DlpWorkerClient();

