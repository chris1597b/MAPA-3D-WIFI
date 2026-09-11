import React, { useState, useRef, useCallback, useEffect } from "react";
import { CameraRecorder } from "./components/CameraRecorder";
import { ThreeMapViewer } from "./components/ThreeMapViewer";
import { LingBotConfigModal } from "./components/LingBotConfigModal";
import { GeminiSceneAnalysis } from "./components/GeminiSceneAnalysis";
import { KeyframeGallery } from "./components/KeyframeGallery";
import { VisualOdometryEngine } from "./utils/visualOdometry";
import { exportToPLY, exportToOBJ, exportTrajectoryTUM } from "./utils/export3D";
import {
  Point3D,
  CameraPose,
  Keyframe,
  SemanticPin,
  LingBotConfig,
  MapViewOptions,
  ReconstructionStats,
} from "./types/slam";
import {
  Video,
  Box,
  Layers,
  Settings,
  Download,
  RotateCcw,
  Sparkles,
  Server,
  Share2,
  Maximize,
  Minimize,
  Columns,
  Cpu,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  Info,
} from "lucide-react";

export default function App() {
  // Visual Odometry Engine reference (singleton)
  const engineRef = useRef<VisualOdometryEngine>(new VisualOdometryEngine());

  // SLAM State
  const [points, setPoints] = useState<Point3D[]>([]);
  const [currentPose, setCurrentPose] = useState<CameraPose>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    euler: { pitch: 0, yaw: 0, roll: 0 },
    timestamp: Date.now(),
    frameId: 0,
  });
  const [trajectory, setTrajectory] = useState<CameraPose[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [activeKeyframe, setActiveKeyframe] = useState<Keyframe | null>(null);
  const [semanticPins, setSemanticPins] = useState<SemanticPin[]>([]);

  // UI layout modes: 'split' | 'map-focus' | 'camera-focus'
  const [layoutMode, setLayoutMode] = useState<"split" | "map-focus" | "camera-focus">("split");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showKeyframeGallery, setShowKeyframeGallery] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Latest frame snapshot for Gemini or LingBot proxy
  const lastSnapshotRef = useRef<string | null>(null);

  // LingBot Configuration
  const [lingBotConfig, setLingBotConfig] = useState<LingBotConfig>({
    mode: "browser-embedded",
    serverUrl: "http://localhost:8000",
    connected: false,
    fpsTarget: 18,
    maxPointsBudget: 45000,
    pointCloudVoxelSize: 0.04,
    intrinsics: {
      fx: 400,
      fy: 400,
      cx: 160,
      cy: 120,
    },
  });

  // Map 3D View Options
  const [mapOptions, setMapOptions] = useState<MapViewOptions>({
    colorMode: "rgb",
    pointSize: 2.5,
    showTrajectory: true,
    showFrustum: true,
    showKeyframes: true,
    showMesh: false,
    showGrid: true,
    measureMode: false,
  });

  // Performance & Stats
  const [stats, setStats] = useState<ReconstructionStats>({
    pointsCount: 0,
    keyframesCount: 0,
    trajectoryLengthMeters: 0,
    currentFps: 0,
    latencyMs: 16,
    processingEngine: "Motor Web SLAM (GCT Sim)",
    framesProcessed: 0,
  });

  // Keep VO engine settings synced
  useEffect(() => {
    engineRef.current.setMaxPoints(lingBotConfig.maxPointsBudget);
    engineRef.current.setVoxelSize(lingBotConfig.pointCloudVoxelSize);
  }, [lingBotConfig.maxPointsBudget, lingBotConfig.pointCloudVoxelSize]);

  // Handle incoming video frame from CameraRecorder
  const handleFrame = useCallback(
    async (canvas: HTMLCanvasElement, deviceOrientation?: { alpha: number; beta: number; gamma: number } | null) => {
      // Save base64 snapshot periodically
      if (Math.random() < 0.25) {
        lastSnapshotRef.current = canvas.toDataURL("image/jpeg", 0.75);
      }

      // If connected to remote LingBot-Map server
      if (lingBotConfig.mode === "remote-server" && lingBotConfig.connected) {
        const frameData = canvas.toDataURL("image/jpeg", 0.7);
        try {
          const t0 = performance.now();
          const response = await fetch("/api/lingbot/stream-frame", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverUrl: lingBotConfig.serverUrl,
              frameData,
              intrinsics: lingBotConfig.intrinsics,
              timestamp: Date.now(),
            }),
          });
          if (response.ok) {
            const data = await response.json();
            const latency = performance.now() - t0;
            if (data.points) {
              engineRef.current.injectLingBotPoints(data.points, data.pose);
              setPoints(engineRef.current.getPoints());
              setCurrentPose(engineRef.current.getCurrentPose());
              setTrajectory([...engineRef.current.getTrajectory()]);
              setStats((prev) => ({
                ...prev,
                pointsCount: engineRef.current.getPoints().length,
                trajectoryLengthMeters: engineRef.current.getTotalDistance(),
                latencyMs: Math.round(latency),
                framesProcessed: prev.framesProcessed + 1,
                processingEngine: "LingBot-Map (PyTorch GPU)",
              }));
              return;
            }
          }
        } catch (e) {
          console.warn("LingBot remote server stream fallback to internal engine:", e);
        }
      }

      // Default: In-browser Geometric Context Visual Odometry engine
      const t0 = performance.now();
      const result = engineRef.current.processFrame(canvas, deviceOrientation);
      const latency = performance.now() - t0;

      // Throttle React state updates to ~15fps for UI smoothness
      setPoints(engineRef.current.getPoints());
      setCurrentPose({ ...result.pose });

      if (result.isKeyframe || engineRef.current.getCurrentPose().frameId % 4 === 0) {
        setTrajectory([...engineRef.current.getTrajectory()]);
        setKeyframes([...engineRef.current.getKeyframes()]);
      }

      setStats((prev) => ({
        ...prev,
        pointsCount: engineRef.current.getPoints().length,
        keyframesCount: engineRef.current.getKeyframes().length,
        trajectoryLengthMeters: engineRef.current.getTotalDistance(),
        latencyMs: Math.round(latency),
        framesProcessed: prev.framesProcessed + 1,
        processingEngine: "Motor Web SLAM (LingBot-GCT)",
      }));
    },
    [lingBotConfig]
  );

  // Reset reconstruction map
  const handleResetMap = () => {
    if (confirm("¿Deseas reiniciar y borrar el mapa 3D actual?")) {
      engineRef.current.reset();
      setPoints([]);
      setTrajectory([]);
      setKeyframes([]);
      setSemanticPins([]);
      setActiveKeyframe(null);
      setStats((prev) => ({
        ...prev,
        pointsCount: 0,
        keyframesCount: 0,
        trajectoryLengthMeters: 0,
        framesProcessed: 0,
      }));
    }
  };

  // Test connection to remote server
  const handleTestConnection = async (url: string) => {
    const res = await fetch("/api/lingbot/check-server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverUrl: url }),
    });
    const data = await res.json();
    if (data.connected) {
      return { connected: true, message: "Conectado exitosamente con LingBot-Map Server!" };
    }
    return { connected: false, message: data.error || "No se pudo conectar al servidor" };
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden select-none font-sans">
      {/* Top Application Navigation Bar */}
      <header className="h-14 px-4 border-b border-slate-800/90 bg-slate-900/90 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
        {/* App Title & Repo Brand */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-900/40">
            <Box className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm tracking-tight text-slate-100">
                LingBot 3D Live Map
              </h1>
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                Streaming SLAM
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Reconstrucción geométrica 3D en tiempo real desde la cámara del celular
            </p>
          </div>
        </div>

        {/* Live Metrics Telemetry */}
        <div className="hidden md:flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/50">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-slate-400">Puntos:</span>
            <span className="text-cyan-300 font-semibold">{points.length.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/50">
            <span className="text-slate-400">Distancia:</span>
            <span className="text-emerald-300 font-semibold">
              {stats.trajectoryLengthMeters.toFixed(2)} m
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800/70 border border-slate-700/50">
            <span className="text-slate-400">Latencia:</span>
            <span className="text-amber-300 font-semibold">{stats.latencyMs} ms</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Gemini AI 3D Semantic Labeling */}
          <GeminiSceneAnalysis
            currentPose={currentPose}
            onAddSemanticPin={(pin) => setSemanticPins((prev) => [...prev, pin])}
            getFrameSnapshot={() => lastSnapshotRef.current}
          />

          {/* Export Dropdown */}
          <div className="relative">
            <button
              id="btn-export-dropdown"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Exportar 3D</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-xl p-1.5 z-50 text-xs animate-in fade-in">
                <button
                  id="btn-export-ply"
                  onClick={() => {
                    exportToPLY(points);
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between"
                >
                  <span>Nube de Puntos (.PLY)</span>
                  <span className="text-[10px] text-cyan-400 font-mono">MeshLab</span>
                </button>
                <button
                  id="btn-export-obj"
                  onClick={() => {
                    exportToOBJ(points);
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between"
                >
                  <span>Geometría (.OBJ)</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Blender</span>
                </button>
                <button
                  id="btn-export-tum"
                  onClick={() => {
                    exportTrajectoryTUM(trajectory);
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 text-slate-200 flex items-center justify-between"
                >
                  <span>Trayectoria (.TUM)</span>
                  <span className="text-[10px] text-amber-400 font-mono">SLAM</span>
                </button>
              </div>
            )}
          </div>

          {/* Reset Map */}
          <button
            id="btn-reset-map"
            onClick={handleResetMap}
            title="Reiniciar Mapa 3D"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all active:scale-95"
          >
            <RotateCcw className="w-4 h-4 text-rose-400" />
          </button>

          {/* Settings / LingBot Configuration */}
          <button
            id="btn-open-config"
            onClick={() => setShowConfigModal(true)}
            title="Configuración LingBot-Map"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Settings className="w-4 h-4 text-cyan-400" />
            <span className="hidden lg:inline text-xs font-medium">Configuración</span>
          </button>
        </div>
      </header>

      {/* Main Workspace (Split View / Focused Views) */}
      <main className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Camera Pane */}
        <div
          className={`relative transition-all duration-300 ${
            layoutMode === "split"
              ? "h-1/2 md:h-full md:w-1/2 border-b md:border-b-0 md:border-r border-slate-800"
              : layoutMode === "camera-focus"
              ? "w-full h-full"
              : "absolute bottom-4 right-4 w-52 h-40 md:w-72 md:h-52 rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl z-30"
          }`}
        >
          <CameraRecorder
            onFrame={handleFrame}
            isStreaming={isStreaming}
            onToggleStreaming={setIsStreaming}
            fpsTarget={lingBotConfig.fpsTarget}
            onSnapshot={(thumb) => {
              const kf: Keyframe = {
                id: keyframes.length + 1,
                timestamp: Date.now(),
                thumbnail: thumb,
                pose: { ...currentPose },
                pointsCount: points.length,
              };
              setKeyframes((prev) => [...prev, kf]);
              setShowKeyframeGallery(true);
            }}
          />

          {/* Minimize / Maximize View Mode badge */}
          {layoutMode !== "camera-focus" && (
            <button
              id="btn-focus-camera"
              onClick={() => setLayoutMode(layoutMode === "split" ? "camera-focus" : "split")}
              title="Expandir Cámara"
              className="absolute top-3 right-3 p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/70 shadow-lg backdrop-blur-md z-20 transition-all"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 3D Map Pane */}
        <div
          className={`relative transition-all duration-300 ${
            layoutMode === "split"
              ? "h-1/2 md:h-full md:w-1/2"
              : layoutMode === "map-focus"
              ? "w-full h-full"
              : "absolute bottom-4 right-4 w-52 h-40 md:w-72 md:h-52 rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl z-30"
          }`}
        >
          <ThreeMapViewer
            points={points}
            currentPose={currentPose}
            trajectory={trajectory}
            keyframes={keyframes}
            semanticPins={semanticPins}
            options={mapOptions}
            onOptionsChange={(newOpts) => setMapOptions((prev) => ({ ...prev, ...newOpts }))}
            onSelectKeyframe={(kf) => {
              setActiveKeyframe(kf);
              setShowKeyframeGallery(true);
            }}
            activeKeyframe={activeKeyframe}
          />

          {/* Minimize / Maximize View Mode badge */}
          {layoutMode !== "map-focus" && (
            <button
              id="btn-focus-map"
              onClick={() => setLayoutMode(layoutMode === "split" ? "map-focus" : "split")}
              title="Expandir Mapa 3D"
              className="absolute top-14 right-3 p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/70 shadow-lg backdrop-blur-md z-20 transition-all"
            >
              <Maximize className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          )}

          {/* Layout switcher bar (Bottom Center) */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/85 border border-slate-800 backdrop-blur-md shadow-xl z-20 text-xs">
            <button
              onClick={() => setLayoutMode("split")}
              title="Vista Dividida 50/50"
              className={`p-2 rounded-lg transition-all ${
                layoutMode === "split"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setLayoutMode("map-focus")}
              title="Mapa 3D Completo"
              className={`p-2 rounded-lg transition-all ${
                layoutMode === "map-focus"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Box className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setLayoutMode("camera-focus")}
              title="Cámara Completa"
              className={`p-2 rounded-lg transition-all ${
                layoutMode === "camera-focus"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Video className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Keyframe Timeline Bar Drawer */}
        <KeyframeGallery
          keyframes={keyframes}
          activeKeyframe={activeKeyframe}
          onSelectKeyframe={(kf) => setActiveKeyframe(kf)}
          isOpen={showKeyframeGallery}
          onClose={() => setShowKeyframeGallery(false)}
        />
      </main>

      {/* LingBot Configuration Modal */}
      <LingBotConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        config={lingBotConfig}
        onSaveConfig={(newCfg) => setLingBotConfig((prev) => ({ ...prev, ...newCfg }))}
        onTestConnection={handleTestConnection}
      />
    </div>
  );
}
