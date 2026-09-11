import React, { useState } from "react";
import { LingBotConfig } from "../types/slam";
import {
  Server,
  Cpu,
  Globe,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  Sliders,
  Terminal,
  Zap,
} from "lucide-react";

interface LingBotConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LingBotConfig;
  onSaveConfig: (newConfig: Partial<LingBotConfig>) => void;
  onTestConnection: (url: string) => Promise<{ connected: boolean; message: string }>;
}

export const LingBotConfigModal: React.FC<LingBotConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onTestConnection,
}) => {
  const [mode, setMode] = useState<"browser-embedded" | "remote-server">(config.mode);
  const [serverUrl, setServerUrl] = useState(config.serverUrl || "http://localhost:8000");
  const [fpsTarget, setFpsTarget] = useState(config.fpsTarget || 18);
  const [maxPointsBudget, setMaxPointsBudget] = useState(config.maxPointsBudget || 45000);
  const [voxelSize, setVoxelSize] = useState(config.pointCloudVoxelSize || 0.04);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const pythonCode = `# 1. Clona el repositorio oficial de Robbyant LingBot-Map:
git clone https://github.com/Robbyant/lingbot-map.git
cd lingbot-map

# 2. Instala dependencias con aceleración CUDA/PyTorch:
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install fastapi uvicorn pydantic python-multipart opencv-python numpy

# 3. Ejecuta el servidor puente para la aplicación:
python lingbot_runner.py --port 8000`;

  const handleCopy = () => {
    navigator.clipboard.writeText(pythonCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(serverUrl);
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ connected: false, message: e.message || "Error de red" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    onSaveConfig({
      mode,
      serverUrl,
      fpsTarget,
      maxPointsBudget,
      pointCloudVoxelSize: voxelSize,
      connected: testResult?.connected ?? config.connected,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                Configuración LingBot-Map
                <a
                  href="https://github.com/Robbyant/lingbot-map"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 font-normal"
                >
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </h2>
              <p className="text-xs text-slate-400">
                Modelo de fundación 3D para streaming reconstruction en tiempo real
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-all"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Motor de Reconstrucción 3D
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode("browser-embedded")}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  mode === "browser-embedded"
                    ? "bg-cyan-500/10 border-cyan-500/80 ring-1 ring-cyan-500/50"
                    : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span className="font-semibold text-slate-100">Motor Web SLAM</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ejecución directa en el navegador. No requiere GPU externa ni servidores. Listo al instante.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode("remote-server")}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  mode === "remote-server"
                    ? "bg-cyan-500/10 border-cyan-500/80 ring-1 ring-cyan-500/50"
                    : "bg-slate-800/40 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold text-slate-100">Servidor LingBot GPU</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Conexión a modelo PyTorch LingBot-Map en PC local, RunPod o Colab.
                </p>
              </button>
            </div>
          </div>

          {/* Remote Server Setup */}
          {mode === "remote-server" && (
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
              <label className="block text-xs font-medium text-slate-300">
                URL del Servidor LingBot-Map
              </label>
              <div className="flex gap-2">
                <input
                  id="input-server-url"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:8000"
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-xs focus:ring-1 focus:ring-cyan-400 focus:outline-none font-mono"
                />
                <button
                  id="btn-test-connection"
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {testing ? (
                    <span className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  Probar
                </button>
              </div>

              {testResult && (
                <div
                  className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                    testResult.connected
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                      : "bg-rose-500/10 border border-rose-500/30 text-rose-300"
                  }`}
                >
                  {testResult.connected ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Instructions toggle / script */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-slate-400" /> Comandos de ejecución rápida
                  </span>
                  <button
                    onClick={handleCopy}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3 h-3" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copiar comandos
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 text-slate-300 text-[11px] font-mono overflow-x-auto border border-slate-800/80 leading-normal">
                  {pythonCode}
                </pre>
              </div>
            </div>
          )}

          {/* SLAM Parameters */}
          <div className="space-y-4">
            <h3 className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Parámetros de Captura & Rendimiento
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Tasa de Fotogramas (FPS):</span>
                  <span className="font-mono text-cyan-300">{fpsTarget} FPS</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="25"
                  step="1"
                  value={fpsTarget}
                  onChange={(e) => setFpsTarget(parseInt(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
                <span className="text-[11px] text-slate-500">
                  LingBot-Map opera nativamente a ~20 FPS.
                </span>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Presupuesto Máximo de Puntos:</span>
                  <span className="font-mono text-cyan-300">
                    {(maxPointsBudget / 1000).toFixed(0)}k pts
                  </span>
                </div>
                <input
                  type="range"
                  min="15000"
                  max="80000"
                  step="5000"
                  value={maxPointsBudget}
                  onChange={(e) => setMaxPointsBudget(parseInt(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
                <span className="text-[11px] text-slate-500">
                  Controla la densidad y memoria del mapa 3D.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 transition-all"
          >
            Cancelar
          </button>
          <button
            id="btn-save-lingbot-config"
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl text-xs font-medium bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-lg shadow-cyan-900/20 transition-all active:scale-95"
          >
            Guardar Configuración
          </button>
        </div>
      </div>
    </div>
  );
};
