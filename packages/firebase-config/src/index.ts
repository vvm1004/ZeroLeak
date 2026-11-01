import type {
  SecurityPolicy,
  ZeroKnowledgeTelemetryEvent,
} from '@zeroleak/shared-types';
import { DEFAULT_SECURITY_POLICY } from '@zeroleak/shared-types';

export interface FirebaseConfigOptions {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

/**
 * Fallback in-memory and BroadcastChannel bus
 * Enables realtime sync during live tests even before Firebase project keys are filled in.
 */
class LocalRealtimeChannel {
  private policyListeners = new Set<(policy: SecurityPolicy) => void>();
  private telemetryListeners = new Set<(events: ZeroKnowledgeTelemetryEvent[]) => void>();
  private currentPolicy: SecurityPolicy = { ...DEFAULT_SECURITY_POLICY };
  private telemetryHistory: ZeroKnowledgeTelemetryEvent[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel('zeroleak-realtime-sync');
      bc.onmessage = (event) => {
        if (event.data?.type === 'POLICY_UPDATE') {
          this.currentPolicy = event.data.policy;
          this.notifyPolicy(this.currentPolicy);
        } else if (event.data?.type === 'TELEMETRY_EVENT') {
          this.telemetryHistory.unshift(event.data.event);
          this.notifyTelemetry([...this.telemetryHistory]);
        }
      };
    }
  }

  public subscribePolicy(callback: (policy: SecurityPolicy) => void): () => void {
    this.policyListeners.add(callback);
    callback(this.currentPolicy);
    return () => this.policyListeners.delete(callback);
  }

  public async setPolicy(policy: SecurityPolicy): Promise<void> {
    this.currentPolicy = policy;
    this.notifyPolicy(policy);
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      new BroadcastChannel('zeroleak-realtime-sync').postMessage({
        type: 'POLICY_UPDATE',
        policy,
      });
    }
  }

  public async logTelemetry(event: ZeroKnowledgeTelemetryEvent): Promise<void> {
    this.telemetryHistory.unshift(event);
    if (this.telemetryHistory.length > 100) {
      this.telemetryHistory.pop();
    }
    this.notifyTelemetry([...this.telemetryHistory]);
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      new BroadcastChannel('zeroleak-realtime-sync').postMessage({
        type: 'TELEMETRY_EVENT',
        event,
      });
    }
  }

  public subscribeTelemetry(callback: (events: ZeroKnowledgeTelemetryEvent[]) => void): () => void {
    this.telemetryListeners.add(callback);
    callback([...this.telemetryHistory]);
    return () => this.telemetryListeners.delete(callback);
  }

  private notifyPolicy(policy: SecurityPolicy) {
    for (const listener of this.policyListeners) {
      try {
        listener(policy);
      } catch (err) {
        console.error('[ZeroLeak LocalSync] Policy listener error:', err);
      }
    }
  }

  private notifyTelemetry(events: ZeroKnowledgeTelemetryEvent[]) {
    for (const listener of this.telemetryListeners) {
      try {
        listener(events);
      } catch (err) {
        console.error('[ZeroLeak LocalSync] Telemetry listener error:', err);
      }
    }
  }
}

export const localSyncBus = new LocalRealtimeChannel();

/**
 * Standard Firestore Collection names
 */
export const FIRESTORE_COLLECTIONS = {
  POLICIES: 'policies',
  TELEMETRY_EVENTS: 'telemetry_events',
} as const;

export const DEFAULT_POLICY_DOC_ID = 'active_policy';

/**
 * Parses client env configuration with fallbacks
 */
export function getFirebaseConfig(): FirebaseConfigOptions {
  if (typeof process !== 'undefined' && process.env) {
    return {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    };
  }
  return {};
}

