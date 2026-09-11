import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Point3D, CameraPose, MapViewOptions, Keyframe, SemanticPin } from "../types/slam";
import {
  RotateCcw,
  Compass,
  Layers,
  Ruler,
  Maximize2,
  Eye,
  Radio,
  Sparkles,
  MapPin,
  Camera,
} from "lucide-react";

interface ThreeMapViewerProps {
  points: Point3D[];
  currentPose: CameraPose;
  trajectory: CameraPose[];
  keyframes: Keyframe[];
  semanticPins: SemanticPin[];
  options: MapViewOptions;
  onOptionsChange: (newOptions: Partial<MapViewOptions>) => void;
  onSelectKeyframe?: (kf: Keyframe) => void;
  activeKeyframe?: Keyframe | null;
}

export const ThreeMapViewer: React.FC<ThreeMapViewerProps> = ({
  points,
  currentPose,
  trajectory,
  keyframes,
  semanticPins,
  options,
  onOptionsChange,
  onSelectKeyframe,
  activeKeyframe,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Three.js objects
  const pointsMeshRef = useRef<THREE.Points | null>(null);
  const trajectoryLineRef = useRef<THREE.Line | null>(null);
  const frustumGroupRef = useRef<THREE.Group | null>(null);
  const keyframesGroupRef = useRef<THREE.Group | null>(null);
  const pinsGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);

  // Local state
  const [followCamera, setFollowCamera] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);

  // Initialize Three.js Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1017); // Deep slate dark neutral
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.05, 500);
    camera.position.set(0, 2.5, -3.5);
    camera.lookAt(0, 0, 1.5);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 60;
    controls.minDistance = 0.2;
    controlsRef.current = controls;

    // 5. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // 6. Grid Helper
    const grid = new THREE.GridHelper(20, 40, 0x0284c7, 0x1e293b);
    grid.position.y = -1.2;
    scene.add(grid);
    gridHelperRef.current = grid;

    // 7. Frustum Group (Current Camera wireframe)
    const frustumGroup = new THREE.Group();
    const frustumGeom = new THREE.BufferGeometry();
    // 5 vertices of a camera pyramid: apex (0,0,0) and 4 base corners
    const w = 0.22;
    const h = 0.16;
    const d = 0.35;
    const vertices = new Float32Array([
      // Apex to 4 corners
      0, 0, 0, -w, h, d,
      0, 0, 0, w, h, d,
      0, 0, 0, w, -h, d,
      0, 0, 0, -w, -h, d,
      // Perimeter rectangle
      -w, h, d, w, h, d,
      w, h, d, w, -h, d,
      w, -h, d, -w, -h, d,
      -w, -h, d, -w, h, d,
      // Top indicator (small triangle)
      0, h * 1.3, d, 0, h, d,
    ]);
    frustumGeom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    const frustumMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4, // Cyan neon
      linewidth: 2,
    });
    const frustumLines = new THREE.LineSegments(frustumGeom, frustumMat);
    frustumGroup.add(frustumLines);

    // Small camera body cube
    const bodyGeom = new THREE.BoxGeometry(0.08, 0.05, 0.06);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.set(0, 0, -0.03);
    frustumGroup.add(bodyMesh);

    scene.add(frustumGroup);
    frustumGroupRef.current = frustumGroup;

    // 8. Keyframes and Pins groups
    const kfGroup = new THREE.Group();
    scene.add(kfGroup);
    keyframesGroupRef.current = kfGroup;

    const pinsGroup = new THREE.Group();
    scene.add(pinsGroup);
    pinsGroupRef.current = pinsGroup;

    // 9. Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container || !cameraRef.current || !rendererRef.current) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      cameraRef.current.aspect = newW / newH;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newW, newH);
    });
    resizeObserver.observe(container);

    // 10. Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update Points Geometry
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (points.length === 0) {
      if (pointsMeshRef.current) {
        scene.remove(pointsMeshRef.current);
        pointsMeshRef.current.geometry.dispose();
        pointsMeshRef.current = null;
      }
      return;
    }

    const count = points.length;
    let geom = pointsMeshRef.current?.geometry;
    const isNew = !geom || geom.getAttribute("position").count !== count;

    if (isNew) {
      if (pointsMeshRef.current) {
        scene.remove(pointsMeshRef.current);
        pointsMeshRef.current.geometry.dispose();
      }
      geom = new THREE.BufferGeometry();
      const posArray = new Float32Array(count * 3);
      const colArray = new Float32Array(count * 3);
      geom.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
      geom.setAttribute("color", new THREE.BufferAttribute(colArray, 3));

      const mat = new THREE.PointsMaterial({
        size: options.pointSize * 0.015,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
      });

      const mesh = new THREE.Points(geom, mat);
      scene.add(mesh);
      pointsMeshRef.current = mesh;
    }

    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    // Bounds for elevation & depth calculation
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    if (options.colorMode === "elevation" || options.colorMode === "depth") {
      for (let i = 0; i < count; i++) {
        const pt = points[i];
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
    const diffY = maxY - minY || 1;
    const diffZ = maxZ - minZ || 1;

    for (let i = 0; i < count; i++) {
      const p = points[i];
      const i3 = i * 3;
      pos[i3] = p.x;
      pos[i3 + 1] = p.y;
      pos[i3 + 2] = p.z;

      if (options.colorMode === "rgb") {
        col[i3] = p.r / 255;
        col[i3 + 1] = p.g / 255;
        col[i3 + 2] = p.b / 255;
      } else if (options.colorMode === "depth") {
        // Turbo / Rainbow depth palette
        const t = Math.max(0, Math.min(1, (p.z - minZ) / diffZ));
        const color = new THREE.Color().setHSL(0.65 - t * 0.65, 0.9, 0.55);
        col[i3] = color.r;
        col[i3 + 1] = color.g;
        col[i3 + 2] = color.b;
      } else if (options.colorMode === "elevation") {
        const t = Math.max(0, Math.min(1, (p.y - minY) / diffY));
        const color = new THREE.Color().setHSL(0.3 + t * 0.5, 0.85, 0.5);
        col[i3] = color.r;
        col[i3 + 1] = color.g;
        col[i3 + 2] = color.b;
      } else {
        // Confidence mode
        const conf = p.confidence ?? 0.8;
        col[i3] = 1 - conf;
        col[i3 + 1] = conf;
        col[i3 + 2] = 0.4;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Update material size if changed
    if (pointsMeshRef.current?.material) {
      (pointsMeshRef.current.material as THREE.PointsMaterial).size = options.pointSize * 0.015;
    }
  }, [points, options.colorMode, options.pointSize]);

  // Update Trajectory Ribbon
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (!options.showTrajectory || trajectory.length < 2) {
      if (trajectoryLineRef.current) {
        scene.remove(trajectoryLineRef.current);
        trajectoryLineRef.current.geometry.dispose();
        trajectoryLineRef.current = null;
      }
      return;
    }

    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(trajectory.length * 3);
    for (let i = 0; i < trajectory.length; i++) {
      const p = trajectory[i].position;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    if (trajectoryLineRef.current) {
      scene.remove(trajectoryLineRef.current);
      trajectoryLineRef.current.geometry.dispose();
    }

    const mat = new THREE.LineBasicMaterial({
      color: 0x10b981, // Emerald green
      linewidth: 3,
    });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    trajectoryLineRef.current = line;
  }, [trajectory, options.showTrajectory]);

  // Update Camera Frustum position and orientation
  useEffect(() => {
    const frustum = frustumGroupRef.current;
    if (!frustum) return;

    frustum.visible = options.showFrustum;
    if (!options.showFrustum) return;

    frustum.position.set(currentPose.position.x, currentPose.position.y, currentPose.position.z);
    frustum.quaternion.set(
      currentPose.rotation.x,
      currentPose.rotation.y,
      currentPose.rotation.z,
      currentPose.rotation.w
    );

    // Follow camera mode
    if (followCamera && controlsRef.current && cameraRef.current) {
      controlsRef.current.target.set(
        currentPose.position.x,
        currentPose.position.y,
        currentPose.position.z
      );
    }
  }, [currentPose, options.showFrustum, followCamera]);

  // Update Keyframe markers
  useEffect(() => {
    const group = keyframesGroupRef.current;
    if (!group) return;

    // Clear previous
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }

    if (!options.showKeyframes) return;

    const sphereGeom = new THREE.SphereGeometry(0.04, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b }); // Amber
    const activeMat = new THREE.MeshBasicMaterial({ color: 0xec4899 }); // Pink

    keyframes.forEach((kf) => {
      const isActive = activeKeyframe?.id === kf.id;
      const mesh = new THREE.Mesh(sphereGeom, isActive ? activeMat : sphereMat);
      mesh.position.set(kf.pose.position.x, kf.pose.position.y, kf.pose.position.z);
      mesh.userData = { keyframe: kf };
      group.add(mesh);
    });
  }, [keyframes, options.showKeyframes, activeKeyframe]);

  // Update Semantic Pins
  useEffect(() => {
    const group = pinsGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }

    semanticPins.forEach((pin) => {
      const pinObj = new THREE.Group();
      pinObj.position.set(pin.position.x, pin.position.y, pin.position.z);

      // Pin cone
      const coneGeom = new THREE.ConeGeometry(0.06, 0.18, 16);
      coneGeom.rotateX(Math.PI);
      const coneMat = new THREE.MeshStandardMaterial({
        color: 0x8b5cf6, // Violet
        roughness: 0.3,
      });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.y = 0.09;
      pinObj.add(cone);

      // Sphere atop
      const ballGeom = new THREE.SphereGeometry(0.05, 12, 12);
      const ballMat = new THREE.MeshBasicMaterial({ color: 0xc084fc });
      const ball = new THREE.Mesh(ballGeom, ballMat);
      ball.position.y = 0.18;
      pinObj.add(ball);

      group.add(pinObj);
    });
  }, [semanticPins]);

  // Update Grid
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = options.showGrid;
    }
  }, [options.showGrid]);

  // Handle Raycasting for measurement and keyframe clicks
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!container || !camera || !scene) return;

    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.08;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // 1. Check Keyframes click
    if (keyframesGroupRef.current) {
      const kfIntersects = raycaster.intersectObjects(keyframesGroupRef.current.children);
      if (kfIntersects.length > 0) {
        const kf = kfIntersects[0].object.userData.keyframe as Keyframe;
        if (kf && onSelectKeyframe) {
          onSelectKeyframe(kf);
          return;
        }
      }
    }

    // 2. Measure tool mode
    if (options.measureMode && pointsMeshRef.current) {
      const intersects = raycaster.intersectObject(pointsMeshRef.current);
      if (intersects.length > 0) {
        const point = intersects[0].point;
        const newPoints = [...measurePoints, point];
        if (newPoints.length > 2) {
          setMeasurePoints([point]);
          setMeasuredDistance(null);
        } else {
          setMeasurePoints(newPoints);
          if (newPoints.length === 2) {
            const dist = newPoints[0].distanceTo(newPoints[1]);
            setMeasuredDistance(dist);
          }
        }
      }
    }
  };

  // Reset view to origin
  const handleResetView = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0, 2.5, -3.5);
    cameraRef.current.lookAt(0, 0, 1.5);
    controlsRef.current.target.set(0, 0, 1.5);
    controlsRef.current.update();
  };

  // Top down floorplan view
  const handleTopDownView = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    const target = controlsRef.current.target;
    cameraRef.current.position.set(target.x, target.y + 6, target.z + 0.01);
    cameraRef.current.lookAt(target.x, target.y, target.z);
    controlsRef.current.update();
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950 font-sans">
      {/* 3D WebGL Canvas */}
      <div
        id="three-canvas-container"
        ref={containerRef}
        onClick={handleCanvasClick}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Floating 3D Map HUD Controls (Top Right) */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
        <button
          id="btn-reset-view"
          onClick={handleResetView}
          title="Centrar vista"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center justify-center"
        >
          <RotateCcw className="w-4 h-4 text-cyan-400" />
        </button>

        <button
          id="btn-topdown-view"
          onClick={handleTopDownView}
          title="Vista cenital (plano)"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center justify-center"
        >
          <Compass className="w-4 h-4 text-emerald-400" />
        </button>

        <button
          id="btn-follow-cam"
          onClick={() => setFollowCamera(!followCamera)}
          title={followCamera ? "Siguiendo cámara activa" : "Seguir cámara"}
          className={`p-2.5 rounded-xl border shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center justify-center ${
            followCamera
              ? "bg-cyan-500/20 text-cyan-300 border-cyan-400/80"
              : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/60"
          }`}
        >
          <Radio className={`w-4 h-4 ${followCamera ? "animate-pulse" : ""}`} />
        </button>

        <button
          id="btn-toggle-measure"
          onClick={() => {
            onOptionsChange({ measureMode: !options.measureMode });
            setMeasurePoints([]);
            setMeasuredDistance(null);
          }}
          title="Regla de medición 3D"
          className={`p-2.5 rounded-xl border shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center justify-center ${
            options.measureMode
              ? "bg-amber-500/20 text-amber-300 border-amber-400/80"
              : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/60"
          }`}
        >
          <Ruler className="w-4 h-4" />
        </button>
      </div>

      {/* Map Display Options Bar (Top Left) */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-900/85 border border-slate-800 shadow-xl backdrop-blur-md z-10 text-xs">
        {/* Color Mode Selector */}
        <span className="px-2 font-medium text-slate-400 flex items-center gap-1">
          <Layers className="w-3.5 h-3.5 text-cyan-400" /> Modo:
        </span>
        {(["rgb", "depth", "elevation", "confidence"] as const).map((mode) => (
          <button
            key={mode}
            id={`btn-colormode-${mode}`}
            onClick={() => onOptionsChange({ colorMode: mode })}
            className={`px-2.5 py-1 rounded-lg capitalize transition-all ${
              options.colorMode === mode
                ? "bg-cyan-500/30 text-cyan-200 font-semibold border border-cyan-500/50 shadow"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            {mode === "rgb"
              ? "RGB"
              : mode === "depth"
              ? "Profundidad"
              : mode === "elevation"
              ? "Elevación"
              : "Confianza"}
          </button>
        ))}
      </div>

      {/* Point Size and View Layers Drawer (Bottom Left) */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 p-2 rounded-xl bg-slate-900/85 border border-slate-800 shadow-xl backdrop-blur-md z-10 text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Puntos:</span>
          <input
            id="input-point-size"
            type="range"
            min="1"
            max="6"
            step="0.5"
            value={options.pointSize}
            onChange={(e) => onOptionsChange({ pointSize: parseFloat(e.target.value) })}
            className="w-16 accent-cyan-400 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
          />
          <span className="text-cyan-300 font-mono text-[11px]">{options.pointSize}px</span>
        </div>

        <div className="h-4 w-px bg-slate-700" />

        <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-100">
          <input
            type="checkbox"
            checked={options.showTrajectory}
            onChange={(e) => onOptionsChange({ showTrajectory: e.target.checked })}
            className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
          />
          Trayectoria
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-100">
          <input
            type="checkbox"
            checked={options.showFrustum}
            onChange={(e) => onOptionsChange({ showFrustum: e.target.checked })}
            className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
          />
          Frustum
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-100">
          <input
            type="checkbox"
            checked={options.showKeyframes}
            onChange={(e) => onOptionsChange({ showKeyframes: e.target.checked })}
            className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0 w-3.5 h-3.5"
          />
          Keyframes ({keyframes.length})
        </label>
      </div>

      {/* Measurement Banner */}
      {options.measureMode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-amber-500/20 border border-amber-400/60 backdrop-blur-md px-4 py-2 rounded-xl text-amber-200 text-xs shadow-xl z-20 flex items-center gap-2">
          <Ruler className="w-4 h-4 text-amber-400 animate-pulse" />
          <span>
            {measurePoints.length === 0 && "Haz clic en el primer punto 3D..."}
            {measurePoints.length === 1 && "Haz clic en el segundo punto 3D..."}
            {measurePoints.length === 2 && measuredDistance !== null && (
              <strong>
                Distancia medida: {(measuredDistance * 100).toFixed(1)} cm ({measuredDistance.toFixed(2)} m)
              </strong>
            )}
          </span>
          {measurePoints.length > 0 && (
            <button
              onClick={() => {
                setMeasurePoints([]);
                setMeasuredDistance(null);
              }}
              className="ml-2 text-[10px] bg-amber-600/40 hover:bg-amber-600/60 px-2 py-0.5 rounded text-amber-100"
            >
              Reiniciar
            </button>
          )}
        </div>
      )}

      {/* Empty State Banner */}
      {points.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3">
            <Camera className="w-8 h-8 text-cyan-400" />
          </div>
          <h3 className="text-slate-200 font-semibold text-base mb-1">
            Mapa 3D Esperando Transmisión en Vivo
          </h3>
          <p className="text-slate-400 text-xs max-w-sm">
            Abre la cámara del celular o selecciona un video de prueba para comenzar a reconstruir el entorno con LingBot-Map en tiempo real.
          </p>
        </div>
      )}
    </div>
  );
};
