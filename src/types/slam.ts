export interface Point3D {
  x: number;
  y: number;
  z: number;
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  confidence?: number;
  keyframeId?: number;
}

export interface CameraPose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number }; // Quaternion
  euler?: { pitch: number; yaw: number; roll: number };
  timestamp: number;
  frameId: number;
}

export interface Keyframe {
  id: number;
  timestamp: number;
  thumbnail: string; // base64 data URL
  pose: CameraPose;
  pointsCount: number;
}

export interface SemanticPin {
  id: string;
  name: string;
  category: string;
  position: { x: number; y: number; z: number };
  confidence: number;
  distanceMeters?: number;
}

export interface LingBotConfig {
  mode: "browser-embedded" | "remote-server";
  serverUrl: string;
  connected: boolean;
  fpsTarget: number;
  maxPointsBudget: number;
  pointCloudVoxelSize: number;
  intrinsics: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
  };
}

export interface MapViewOptions {
  colorMode: "rgb" | "depth" | "elevation" | "confidence";
  pointSize: number;
  showTrajectory: boolean;
  showFrustum: boolean;
  showKeyframes: boolean;
  showMesh: boolean;
  showGrid: boolean;
  measureMode: boolean;
}

export interface ReconstructionStats {
  pointsCount: number;
  keyframesCount: number;
  trajectoryLengthMeters: number;
  currentFps: number;
  latencyMs: number;
  processingEngine: string;
  framesProcessed: number;
}
