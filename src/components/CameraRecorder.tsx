import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera,
  Video,
  VideoOff,
  Disc,
  Square,
  SwitchCamera,
  Zap,
  ZapOff,
  Download,
  Upload,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  Radio,
} from "lucide-react";

interface CameraRecorderProps {
  onFrame: (canvas: HTMLCanvasElement, orientation?: { alpha: number; beta: number; gamma: number } | null) => void;
  isStreaming: boolean;
  onToggleStreaming: (active: boolean) => void;
  fpsTarget: number;
  onSnapshot?: (dataUrl: string) => void;
}

export const CameraRecorder: React.FC<CameraRecorderProps> = ({
  onFrame,
  isStreaming,
  onToggleStreaming,
  fpsTarget,
  onSnapshot,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // States
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [actualFps, setActualFps] = useState(0);
  const [resolution, setResolution] = useState<{ width: number; height: number }>({ width: 640, height: 480 });
  const [deviceOrientation, setDeviceOrientation] = useState<{ alpha: number; beta: number; gamma: number } | null>(null);

  // Measure actual processing FPS
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  // Listen to mobile device orientation (gyroscope/accelerometer)
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null && e.beta !== null && e.gamma !== null) {
        setDeviceOrientation({
          alpha: e.alpha,
          beta: e.beta,
          gamma: e.gamma,
        });
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", handleOrientation);
    }
    return () => {
      if (window.DeviceOrientationEvent) {
        window.removeEventListener("deviceorientation", handleOrientation);
      }
    };
  }, []);

  // Timer for video recording
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } else {
      setRecordSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // Request Camera Stream
  const startCamera = useCallback(async (desiredFacing: "environment" | "user" = facingMode) => {
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      // Constraints with ideal 518x378 or 640x480 (optimal for LingBot-Map SLAM)
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: {
          facingMode: { ideal: desiredFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: fpsTarget },
        },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback without audio or facing constraint if failed
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check track settings and torch capability
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        if (capabilities.torch) {
          setTorchAvailable(true);
        }
        const settings = videoTrack.getSettings();
        if (settings.width && settings.height) {
          setResolution({ width: settings.width, height: settings.height });
        }
      }

      setCameraActive(true);
      onToggleStreaming(true);
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError(
        err.name === "NotAllowedError"
          ? "Permiso de cámara denegado. Permite el acceso para continuar."
          : "No se pudo acceder a la cámara: " + (err.message || "Error desconocido")
      );
      setCameraActive(false);
    }
  }, [facingMode, fpsTarget, onToggleStreaming]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    onToggleStreaming(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, [onToggleStreaming]);

  // Flip Camera (Front / Rear)
  const toggleFacingMode = () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  // Toggle Torch
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && (track as any).applyConstraints) {
      try {
        const nextState = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      } catch (e) {
        console.error("Failed to toggle torch", e);
      }
    }
  };

  // Start / Stop Video Recording
  const toggleRecording = () => {
    if (!streamRef.current) return;

    if (isRecording) {
      // Stop
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      // Start recording
      recordedChunksRef.current = [];
      try {
        const mimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
          "video/mp4",
        ];
        let supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

        const recorder = new MediaRecorder(streamRef.current, {
          mimeType: supportedMime || undefined,
        });

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, {
            type: supportedMime || "video/webm",
          });
          const url = URL.createObjectURL(blob);
          setRecordedVideoUrl(url);
        };

        recorder.start(1000); // chunk every 1 sec
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch (err) {
        console.error("MediaRecorder start failed:", err);
      }
    }
  };

  // Frame processing loop
  useEffect(() => {
    if (!cameraActive || !isStreaming) return;

    const frameInterval = 1000 / fpsTarget;

    const processLoop = (time: number) => {
      animationFrameRef.current = requestAnimationFrame(processLoop);

      if (time - lastFrameTimeRef.current < frameInterval) {
        return;
      }
      lastFrameTimeRef.current = time;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Downsample to 518x378 or 320x240 for optimal real-time SLAM throughput
      const targetW = 320;
      const targetH = 240;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.drawImage(video, 0, 0, targetW, targetH);
      onFrame(canvas, deviceOrientation);

      // FPS tracking
      frameCountRef.current++;
      const now = Date.now();
      if (now - fpsTimerRef.current >= 1000) {
        setActualFps(frameCountRef.current);
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }
    };

    animationFrameRef.current = requestAnimationFrame(processLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [cameraActive, isStreaming, fpsTarget, onFrame, deviceOrientation]);

  // Snapshot keyframe
  const captureSnapshot = () => {
    const canvas = canvasRef.current;
    if (canvas && onSnapshot) {
      onSnapshot(canvas.toDataURL("image/jpeg", 0.85));
    }
  };

  // Load sample video for testing without camera
  const handleUploadVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = url;
      videoRef.current.loop = true;
      videoRef.current.muted = true;
      videoRef.current.play();
      setCameraActive(true);
      onToggleStreaming(true);
    }
  };

  // Format record timer
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="relative w-full h-full bg-slate-950 flex flex-col items-center justify-center overflow-hidden">
      {/* Video element */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          cameraActive ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Camera Inactive Overlay */}
      {!cameraActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/95 z-10">
          <div className="w-16 h-16 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400">
            <Camera className="w-8 h-8" />
          </div>
          <h2 className="text-slate-100 font-semibold text-lg mb-2">
            Cámara del Celular en Vivo
          </h2>
          <p className="text-slate-400 text-xs max-w-xs mb-6 leading-relaxed">
            Graba el entorno en vivo y transmite los fotogramas al pipeline de reconstrucción 3D de LingBot-Map.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              id="btn-start-camera"
              onClick={() => startCamera()}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white font-medium text-sm shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Video className="w-4 h-4" />
              Abrir Cámara
            </button>

            <label className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-medium text-sm flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95">
              <Upload className="w-4 h-4" />
              Cargar Video
              <input
                type="file"
                accept="video/*"
                onChange={handleUploadVideo}
                className="hidden"
              />
            </label>
          </div>

          {cameraError && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs max-w-xs">
              {cameraError}
            </div>
          )}
        </div>
      )}

      {/* Top Status Overlay when Active */}
      {cameraActive && (
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-20">
          {/* Live indicator & recording status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-200 text-xs font-mono shadow">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>LIVE</span>
              <span className="text-slate-500">|</span>
              <span className="text-cyan-400 font-semibold">{actualFps} FPS</span>
            </div>

            {isRecording && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 text-white text-xs font-mono font-semibold shadow animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white" />
                <span>REC {formatTime(recordSeconds)}</span>
              </div>
            )}
          </div>

          {/* Facing & Resolution Badge */}
          <div className="flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-400 text-[11px] font-mono">
              {facingMode === "environment" ? "Cámara Trasera" : "Frontal"} ({resolution.width}x{resolution.height})
            </div>
          </div>
        </div>
      )}

      {/* Camera On-Screen Action Controls (Bottom Float) */}
      {cameraActive && (
        <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-3 z-20 px-4">
          {/* Switch front/back camera */}
          <button
            id="btn-flip-camera"
            onClick={toggleFacingMode}
            title="Cambiar cámara (frontal/trasera)"
            className="p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/70 backdrop-blur-md shadow-xl transition-all active:scale-95"
          >
            <SwitchCamera className="w-5 h-5 text-slate-300" />
          </button>

          {/* Flashlight/Torch toggle (if supported) */}
          {torchAvailable && (
            <button
              id="btn-toggle-torch"
              onClick={toggleTorch}
              title={torchOn ? "Apagar linterna" : "Encender linterna"}
              className={`p-3 rounded-2xl border backdrop-blur-md shadow-xl transition-all active:scale-95 ${
                torchOn
                  ? "bg-amber-500/20 text-amber-300 border-amber-400/80"
                  : "bg-slate-900/80 text-slate-300 border-slate-700/70"
              }`}
            >
              {torchOn ? <Zap className="w-5 h-5 text-amber-400" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          {/* Big Record Button */}
          <button
            id="btn-record-live"
            onClick={toggleRecording}
            className={`px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl flex items-center gap-2 backdrop-blur-md transition-all active:scale-95 ${
              isRecording
                ? "bg-red-600 hover:bg-red-500 text-white ring-4 ring-red-500/30"
                : "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white"
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4 fill-white" />
                Detener
              </>
            ) : (
              <>
                <Disc className="w-4 h-4 fill-white animate-spin" />
                Grabar en Vivo
              </>
            )}
          </button>

          {/* Keyframe Snapshot */}
          <button
            id="btn-capture-snapshot"
            onClick={captureSnapshot}
            title="Capturar Keyframe Manual"
            className="p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/70 backdrop-blur-md shadow-xl transition-all active:scale-95"
          >
            <Camera className="w-5 h-5 text-cyan-400" />
          </button>

          {/* Close Camera button */}
          <button
            id="btn-stop-camera"
            onClick={stopCamera}
            title="Cerrar cámara"
            className="p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-800 text-rose-400 border border-slate-700/70 backdrop-blur-md shadow-xl transition-all active:scale-95"
          >
            <VideoOff className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Recorded Video Modal banner */}
      {recordedVideoUrl && (
        <div className="absolute top-14 inset-x-4 max-w-sm mx-auto p-3 rounded-2xl bg-slate-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur-md z-30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Grabación de video lista ({formatTime(recordSeconds || 1)})</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              id="link-download-video"
              href={recordedVideoUrl}
              download={`lingbot_live_record_${Date.now()}.webm`}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1 shadow"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </a>
            <button
              onClick={() => setRecordedVideoUrl(null)}
              className="text-slate-400 hover:text-slate-200 px-1.5 py-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
