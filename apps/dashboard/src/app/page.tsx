import { Shield, Lock, Eye, Activity } from 'lucide-react';

export default function DashboardHome() {
  return (
    <main className="container mx-auto px-6 py-10 max-w-7xl">
      <header className="flex items-center justify-between pb-8 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
              <Shield className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              ZeroLeak &amp; PhishGuard
            </h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Realtime Policy Enforcement &amp; Zero-Knowledge Telemetry Console
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
          <Activity className="w-3.5 h-3.5 animate-pulse" />
          <span>Realtime Engine Active</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-sm font-medium">On-Device DLP Status</span>
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">AUTO_TOKENIZE</div>
          <p className="text-xs text-slate-500 mt-1">Zero raw PII leaves user endpoints</p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-sm font-medium">Visual Phishing Sandbox</span>
            <Eye className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white">Ready</div>
          <p className="text-xs text-slate-500 mt-1">Gemini 3.5 Flash Lite + Playwright Sandbox</p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-sm font-medium">Active Policy Version</span>
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">v1.0.0</div>
          <p className="text-xs text-slate-500 mt-1">Synced with Cloud Firestore</p>
        </div>
      </div>
    </main>
  );
}

