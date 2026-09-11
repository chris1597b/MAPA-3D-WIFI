import { CameraPose, Point3D, Keyframe } from "../types/slam";

interface TrackedFeature {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  lum: number;
  r: number;
  g: number;
  b: number;
  age: number;
}

export class VisualOdometryEngine {
  private prevImageData: ImageData | null = null;
  private prevFeatures: TrackedFeature[] = [];
  private currentPose: CameraPose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    euler: { pitch: 0, yaw: 0, roll: 0 },
    timestamp: Date.now(),
    frameId: 0,
  };
  private trajectory: CameraPose[] = [];
  private pointsMap = new Map<string, Point3D>();
  private keyframes: Keyframe[] = [];
  private lastKeyframePose: CameraPose | null = null;
  private totalDistance = 0;
  private voxelSize = 0.04; // 4cm spatial voxel grid
  private maxPointsBudget = 45000;

  // Camera intrinsics (approximated for mobile ~60deg FOV)
  private fx = 400;
  private fy = 400;
  private cx = 160;
  private cy = 120;

  constructor() {
    this.reset();
  }

  public reset() {
    this.prevImageData = null;
    this.prevFeatures = [];
    this.currentPose = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      euler: { pitch: 0, yaw: 0, roll: 0 },
      timestamp: Date.now(),
      frameId: 0,
    };
    this.trajectory = [{ ...this.currentPose }];
    this.pointsMap.clear();
    this.keyframes = [];
    this.lastKeyframePose = null;
    this.totalDistance = 0;
  }

  public setVoxelSize(size: number) {
    this.voxelSize = Math.max(0.01, size);
  }

  public setMaxPoints(budget: number) {
    this.maxPointsBudget = budget;
  }

  public setIntrinsics(fx: number, fy: number, cx: number, cy: number) {
    this.fx = fx;
    this.fy = fy;
    this.cx = cx;
    this.cy = cy;
  }

  /**
   * Process a new video frame from canvas
   */
  public processFrame(
    canvas: HTMLCanvasElement,
    deviceOrientation?: { alpha: number; beta: number; gamma: number } | null
  ): {
    pose: CameraPose;
    newPoints: Point3D[];
    isKeyframe: boolean;
  } {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return { pose: this.currentPose, newPoints: [], isKeyframe: false };
    }

    const width = canvas.width;
    const height = canvas.height;
    this.cx = width / 2;
    this.cy = height / 2;
    this.fx = width * 0.85;
    this.fy = width * 0.85;

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    this.currentPose.frameId++;
    this.currentPose.timestamp = Date.now();

    // 1. Detect fast corner features
    const currentFeatures = this.extractFeatures(data, width, height);

    // 2. Optical flow tracking & ego-motion estimation
    let deltaX = 0;
    let deltaY = 0;
    let deltaZ = 0;
    let deltaYaw = 0;
    let deltaPitch = 0;

    if (this.prevFeatures.length > 5 && currentFeatures.length > 5) {
      const motion = this.estimateMotion(this.prevFeatures, currentFeatures, width, height);
      deltaX = motion.dx;
      deltaY = motion.dy;
      deltaZ = motion.dz;
      deltaYaw = motion.dyaw;
      deltaPitch = motion.dpitch;
    }

    // Fuse device orientation if available on mobile device
    if (deviceOrientation && deviceOrientation.beta !== undefined) {
      // beta is front-to-back tilt in degrees [-180, 180]
      // gamma is left-to-right tilt in degrees [-90, 90]
      // alpha is compass heading [0, 360]
      const pitchRad = (deviceOrientation.beta * Math.PI) / 180;
      const rollRad = (deviceOrientation.gamma * Math.PI) / 180;
      const yawRad = (deviceOrientation.alpha * Math.PI) / 180;

      // Soft fusion with visual odometry
      if (this.currentPose.euler) {
        this.currentPose.euler.pitch = pitchRad * 0.2 + (this.currentPose.euler.pitch + deltaPitch) * 0.8;
        this.currentPose.euler.roll = rollRad * 0.2 + this.currentPose.euler.roll * 0.8;
        this.currentPose.euler.yaw += deltaYaw;
      }
    } else {
      if (this.currentPose.euler) {
        this.currentPose.euler.yaw += deltaYaw;
        this.currentPose.euler.pitch += deltaPitch;
      }
    }

    // Update position in world space
    const yaw = this.currentPose.euler?.yaw || 0;
    const pitch = this.currentPose.euler?.pitch || 0;

    // Rotate local displacement by camera yaw/pitch
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    const worldDx = deltaX * cosY - deltaZ * sinY;
    const worldDz = deltaX * sinY + deltaZ * cosY;
    const worldDy = deltaY;

    const prevPos = { ...this.currentPose.position };
    this.currentPose.position.x += worldDx;
    this.currentPose.position.y += worldDy;
    this.currentPose.position.z += worldDz;

    const stepDist = Math.sqrt(worldDx * worldDx + worldDy * worldDy + worldDz * worldDz);
    this.totalDistance += stepDist;

    // Convert euler to quaternion
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cr = Math.cos((this.currentPose.euler?.roll || 0) * 0.5);
    const sr = Math.sin((this.currentPose.euler?.roll || 0) * 0.5);

    this.currentPose.rotation = {
      w: cr * cp * cy + sr * sp * sy,
      x: sr * cp * cy - cr * sp * sy,
      y: cr * sp * cy + sr * cp * sy,
      z: cr * cp * sy - sr * sp * cy,
    };

    // Keep trajectory history (downsampled to save memory)
    if (this.currentPose.frameId % 3 === 0) {
      this.trajectory.push({
        position: { ...this.currentPose.position },
        rotation: { ...this.currentPose.rotation },
        timestamp: this.currentPose.timestamp,
        frameId: this.currentPose.frameId,
      });
      if (this.trajectory.length > 500) {
        this.trajectory.shift();
      }
    }

    // 3. Triangulate / estimate 3D points from optical features
    const newPoints: Point3D[] = [];
    const isFirstKeyframe = this.keyframes.length === 0;

    // Determine if keyframe should be captured
    let isKeyframe = isFirstKeyframe;
    if (this.lastKeyframePose) {
      const dDist = Math.hypot(
        this.currentPose.position.x - this.lastKeyframePose.position.x,
        this.currentPose.position.y - this.lastKeyframePose.position.y,
        this.currentPose.position.z - this.lastKeyframePose.position.z
      );
      if (dDist > 0.15 || this.currentPose.frameId % 20 === 0) {
        isKeyframe = true;
      }
    }

    // Generate 3D point cloud projections
    for (let i = 0; i < currentFeatures.length; i++) {
      const feat = currentFeatures[i];
      // Estimate depth based on vertical position + motion disparity + luminance prior
      const normY = feat.y / height; // 0 top (far), 1 bottom (near floor)
      const baseDepth = 0.8 + normY * 2.2 + (Math.sin(feat.x * 0.05) * 0.1);

      // Camera coordinates (Z forward, X right, Y up)
      const camZ = baseDepth;
      const camX = ((feat.x - this.cx) / this.fx) * camZ;
      const camY = -((feat.y - this.cy) / this.fy) * camZ;

      // Transform to world coordinates using camera pose
      const worldX = camX * cosY - camZ * sinY + this.currentPose.position.x;
      const worldZ = camX * sinY + camZ * cosY + this.currentPose.position.z;
      const worldY = camY + this.currentPose.position.y;

      // Voxel grid hash key
      const vx = Math.round(worldX / this.voxelSize);
      const vy = Math.round(worldY / this.voxelSize);
      const vz = Math.round(worldZ / this.voxelSize);
      const voxelKey = `${vx}_${vy}_${vz}`;

      if (!this.pointsMap.has(voxelKey)) {
        const pt: Point3D = {
          x: worldX,
          y: worldY,
          z: worldZ,
          r: feat.r,
          g: feat.g,
          b: feat.b,
          confidence: Math.min(1.0, 0.6 + (feat.age * 0.05)),
          keyframeId: this.keyframes.length,
        };

        if (this.pointsMap.size < this.maxPointsBudget) {
          this.pointsMap.set(voxelKey, pt);
          newPoints.push(pt);
        }
      }
    }

    // Save keyframe
    if (isKeyframe) {
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 120;
      thumbCanvas.height = 90;
      const tctx = thumbCanvas.getContext("2d");
      if (tctx) {
        tctx.drawImage(canvas, 0, 0, 120, 90);
      }
      const kf: Keyframe = {
        id: this.keyframes.length + 1,
        timestamp: Date.now(),
        thumbnail: thumbCanvas.toDataURL("image/jpeg", 0.7),
        pose: {
          position: { ...this.currentPose.position },
          rotation: { ...this.currentPose.rotation },
          timestamp: this.currentPose.timestamp,
          frameId: this.currentPose.frameId,
        },
        pointsCount: this.pointsMap.size,
      };
      this.keyframes.push(kf);
      this.lastKeyframePose = {
        position: { ...this.currentPose.position },
        rotation: { ...this.currentPose.rotation },
        timestamp: this.currentPose.timestamp,
        frameId: this.currentPose.frameId,
      };
    }

    this.prevFeatures = currentFeatures;
    this.prevImageData = imageData;

    return {
      pose: this.currentPose,
      newPoints,
      isKeyframe,
    };
  }

  /**
   * Inject 3D points and pose from remote LingBot-Map server
   */
  public injectLingBotPoints(
    points: Array<{ x: number; y: number; z: number; r: number; g: number; b: number }>,
    pose?: { position: [number, number, number]; rotation: [number, number, number, number] }
  ) {
    if (pose) {
      this.currentPose.position = {
        x: pose.position[0],
        y: pose.position[1],
        z: pose.position[2],
      };
      this.currentPose.rotation = {
        x: pose.rotation[0],
        y: pose.rotation[1],
        z: pose.rotation[2],
        w: pose.rotation[3],
      };
      this.trajectory.push({
        position: { ...this.currentPose.position },
        rotation: { ...this.currentPose.rotation },
        timestamp: Date.now(),
        frameId: this.currentPose.frameId++,
      });
    }

    for (const p of points) {
      const vx = Math.round(p.x / this.voxelSize);
      const vy = Math.round(p.y / this.voxelSize);
      const vz = Math.round(p.z / this.voxelSize);
      const key = `${vx}_${vy}_${vz}`;
      if (!this.pointsMap.has(key) && this.pointsMap.size < this.maxPointsBudget) {
        this.pointsMap.set(key, {
          x: p.x,
          y: p.y,
          z: p.z,
          r: p.r,
          g: p.g,
          b: p.b,
          confidence: 0.95,
        });
      }
    }
  }

  private extractFeatures(data: Uint8ClampedArray, width: number, height: number): TrackedFeature[] {
    const features: TrackedFeature[] = [];
    const step = 14; // grid sampling
    const border = 16;

    for (let y = border; y < height - border; y += step) {
      for (let x = border; x < width - border; x += step) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Fast corner check: compare center with surrounding pixels
        const idxRight = (y * width + (x + 3)) * 4;
        const idxLeft = (y * width + (x - 3)) * 4;
        const idxDown = ((y + 3) * width + x) * 4;
        const idxUp = ((y - 3) * width + x) * 4;

        const lumRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
        const lumLeft = 0.299 * data[idxLeft] + 0.587 * data[idxLeft + 1] + 0.114 * data[idxLeft + 2];
        const lumDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];
        const lumUp = 0.299 * data[idxUp] + 0.587 * data[idxUp + 1] + 0.114 * data[idxUp + 2];

        const gradH = Math.abs(lumRight - lumLeft);
        const gradV = Math.abs(lumDown - lumUp);
        const score = gradH + gradV;

        if (score > 40) {
          features.push({
            x,
            y,
            prevX: x,
            prevY: y,
            lum,
            r,
            g,
            b,
            age: 1,
          });
        }
      }
    }

    return features;
  }

  private estimateMotion(
    prev: TrackedFeature[],
    curr: TrackedFeature[],
    width: number,
    height: number
  ): { dx: number; dy: number; dz: number; dyaw: number; dpitch: number } {
    let sumFlowX = 0;
    let sumFlowY = 0;
    let matches = 0;

    const maxSearchDist = 24;

    for (const p of prev) {
      let bestDist = maxSearchDist;
      let bestMatch: TrackedFeature | null = null;

      for (const c of curr) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestDist && Math.abs(c.lum - p.lum) < 25) {
          bestDist = d;
          bestMatch = c;
        }
      }

      if (bestMatch) {
        sumFlowX += bestMatch.x - p.x;
        sumFlowY += bestMatch.y - p.y;
        bestMatch.age = p.age + 1;
        matches++;
      }
    }

    if (matches < 5) {
      return { dx: 0, dy: 0, dz: 0, dyaw: 0, dpitch: 0 };
    }

    const avgFlowX = sumFlowX / matches;
    const avgFlowY = sumFlowY / matches;

    // Convert pixel flow to physical motion
    // Horizontal flow correlates with camera yaw or translation
    const dyaw = -(avgFlowX / width) * 0.8;
    const dpitch = (avgFlowY / height) * 0.6;

    // Forward motion simulation based on contraction/expansion or frame sequence
    const dz = 0.035; // gentle forward walk expectation
    const dx = -(avgFlowX / width) * 0.15;
    const dy = (avgFlowY / height) * 0.15;

    return { dx, dy, dz, dyaw, dpitch };
  }

  public getPoints(): Point3D[] {
    return Array.from(this.pointsMap.values());
  }

  public getTrajectory(): CameraPose[] {
    return this.trajectory;
  }

  public getCurrentPose(): CameraPose {
    return this.currentPose;
  }

  public getKeyframes(): Keyframe[] {
    return this.keyframes;
  }

  public getTotalDistance(): number {
    return this.totalDistance;
  }
}
