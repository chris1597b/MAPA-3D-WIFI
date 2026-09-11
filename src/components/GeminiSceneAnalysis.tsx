import React, { useState } from "react";
import { Sparkles, MapPin, Check, AlertCircle, Loader2 } from "lucide-react";
import { SemanticPin, CameraPose } from "../types/slam";

interface GeminiSceneAnalysisProps {
  onAddSemanticPin: (pin: SemanticPin) => void;
  currentPose: CameraPose;
  getFrameSnapshot: () => string | null;
}

export const GeminiSceneAnalysis: React.FC<GeminiSceneAnalysisProps> = ({
  onAddSemanticPin,
  currentPose,
  getFrameSnapshot,
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleAnalyze = async () => {
    const frameBase64 = getFrameSnapshot();
    if (!frameBase64) {
      setError("Abre la cámara o reproduce un video para analizar la escena.");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setIsOpen(true);

    try {
      const response = await fetch("/api/gemini/analyze-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: frameBase64,
          cameraPose: currentPose,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Error en el servidor" }));
        throw new Error(errData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      if (data.analysis) {
        setLastAnalysis(data.analysis);

        // Convert detected objects into 3D Semantic Pins
        if (Array.isArray(data.analysis.objects)) {
          data.analysis.objects.forEach((obj: any, idx: number) => {
            const dist = obj.estimatedDistanceMeters || 1.8;
            // Project forward in camera direction
            const yaw = currentPose.euler?.yaw || 0;
            const xOffset = obj.relativePosition === "izquierda" ? -0.5 : obj.relativePosition === "derecha" ? 0.5 : 0;
            const worldX = currentPose.position.x + Math.sin(yaw) * dist + xOffset;
            const worldZ = currentPose.position.z + Math.cos(yaw) * dist;
            const worldY = currentPose.position.y - 0.2;

            const pin: SemanticPin = {
              id: `pin_${Date.now()}_${idx}`,
              name: obj.name || "Objeto detectado",
              category: obj.category || "objeto",
              position: { x: worldX, y: worldY, z: worldZ },
              confidence: obj.confidence || 0.9,
              distanceMeters: dist,
            };

            onAddSemanticPin(pin);
          });
        }
      }
    } catch (err: any) {
      console.error("Gemini analysis failed", err);
      setError(err.message || "Error al analizar escena");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="relative">
      <button
        id="btn-gemini-analyze"
        onClick={handleAnalyze}
        disabled={analyzing}
        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-medium shadow-lg shadow-indigo-900/30 flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
      >
        {analyzing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Escaneando con IA...</span>
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Semántica Gemini 3D</span>
          </>
        )}
      </button>

      {/* Analysis Result Drawer / Floating Card */}
      {isOpen && (
        <div className="absolute top-12 right-0 w-80 bg-slate-900/95 border border-indigo-500/40 rounded-2xl shadow-2xl backdrop-blur-md p-4 z-40 text-xs animate-in fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <div className="flex items-center gap-1.5 font-semibold text-indigo-300">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Detección Semántica en 3D</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {lastAnalysis && (
            <div className="space-y-3">
              <div>
                <span className="text-[11px] text-slate-400">Tipo de entorno:</span>
                <p className="font-medium text-slate-200 capitalize">
                  {lastAnalysis.sceneType || "Entorno capturado"}
                </p>
                {lastAnalysis.description && (
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {lastAnalysis.description}
                  </p>
                )}
              </div>

              {Array.isArray(lastAnalysis.objects) && lastAnalysis.objects.length > 0 && (
                <div>
                  <span className="text-[11px] text-slate-400 mb-1.5 block">
                    Objetos anclados en el mapa 3D:
                  </span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {lastAnalysis.objects.map((obj: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          <div>
                            <span className="font-medium text-slate-100">{obj.name}</span>
                            <span className="text-[10px] text-slate-400 ml-1.5 capitalize">
                              ({obj.category})
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-cyan-400">
                          ~{obj.estimatedDistanceMeters || 1.5}m
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
