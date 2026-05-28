import { createPortal } from 'react-dom';
import { useRef, Suspense, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html, Grid, Splat, TransformControls, KeyboardControls, useKeyboardControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Trash2, Home } from 'lucide-react';
import { exportToPly } from '../utils/plyExporter';
import type { Point, PinCategory, EraserStroke, LayerData } from '../App';

const identifyNoiseSplats = (
  positions: any, 
  numPoints: number, 
  proxyToSplatIndex: Uint32Array | undefined,
  centerData: Float32Array | null,
  colorData: Uint32Array | null,
  proxyDistributionThreshold: number,
  sorThreshold: number,
  sorNeighbors: number,
  volumetricThresholdPercent: number
) => {
  const noiseFlags = new Uint8Array(numPoints);
  
  if (centerData && colorData) {
    const colorDataInt16 = new Int16Array(colorData.buffer);
    const proxyScores = new Float32Array(numPoints);
    
    for (let i = 0; i < numPoints; i++) {
      const splatIdx = proxyToSplatIndex ? proxyToSplatIndex[i] : i;
      const colorUint = colorData[splatIdx * 4 + 3];
      const opacity = (colorUint >>> 24) & 0xFF;
      
      const scaleMult = centerData[splatIdx * 4 + 3];
      const m11 = colorDataInt16[splatIdx * 8 + 0] * scaleMult;
      const m12 = colorDataInt16[splatIdx * 8 + 1] * scaleMult;
      const m13 = colorDataInt16[splatIdx * 8 + 2] * scaleMult;
      const m22 = colorDataInt16[splatIdx * 8 + 3] * scaleMult;
      const m23 = colorDataInt16[splatIdx * 8 + 4] * scaleMult;
      const m33 = colorDataInt16[splatIdx * 8 + 5] * scaleMult;

      const det = m11 * (m22 * m33 - m23 * m23) 
                - m12 * (m12 * m33 - m13 * m23) 
                + m13 * (m12 * m23 - m13 * m22);
                
      const volume = Math.sqrt(Math.max(0, det));
      proxyScores[i] = opacity / (volume + 1e-10);
    }

    const bottomPercent = Math.min(1.0, volumetricThresholdPercent / 100.0); 
    const sortedScores = new Float32Array(proxyScores).sort();
    const thresholdIndex = Math.floor(numPoints * bottomPercent);
    const volumetricThreshold = sortedScores[Math.min(numPoints - 1, Math.max(0, thresholdIndex))];

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    const maxExtent = Math.max(extentX, extentY, extentZ, 0.1);
    // Use a grid with roughly 200 cells along the longest axis
    const sorCellSize = Math.max(0.01, maxExtent / 200);

    const sorGrid = new Map<number, number[]>();
    const hash = (x: number, y: number, z: number) => {
      return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
    };

    for (let i = 0; i < numPoints; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const cx = Math.floor(px / sorCellSize);
      const cy = Math.floor(py / sorCellSize);
      const cz = Math.floor(pz / sorCellSize);
      const h = hash(cx, cy, cz);
      let cell = sorGrid.get(h);
      if (!cell) {
        cell = [];
        sorGrid.set(h, cell);
      }
      cell.push(i);
    }

    const proxyAvgDistances = new Float32Array(numPoints);
    let sumAvgDist = 0;
    const kNeighbors = sorNeighbors;
    const kDists = new Float32Array(kNeighbors);

    const neighborOffsets = [
      [0, 0, 0],
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
      [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
      [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
      [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
    ];

    for (let i = 0; i < numPoints; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const cx = Math.floor(px / sorCellSize);
      const cy = Math.floor(py / sorCellSize);
      const cz = Math.floor(pz / sorCellSize);
      
      for (let j = 0; j < kNeighbors; j++) kDists[j] = Infinity;
      let maxDistSq = Infinity;
      let foundCount = 0;
      
      let checkedCount = 0;
      const MAX_CHECK = 50;
      
      for (let o = 0; o < 27 && checkedCount < MAX_CHECK; o++) {
        const offset = neighborOffsets[o];
        const h = hash(cx + offset[0], cy + offset[1], cz + offset[2]);
        const cell = sorGrid.get(h);
        if (cell) {
          // Limit points checked per cell to avoid O(N^2) in dense clusters
          const checkCount = Math.min(cell.length, 10);
          const step = Math.max(1, Math.floor(cell.length / checkCount));
          
          for (let j = 0; j < cell.length && checkedCount < MAX_CHECK; j += step) {
            const ni = cell[j];
            if (ni !== i) {
              checkedCount++;
              const nx = positions[ni * 3];
              const ny = positions[ni * 3 + 1];
              const nz = positions[ni * 3 + 2];
              const distSq = (px - nx)**2 + (py - ny)**2 + (pz - nz)**2;
              
              if (distSq < maxDistSq || foundCount < kNeighbors) {
                let insertPos = foundCount < kNeighbors ? foundCount : kNeighbors - 1;
                while (insertPos > 0 && kDists[insertPos - 1] > distSq) {
                  kDists[insertPos] = kDists[insertPos - 1];
                  insertPos--;
                }
                kDists[insertPos] = distSq;
                if (foundCount < kNeighbors) foundCount++;
                if (foundCount === kNeighbors) maxDistSq = kDists[kNeighbors - 1];
              }
            }
          }
        }
      }
      
      let distSum = 0;
      for (let j = 0; j < foundCount; j++) {
        distSum += Math.sqrt(kDists[j]);
      }
      const avgDist = foundCount > 0 ? distSum / foundCount : 1000;
      proxyAvgDistances[i] = avgDist;
      sumAvgDist += avgDist;
    }

    const globalMeanDistance = sumAvgDist / numPoints;
    let sumSqDiff = 0;
    for (let i = 0; i < numPoints; i++) {
      sumSqDiff += (proxyAvgDistances[i] - globalMeanDistance)**2;
    }
    const globalStdDevDistance = Math.sqrt(sumSqDiff / numPoints);
    const currentSorThreshold = sorThreshold;

    for (let i = 0; i < numPoints; i++) {
      const isVolumetricNoise = proxyScores[i] <= volumetricThreshold;
      const isSorNoise = proxyAvgDistances[i] > globalMeanDistance + currentSorThreshold * globalStdDevDistance;
      if (isVolumetricNoise || isSorNoise) {
        noiseFlags[i] = 1;
      }
    }
  } else {
    // Fallback
    const cellSize = proxyDistributionThreshold;
    const grid = new Map<string, number>();
    for (let i = 0; i < numPoints; i++) {
      const x = Math.floor(positions[i * 3] / cellSize);
      const y = Math.floor(positions[i * 3 + 1] / cellSize);
      const z = Math.floor(positions[i * 3 + 2] / cellSize);
      const key = `${x},${y},${z}`;
      grid.set(key, (grid.get(key) || 0) + 1);
    }
    for (let i = 0; i < numPoints; i++) {
      const x = Math.floor(positions[i * 3] / cellSize);
      const y = Math.floor(positions[i * 3 + 1] / cellSize);
      const z = Math.floor(positions[i * 3 + 2] / cellSize);
      const key = `${x},${y},${z}`;
      const count = grid.get(key) || 0;
      if (count <= 2) {
        noiseFlags[i] = 1;
      }
    }
  }
  
  return noiseFlags;
};

type ViewerProps = {
  layers: LayerData[];
  activeLayerId: string;
  splatUrl: string;
  scale: number;
  pointSize: number;
  threshold: number;
  rotation: [number, number, number];
  splatPosition: [number, number, number];
  gridSize: number;
  gridDivisions: number;
  gridThickness: number;
  points: Point[];
  onUpdatePoint: (id: string, position: [number, number, number]) => void;
  onAddPinAtPosition: (position: [number, number, number]) => void;
  selectedPinId: string | null;
  setSelectedPinId: (id: string | null) => void;
  useWASD: boolean;
  moveSpeed: number;
  viewDistance: number;
  splatViewDistance: number;
  isCalibrationMode?: boolean;
  calibrationPoints?: [number, number, number][];
  onCalibrationPointClick?: (point: [number, number, number]) => void;
  onUpdateCalibrationPoint?: (index: number, point: [number, number, number]) => void;
  recreateProxyTrigger: number;
  removeRedProxiesTrigger: number;
  debugProxy: boolean;
  proxyDistributionThreshold: number;
  sorThreshold: number;
  sorNeighbors: number;
  volumetricThresholdPercent: number;
  onUpdatePoints?: (updatedPoints: Point[]) => void;
  isAdjustingSplat?: boolean;
  pinCategories?: PinCategory[];
  onUpdatePointCategories?: (id: string, categories: string[]) => void;
  showPinCategories?: boolean;
  showFullCategories?: boolean;
  pinFilter?: { categories: string[], matchAll: boolean };
  renderQuality?: 'quality' | 'efficacy';
  onDeletePoint?: (id: string) => void;
  selectionMode: 'rect' | 'lasso' | 'polygon' | 'brush' | null;
  selectionPenetrate: boolean;
  selectedIndices: Set<number>;
  setSelectedIndices: React.Dispatch<React.SetStateAction<Set<number>>>;
  invertSelectionTrigger: number;
  brushSize?: number;
  eraserHistory?: EraserStroke[];
  setEraserHistory?: React.Dispatch<React.SetStateAction<EraserStroke[]>>;
  erasedIndices?: Map<number, number>;
  setErasedIndices?: React.Dispatch<React.SetStateAction<Map<number, number>>>;
  originalColors?: Map<number, number>;
  setOriginalColors?: React.Dispatch<React.SetStateAction<Map<number, number>>>;
  connectedPinIds?: string[];
  connectionLineColor?: string;
  isCtrlPressed?: boolean;

  // New hooks for timeline & boundaries
  onAddEraserStroke?: (stroke: EraserStroke) => void;
  onUndoStroke?: () => void;
  boundaries?: any[];
  boundariesOpacity?: number;
  setBoundaries?: React.Dispatch<React.SetStateAction<any[]>>;
  selectedBoundaryId?: string | null;
  setSelectedBoundaryId?: (id: string | null) => void;
  isPlacingBoundary?: boolean;
  setIsPlacingBoundary?: (val: boolean) => void;
  onAddBoundaryAtPosition?: (position: [number, number, number]) => void;
};

export interface ViewerHandle {
  exportCleanedPly: () => Promise<Blob | null>;
  goHome: () => void;
}

function Pin({ 
  point, 
  onUpdate, 
  isSelected, 
  onSelect,
  index,
  isAdjustingSplat,
  showCategories,
  showFullCategories,
  onContextMenu,
  selectionMode
}: { 
  point: Point; 
  onUpdate: (id: string, pos: [number, number, number]) => void; 
  isSelected: boolean;
  onSelect: () => void;
  index?: number;
  isAdjustingSplat?: boolean;
  showCategories?: boolean;
  showFullCategories?: boolean;
  onContextMenu?: (e: any) => void;
  selectionMode?: 'rect' | 'lasso' | 'polygon' | 'brush' | null;
}) {
  const formattedCategories = point.categories?.map(cat => {
    if (showFullCategories) return cat;
    const parts = cat.split('-');
    return parts.length > 1 ? parts.slice(1).join('-') : cat;
  }) || [];

  const label = showCategories && formattedCategories.length > 0
    ? `${point.name} (${formattedCategories.join(', ')})`
    : point.name;

  const isControlsVisible = isSelected && !isAdjustingSplat && !selectionMode;

  return (
    <TransformControls
      mode="translate"
      space="world"
      size={0.5}
      showX={isControlsVisible}
      showY={isControlsVisible}
      showZ={isControlsVisible}
      enabled={isControlsVisible}
      position={point.position}
      onMouseDown={() => {
        if (onContextMenu) onContextMenu({ type: 'startMove' });
      }}
      onMouseUp={(e: any) => {
        if (e.target && e.target.object) {
          const pos = e.target.object.position;
          onUpdate(point.id, [pos.x, pos.y, pos.z]);
        }
      }}
    >
      <mesh 
        onClick={(e) => {
          if (selectionMode) return;
          e.stopPropagation();
          onSelect();
        }}
        onContextMenu={(e) => {
          if (selectionMode) return;
          if (onContextMenu) {
            e.stopPropagation();
            onContextMenu(e);
          }
        }}
      >
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial 
          color={isSelected ? "#ff4d4d" : "#ffffff"} 
          emissive={isSelected ? "#ff4d4d" : "#ffffff"} 
          emissiveIntensity={isSelected ? 0.5 : 0.2} 
        />
        <Html position={[0, 0.1, 0]} center zIndexRange={[40, 0]} className={`${isSelected ? 'z-40' : 'z-0'}`}>
          <div 
            className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-mono backdrop-blur-sm transition-colors cursor-pointer select-none ${isSelected ? 'bg-red-900/80 text-white border-red-700' : 'bg-neutral-900/80 text-neutral-300 border-neutral-700 hover:bg-neutral-800/80'}`}
            onClick={(e) => {
              if (selectionMode) return;
              e.stopPropagation();
              onSelect();
            }}
            onContextMenu={(e) => {
              if (selectionMode) return;
              if (onContextMenu) {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e);
              }
            }}
          >
            {label}
          </div>
        </Html>
      </mesh>
    </TransformControls>
  );
}

function WASDHandler({ controlsRef, moveSpeed }: { controlsRef: React.RefObject<any>, moveSpeed: number }) {
  const [, get] = useKeyboardControls();
  const { camera } = useThree();

  useFrame((_state, delta) => {
    if (!controlsRef.current) return;

    const { forward, backward, left, right, up, down } = get();
    if (!forward && !backward && !left && !right && !up && !down) return;

    const speed = moveSpeed * delta;
    const moveVec = new THREE.Vector3();

    // Calculate forward/backward (projected to XZ plane for "walk" feel, or full 3D?)
    // User asked for E/Q for Up/Down, so W/S usually implies horizontal movement.
    const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forwardDir.y = 0;
    forwardDir.normalize();

    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    rightDir.y = 0;
    rightDir.normalize();

    if (forward) moveVec.add(forwardDir);
    if (backward) moveVec.sub(forwardDir);
    if (left) moveVec.sub(rightDir);
    if (right) moveVec.add(rightDir);

    // Normalize horizontal movement so diagonal isn't faster
    if (moveVec.lengthSq() > 0) {
      moveVec.normalize().multiplyScalar(speed);
    }

    // Vertical movement
    if (up) moveVec.y += speed;
    if (down) moveVec.y -= speed;

    camera.position.add(moveVec);
    controlsRef.current.target.add(moveVec);
  });

  return null;
}

const ViewerScene = forwardRef<ViewerHandle, ViewerProps & { 
  isShiftPressed: boolean, 
  isCtrlPressed: boolean,
  controlsRef: React.RefObject<any>,
  selectedCalibrationIndex: number | null,
  setSelectedCalibrationIndex: (index: number | null) => void
}>(({ 
  layers,
  activeLayerId,
  splatUrl, 
  scale, 
  rotation, 
  splatPosition, 
  pointSize, 
  threshold,
  gridSize, 
  gridDivisions, 
  gridThickness,
  points, 
  onUpdatePoint, 
  onAddPinAtPosition,
  selectedPinId,
  setSelectedPinId,
  useWASD,
  moveSpeed,
  viewDistance,
  splatViewDistance,
  isShiftPressed,
  controlsRef,
  isCalibrationMode,
  calibrationPoints,
  onCalibrationPointClick,
  onUpdateCalibrationPoint,
  selectedCalibrationIndex,
  setSelectedCalibrationIndex,
  recreateProxyTrigger,
  removeRedProxiesTrigger,
  debugProxy,
  proxyDistributionThreshold,
  sorThreshold,
  sorNeighbors,
  volumetricThresholdPercent,
  isAdjustingSplat,
  pinCategories,
  onUpdatePointCategories,
  showPinCategories,
  showFullCategories,
  pinFilter,
  renderQuality,
  onDeletePoint,
  selectionMode,
  selectionPenetrate,
  selectedIndices,
  setSelectedIndices,
  invertSelectionTrigger,
  brushSize,
  eraserHistory,
  setEraserHistory,
  erasedIndices,
  setErasedIndices,
  originalColors,
  setOriginalColors,
  connectedPinIds,
  connectionLineColor,
  isCtrlPressed,

  onAddEraserStroke,
  onUndoStroke,
  boundaries = [],
  boundariesOpacity = 0.4,
  setBoundaries,
  selectedBoundaryId,
  setSelectedBoundaryId,
  isPlacingBoundary,
  setIsPlacingBoundary,
  onAddBoundaryAtPosition
}, ref) => {
  const groupRef = useRef<THREE.Group>(null);

  useImperativeHandle(ref, () => ({
    exportCleanedPly: async () => {
      const splatMesh = groupRef.current?.children[0] as any;
      if (!splatMesh || !splatMesh.material || !splatMesh.material.uniforms) {
        console.error("No active splat found for export");
        return null;
      }
      
      const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (!centerAndScaleTexture || !covAndColorTexture) return null;

      const centerData = centerAndScaleTexture.image.data;
      const colorData = covAndColorTexture.image.data;

      return await exportToPly(centerData, colorData, undefined, erasedIndices, splatPosition, rotation);
    },
    goHome: () => {
      let center = new THREE.Vector3(0, 0, 0);
      let distance = 5;
      
      if (groupRef.current) {
        const box = new THREE.Box3().setFromObject(groupRef.current);
        if (isFinite(box.min.x)) {
          box.getCenter(center);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const fovRad = (50 * Math.PI) / 180;
          distance = (maxDim / (2 * Math.tan(fovRad / 2))) * 1.5;
          distance = Math.max(3, Math.min(distance, 150));
        }
      }
      
      const dir = new THREE.Vector3(1, 1, 1).normalize();
      const targetPos = center.clone().add(dir.multiplyScalar(distance));
      
      if (controlsRef.current) {
        const camera = controlsRef.current.object;
        if (camera) {
          camera.position.copy(targetPos);
          controlsRef.current.target.copy(center);
          controlsRef.current.update();
        }
      }
    }
  }));

  const splatRef = useRef<any>(null);
  const pointsProxyRef = useRef<THREE.Points | null>(null);
  const foundCandidateTimeRef = useRef<number | null>(null);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number] | null>(null);
  const [brushPosition, setBrushPosition] = useState<[number, number, number] | null>(null);
  const lastHoverCheck = useRef(0);
  const [isMoving, setIsMoving] = useState(false);
  const moveTimeoutRef = useRef<number | null>(null);

  // Selection Logic
  const [selectionPath2D, setSelectionPath2D] = useState<{ x: number, y: number }[]>([]);
  const isSelectingRef = useRef(false);
  const tempSelectionRef = useRef<Set<number>>(new Set());
  const { size } = useThree();
  
  const lastPointerRef = useRef(new THREE.Vector2(-999, -999));
  const lastCameraPosRef = useRef(new THREE.Vector3());
  const lastCameraRotRef = useRef(new THREE.Euler());
  const lastHitPointRef = useRef<THREE.Vector3 | null>(null);
  const isErasingRef = useRef(false);
  const currentStrokeRef = useRef<number[]>([]);
  
  const [showDropdown, setShowDropdown] = useState(false);
  const prevPointsLength = useRef(points.length);

  const { camera, raycaster, gl, scene } = useThree();

  const [isPovRotating, setIsPovRotating] = useState(false);
  const povStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0 && (e.ctrlKey || isCtrlPressed) && !isShiftPressed && !selectionMode) {
        setIsPovRotating(true);
        povStartRef.current = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isPovRotating || !povStartRef.current || !controlsRef.current) return;

      const deltaX = e.clientX - povStartRef.current.x;
      const deltaY = e.clientY - povStartRef.current.y;
      
      povStartRef.current = { x: e.clientX, y: e.clientY };

      const sensitivity = 0.003;
      const yawAngle = -deltaX * sensitivity;
      const pitchAngle = -deltaY * sensitivity;

      const target = controlsRef.current.target.clone();
      const offset = target.clone().sub(camera.position);

      const len = offset.length();

      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      
      const up = new THREE.Vector3(0, 1, 0);
      const testOffset = offset.clone().applyAxisAngle(right, pitchAngle);
      const angle = testOffset.angleTo(up);

      if (angle > 0.05 && angle < Math.PI - 0.05) {
        offset.copy(testOffset);
      }

      offset.setLength(len);

      const newTarget = camera.position.clone().add(offset);
      controlsRef.current.target.copy(newTarget);
      
      camera.lookAt(newTarget);
      controlsRef.current.update();

      if (renderQuality === 'efficacy') {
        setIsMoving(true);
        if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
        moveTimeoutRef.current = window.setTimeout(() => setIsMoving(false), 100);
      }

      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (isPovRotating) {
        setIsPovRotating(false);
        povStartRef.current = null;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (err) {}
        e.preventDefault();
        e.stopPropagation();
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown, { capture: true });
    canvas.addEventListener('pointermove', handlePointerMove, { capture: true });
    canvas.addEventListener('pointerup', handlePointerUp, { capture: true });

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      canvas.removeEventListener('pointermove', handlePointerMove, { capture: true });
      canvas.removeEventListener('pointerup', handlePointerUp, { capture: true });
    };
  }, [gl, camera, isPovRotating, isShiftPressed, isCtrlPressed, selectionMode, renderQuality]);

  // Show dropdown when a new pin is added
  useEffect(() => {
    if (points.length > prevPointsLength.current) {
      setShowDropdown(true);
    }
    prevPointsLength.current = points.length;
  }, [points.length]);

  // Filter points
  const visiblePoints = points.filter(p => {
    if (!pinFilter || pinFilter.categories.length === 0) return true;
    const pointCats = p.categories || [];
    if (pinFilter.matchAll) {
      return pinFilter.categories.every(c => pointCats.includes(c));
    } else {
      return pinFilter.categories.some(c => pointCats.includes(c));
    }
  });

  // Raycast against the invisible Points proxy
  const raycastSplat = (raycaster: THREE.Raycaster) => {
    if (!pointsProxyRef.current) return null;

    // Ensure the proxy transform matches the splat (if it's not parented correctly)
    // But we'll parent it to the same group, so it should be fine.
    
    // Adjust threshold for point hit detection
    const oldThreshold = raycaster.params.Points?.threshold;
    // Use the user-defined threshold directly
    const hitThreshold = threshold;
    raycaster.params.Points = { threshold: hitThreshold };

    const intersects = raycaster.intersectObject(pointsProxyRef.current, false);
    
    // Restore threshold
    if (oldThreshold !== undefined) raycaster.params.Points.threshold = oldThreshold;

    if (intersects.length > 0) {
      // Sort by distance to camera is already done by intersectObject
      return intersects[0].point;
    }
    return null;
  };

  const originalColorsRef = useRef(new Map<number, number>());
  const previouslyErasedIndicesRef = useRef(new Set<number>());

  useFrame(({ pointer }) => {
    // Sync splatViewDistance with the shader
    if (splatRef.current && splatRef.current.material) {
      const mat = splatRef.current.material;
      if (!mat.userData.shaderPatched) {
        mat.userData.shaderPatched = true;
        mat.onBeforeCompile = (shader: any) => {
          shader.uniforms.uSplatViewDistance = { value: splatViewDistance };
          mat.userData.shader = shader;
          
          shader.vertexShader = shader.vertexShader.replace(
            /void\s+main\s*\(\)\s*\{/,
            'uniform float uSplatViewDistance;\nvoid main() {'
          );
          
          shader.vertexShader = shader.vertexShader.replace(
            'vec4 pos2d = projectionMatrix * camspace;',
            `vec4 pos2d = projectionMatrix * camspace;
            if (uSplatViewDistance > 0.0 && -camspace.z > uSplatViewDistance) {
              gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
              return;
            }`
          );
        };
        mat.needsUpdate = true;
      } else if (mat.userData.shader) {
        mat.userData.shader.uniforms.uSplatViewDistance.value = splatViewDistance;
      }
    }

    // Throttle hover check
    const now = Date.now();
    if (now - lastHoverCheck.current < 50) return;
    lastHoverCheck.current = now;

    if (!isShiftPressed && !selectionMode) {
      if (ghostPosition) setGhostPosition(null);
      if (brushPosition) setBrushPosition(null);
      return;
    }

    let hitPoint = lastHitPointRef.current;
    
    // Only raycast if pointer or camera moved
    if (
      lastPointerRef.current.x !== pointer.x ||
      lastPointerRef.current.y !== pointer.y ||
      !lastCameraPosRef.current.equals(camera.position) ||
      !lastCameraRotRef.current.equals(camera.rotation)
    ) {
      lastPointerRef.current.copy(pointer);
      lastCameraPosRef.current.copy(camera.position);
      lastCameraRotRef.current.copy(camera.rotation);
      
      raycaster.setFromCamera(pointer, camera);
      hitPoint = raycastSplat(raycaster);
      lastHitPointRef.current = hitPoint;
    }

    if (hitPoint) {
      if (isShiftPressed) {
        const offset = 0.1; 
        const direction = camera.position.clone().sub(hitPoint).normalize();
        const newPos = hitPoint.clone().add(direction.multiplyScalar(offset));
        setGhostPosition([newPos.x, newPos.y, newPos.z]);
      } else {
        setGhostPosition(null);
      }
      
      if (selectionMode && !isCtrlPressed) {
        setBrushPosition([hitPoint.x, hitPoint.y, hitPoint.z]);
        
        // Erasing logic
        if (isErasingRef.current && brushSize) {
          const splatMesh = groupRef.current?.children[0] as any;
          if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
            const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
            const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
            
            if (centerAndScaleTexture && covAndColorTexture) {
              const centerData = centerAndScaleTexture.image.data; // Float32Array
              const colorData = covAndColorTexture.image.data; // Uint32Array
              const numSplats = centerData.length / 4;
              
              const brushWorldPos = hitPoint;
              const brushRadiusSq = brushSize * brushSize;
              
              // Transform brush to splat local space
              const invMatrix = new THREE.Matrix4().copy(splatMesh.matrixWorld).invert();
              const brushLocalPos = brushWorldPos.clone().applyMatrix4(invMatrix);
              // Assuming uniform scale for simplicity
              const localScale = new THREE.Vector3().setFromMatrixScale(splatMesh.matrixWorld).x;
              const brushLocalRadiusSq = (brushSize / localScale) * (brushSize / localScale);
              
              let modified = false;
              for (let i = 0; i < numSplats; i++) {
                const colorUint = colorData[i * 4 + 3];
                if ((colorUint >> 24) === 0) continue; // Already erased
                
                const x = centerData[i * 4 + 0];
                const y = centerData[i * 4 + 1];
                const z = centerData[i * 4 + 2];
                
                const dx = x - brushLocalPos.x;
                const dy = y - brushLocalPos.y;
                const dz = z - brushLocalPos.z;
                const distSq = dx*dx + dy*dy + dz*dz;
                
                if (distSq <= brushLocalRadiusSq) {
                  if (!selectedIndices.has(i) && !tempSelectionRef.current.has(i)) {
                    if (!originalColorsRef.current.has(i)) {
                      originalColorsRef.current.set(i, colorUint);
                    }
                    // Yellow: R=255, G=255, B=0, A=255. Little endian ABGR -> (255<<24) | (0<<16) | (255<<8) | 255
                    colorData[i * 4 + 3] = (255 << 24) | (0 << 16) | (255 << 8) | 255;
                    tempSelectionRef.current.add(i);
                    modified = true;
                  }
                }
              }
              
              if (modified) {
                covAndColorTexture.needsUpdate = true;
              }
            }
          }
        }
      } else {
        setBrushPosition(null);
      }
    } else {
      setGhostPosition(null);
      setBrushPosition(null);
    }
  });

  // Handle click for pin placement
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (selectionMode) return; // Disable pin placement in eraser mode
      
      if (e.button === 0 && e.shiftKey) {
        e.stopPropagation();
        e.preventDefault();

        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        
        const tempRaycaster = new THREE.Raycaster();
        tempRaycaster.setFromCamera({ x, y } as any, camera);
        
        const hitPoint = raycastSplat(tempRaycaster);
        
        if (hitPoint) {
          console.log('Raycast hit:', hitPoint);
          const offset = 0.1; 
          const direction = camera.position.clone().sub(hitPoint).normalize();
          const newPos = hitPoint.clone().add(direction.multiplyScalar(offset));
          
          if (groupRef.current) {
            // Pass world coordinates directly
            if (isPlacingBoundary && onAddBoundaryAtPosition) {
               onAddBoundaryAtPosition([newPos.x, newPos.y, newPos.z]);
            } else if (isCalibrationMode && onCalibrationPointClick) {
               onCalibrationPointClick([newPos.x, newPos.y, newPos.z]);
            } else {
               onAddPinAtPosition([newPos.x, newPos.y, newPos.z]);
            }
          }
        } else {
            console.log('Raycast missed');
        }
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => canvas.removeEventListener('pointerdown', handlePointerDown);
  }, [camera, gl, onAddPinAtPosition, isShiftPressed, selectionMode]);

    // Handle Selection Pointer Events
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (selectionMode && !isCtrlPressed && e.button === 0) {
        if (selectionMode === 'brush') {
          isErasingRef.current = true;
          tempSelectionRef.current.clear();
        } else {
          isSelectingRef.current = true;
          const rect = gl.domElement.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          if (selectionMode === 'polygon') {
          setSelectionPath2D(prev => {
            if (prev.length > 2) {
              const dist = Math.hypot(x - prev[0].x, y - prev[0].y);
              if (dist < 20) { // snap and close
                  isSelectingRef.current = false;
                  process2DSelection(prev);
                  return [];
              }
            }
            return [...prev, { x, y }];
          });
        } else {
            setSelectionPath2D([{ x, y }]);
          }
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isSelectingRef.current && (selectionMode === 'rect' || selectionMode === 'lasso')) {
        const rect = gl.domElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (selectionMode === 'rect') {
          setSelectionPath2D(prev => prev.length > 0 ? [prev[0], { x, y }] : [{ x, y }]);
        } else if (selectionMode === 'lasso') {
          setSelectionPath2D(prev => [...prev, { x, y }]);
        }
      }
    };

    const process2DSelection = (path: {x: number, y: number}[]) => {
      if (path.length < 2 && selectionMode !== 'rect') return;
      
      const splatMesh = groupRef.current?.children[0] as any;
      if (!splatMesh || !splatMesh.material || !splatMesh.material.uniforms) return;
      
      const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (!centerAndScaleTexture || !covAndColorTexture) return;

      const centerData = centerAndScaleTexture.image.data;
      const colorData = covAndColorTexture.image.data;
      const numSplats = centerData.length / 4;
      
      const rect = gl.domElement.getBoundingClientRect();
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      if (selectionMode === 'rect') {
        minX = Math.min(path[0].x, path[path.length - 1].x);
        maxX = Math.max(path[0].x, path[path.length - 1].x);
        minY = Math.min(path[0].y, path[path.length - 1].y);
        maxY = Math.max(path[0].y, path[path.length - 1].y);
      } else {
        for (const p of path) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }

      const isPointInPolygon = (x: number, y: number) => {
        if (selectionMode === 'rect') {
          return x >= minX && x <= maxX && y >= minY && y <= maxY;
        }
        let inside = false;
        for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
          const xi = path[i].x, yi = path[i].y;
          const xj = path[j].x, yj = path[j].y;
          const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const newSelection = new Set<number>();
      let modified = false;

      // Ensure matrices are up to date!
      camera.updateMatrixWorld();
      splatMesh.updateMatrixWorld();
      const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(splatMesh.matrixWorld);
      const viewMatrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, splatMesh.matrixWorld);

      let frontZ = Infinity;
      const projected = [];

      for (let i = 0; i < numSplats; i++) {
        const colorUint = colorData[i * 4 + 3];
        if ((colorUint >> 24) === 0) continue; // Erased
        
        const centerVec = new THREE.Vector3(centerData[i*4], centerData[i*4+1], centerData[i*4+2]);
        
        const vecNDC = centerVec.clone().applyMatrix4(viewProj);
        if (vecNDC.z < -1 || vecNDC.z > 1) continue; 
        
        const px = (vecNDC.x * hw) + hw;
        const py = -(vecNDC.y * hh) + hh;
        
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          if (isPointInPolygon(px, py)) {
            const viewSpace = centerVec.clone().applyMatrix4(viewMatrix);
            const linearDepth = -viewSpace.z; // In three.js camera looks down -Z
            
            projected.push({ i, depth: linearDepth });
            if (linearDepth < frontZ) frontZ = linearDepth;
          }
        }
      }

      // 0.2 world units as threshold for separation
      const zThreshold = 0.2; 
      for (const p of projected) {
        if (!selectionPenetrate && p.depth > frontZ + zThreshold) continue;
        
        newSelection.add(p.i);
        const colorUint = colorData[p.i * 4 + 3];
        if (!selectedIndices.has(p.i)) {
          if (!originalColorsRef.current.has(p.i)) {
            originalColorsRef.current.set(p.i, colorUint);
          }
          colorData[p.i * 4 + 3] = (255 << 24) | (0 << 16) | (255 << 8) | 255;
          modified = true;
        }
      }

      if (modified) {
        covAndColorTexture.needsUpdate = true;
      }
      if (newSelection.size > 0) {
        setSelectedIndices(prev => new Set([...prev, ...newSelection]));
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (selectionMode === 'brush' && isErasingRef.current) {
        isErasingRef.current = false;
        if (tempSelectionRef.current.size > 0) {
           setSelectedIndices(prev => new Set([...prev, ...tempSelectionRef.current]));
           tempSelectionRef.current.clear();
        }
      } else if (isSelectingRef.current) {
        if (selectionMode !== 'polygon') {
          isSelectingRef.current = false;
          // Capture current value using the functional update
          setSelectionPath2D(prev => {
            process2DSelection(prev);
            return []; // Clear after processing
          });
        }
      }
    };

    const handleDoubleClick = (e: MouseEvent) => {
      if (selectionMode === 'polygon' && isSelectingRef.current) {
        isSelectingRef.current = false;
        setSelectionPath2D(prev => {
          process2DSelection(prev);
          return [];
        });
      }
    }

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('dblclick', handleDoubleClick);
    
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [selectionMode, selectionPenetrate, isCtrlPressed, gl, camera, selectedIndices, setSelectedIndices]);

  // Sync texture with erasedIndices (for Undo) and selection
  const previouslySelectedIndicesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const splatMesh = groupRef.current?.children[0] as any;
    if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (covAndColorTexture) {
        const colorData = covAndColorTexture.image.data; // Uint32Array
        let modified = false;

        const currentlyErased = new Set(Array.from(erasedIndices?.keys() || []).filter(i => (erasedIndices?.get(i) || 0) > 0));
        const currentlySelected = selectedIndices || new Set();

        const allToProcess = new Set([
          ...previouslyErasedIndicesRef.current,
          ...currentlyErased,
          ...previouslySelectedIndicesRef.current,
          ...currentlySelected
        ]);

        allToProcess.forEach(i => {
           const isErasedNow = currentlyErased.has(i);
           const isSelectedNow = currentlySelected.has(i);
           
           const wasErased = previouslyErasedIndicesRef.current.has(i);
           const wasSelected = previouslySelectedIndicesRef.current.has(i);
           
           if (isErasedNow !== wasErased || isSelectedNow !== wasSelected) {
             const offset = i * 4;
             const colorUint = colorData[offset + 3];
             
             if (!originalColorsRef.current.has(i)) {
                const original = originalColors?.get(i) ?? colorUint;
                originalColorsRef.current.set(i, original);
             }
             
             const originalColor = originalColorsRef.current.get(i) ?? originalColors?.get(i) ?? colorUint;

             if (isErasedNow) {
               colorData[offset + 3] = originalColor & 0x00FFFFFF; // Transparent
             } else if (isSelectedNow) {
               // Yellow: R=255, G=255, B=0, A=255
               colorData[offset + 3] = (255 << 24) | (0 << 16) | (255 << 8) | 255;
             } else {
               colorData[offset + 3] = originalColor; // Restore
             }
             
             modified = true;
           }
        });

        previouslyErasedIndicesRef.current = currentlyErased;
        previouslySelectedIndicesRef.current = new Set(currentlySelected);

        if (modified) {
          covAndColorTexture.needsUpdate = true;
        }
      }
    }
  }, [erasedIndices, selectedIndices, originalColors]);

  // Handle invert selection
  useEffect(() => {
    if (invertSelectionTrigger > 0) {
      const splatMesh = groupRef.current?.children[0] as any;
      if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
        const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
        if (centerAndScaleTexture) {
          const numSplats = centerAndScaleTexture.image.data.length / 4;
          const newSelection = new Set<number>();
          const currentlyErased = new Set(Array.from(erasedIndices?.keys() || []).filter(i => (erasedIndices?.get(i) || 0) > 0));
          
          for (let i = 0; i < numSplats; i++) {
             if (!currentlyErased.has(i) && !selectedIndices.has(i)) {
               newSelection.add(i);
             }
          }
          setSelectedIndices(newSelection);
        }
      }
    }
  }, [invertSelectionTrigger]);

  const debugProxyRef = useRef(debugProxy);
  useEffect(() => {
    debugProxyRef.current = debugProxy;
  }, [debugProxy]);

  const cachedNoiseFlagsRef = useRef<{
    flags: Uint8Array | null,
    params: {
      proxyDistributionThreshold: number,
      sorThreshold: number,
      sorNeighbors: number,
      volumetricThresholdPercent: number,
      splatUrl: string | null
    }
  }>({
    flags: null,
    params: {
      proxyDistributionThreshold: -1,
      sorThreshold: -1,
      sorNeighbors: -1,
      volumetricThresholdPercent: -1,
      splatUrl: null
    }
  });

  const updateProxyColors = useCallback(() => {
    if (!pointsProxyRef.current || !pointsProxyRef.current.geometry) return;
    
    const positionsAttr = pointsProxyRef.current.geometry.attributes.position;
    if (!positionsAttr) return;
    
    const positions = positionsAttr.array;
    const numPoints = positionsAttr.count;
    const colors = new Float32Array(numPoints * 4);
    
    const cellSize = proxyDistributionThreshold;
    const grid = new Map<string, number>();
    const proxyToSplatIndex = pointsProxyRef.current.userData.proxyToSplatIndex;
    
    const currentlyErased = new Set(Array.from(erasedIndices?.keys() || []).filter(i => (erasedIndices?.get(i) || 0) > 0));

    const splatMesh = splatRef.current;
    let centerData: Float32Array | null = null;
    let colorData: Uint32Array | null = null;

    if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
      const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (centerAndScaleTexture && covAndColorTexture) {
        centerData = centerAndScaleTexture.image.data;
        colorData = covAndColorTexture.image.data;
      }
    }

    const currentParams = {
      proxyDistributionThreshold,
      sorThreshold,
      sorNeighbors,
      volumetricThresholdPercent,
      splatUrl
    };

    let noiseFlags = cachedNoiseFlagsRef.current.flags;
    const paramsChanged = 
      cachedNoiseFlagsRef.current.params.proxyDistributionThreshold !== currentParams.proxyDistributionThreshold ||
      cachedNoiseFlagsRef.current.params.sorThreshold !== currentParams.sorThreshold ||
      cachedNoiseFlagsRef.current.params.sorNeighbors !== currentParams.sorNeighbors ||
      cachedNoiseFlagsRef.current.params.volumetricThresholdPercent !== currentParams.volumetricThresholdPercent ||
      cachedNoiseFlagsRef.current.params.splatUrl !== currentParams.splatUrl;

    if (!noiseFlags || paramsChanged) {
      noiseFlags = identifyNoiseSplats(
        positions,
        numPoints,
        proxyToSplatIndex,
        centerData,
        colorData,
        proxyDistributionThreshold,
        sorThreshold,
        sorNeighbors,
        volumetricThresholdPercent
      );
      cachedNoiseFlagsRef.current = {
        flags: noiseFlags,
        params: currentParams
      };
    }

    for (let i = 0; i < numPoints; i++) {
      if (proxyToSplatIndex && currentlyErased.has(proxyToSplatIndex[i])) {
        // Hide erased splats
        colors[i * 4] = 0;
        colors[i * 4 + 1] = 0;
        colors[i * 4 + 2] = 0;
        colors[i * 4 + 3] = 0;
        continue;
      }

      const isRed = noiseFlags[i] === 1;
      
      if (!isRed) {
        // Blue (Not noise)
        colors[i * 4] = 0;
        colors[i * 4 + 1] = 0;
        colors[i * 4 + 2] = 1;
        colors[i * 4 + 3] = 1;
      } else {
        // Red (Noise)
        colors[i * 4] = 1;
        colors[i * 4 + 1] = 0;
        colors[i * 4 + 2] = 0;
        colors[i * 4 + 3] = 1;
      }
    }
    
    pointsProxyRef.current.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    
    if (pointsProxyRef.current.material) {
      const mat = pointsProxyRef.current.material as THREE.PointsMaterial;
      mat.vertexColors = true;
      mat.color.setHex(0xffffff);
      mat.needsUpdate = true;
    }
  }, [proxyDistributionThreshold, sorThreshold, sorNeighbors, volumetricThresholdPercent, erasedIndices, splatUrl]);

  useEffect(() => {
    updateProxyColors();
  }, [updateProxyColors]);

  const erasedIndicesRef = useRef(erasedIndices);
  useEffect(() => {
    erasedIndicesRef.current = erasedIndices;
  }, [erasedIndices]);

  useEffect(() => {
    if (removeRedProxiesTrigger > 0 && pointsProxyRef.current && pointsProxyRef.current.geometry) {
      const positionsAttr = pointsProxyRef.current.geometry.attributes.position;
      if (!positionsAttr) return;

      const positions = positionsAttr.array;
      const numPoints = positionsAttr.count;
      const cellSize = proxyDistributionThreshold;
      const grid = new Map<string, number>();
      const proxyToSplatIndex = pointsProxyRef.current.userData.proxyToSplatIndex;

      if (!proxyToSplatIndex) return;

      const currentErasedIndices = erasedIndicesRef.current;
      const currentlyErased = new Set(Array.from(currentErasedIndices?.keys() || []).filter(i => (currentErasedIndices?.get(i) || 0) > 0));

      const splatMesh = groupRef.current?.children[0] as any;
      let centerData: Float32Array | null = null;
      let colorData: Uint32Array | null = null;

      if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
        const centerAndScaleTexture = splatMesh.material.uniforms.centerAndScaleTexture?.value;
        const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
        if (centerAndScaleTexture && covAndColorTexture) {
          centerData = centerAndScaleTexture.image.data;
          colorData = covAndColorTexture.image.data;
        }
      }

      const noiseFlags = identifyNoiseSplats(
        positions,
        numPoints,
        proxyToSplatIndex,
        centerData,
        colorData,
        proxyDistributionThreshold,
        sorThreshold,
        sorNeighbors,
        volumetricThresholdPercent
      );

      const indicesToErase: number[] = [];
      for (let i = 0; i < numPoints; i++) {
        if (currentlyErased.has(proxyToSplatIndex[i])) continue;

        if (noiseFlags[i] === 1) {
          indicesToErase.push(proxyToSplatIndex[i]);
        }
      }

      if (indicesToErase.length > 0 && setEraserHistory && setErasedIndices && setOriginalColors) {
        setEraserHistory(prev => [...prev, { type: 'noise', indices: [...indicesToErase] }]);
        setErasedIndices(prev => {
          const next = new Map(prev);
          indicesToErase.forEach(idx => {
            const count = next.get(idx) || 0;
            next.set(idx, count + 1);
          });
          return next;
        });
        
        // Also need to save original colors if not already saved
        const splatMesh = groupRef.current?.children[0] as any;
        if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
          const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
          if (covAndColorTexture) {
            const colorData = covAndColorTexture.image.data;
            
            // Save to ref synchronously to avoid any timing issues
            indicesToErase.forEach(idx => {
              if (!originalColorsRef.current.has(idx)) {
                const offset = idx * 4;
                const colorUint = colorData[offset + 3];
                originalColorsRef.current.set(idx, colorUint);
              }
            });

            setOriginalColors(prev => {
              const next = new Map(prev);
              indicesToErase.forEach(idx => {
                if (!next.has(idx)) {
                  next.set(idx, originalColorsRef.current.get(idx)!);
                }
              });
              return next;
            });
          }
        }
      }
    }
  }, [removeRedProxiesTrigger]);

  useEffect(() => {
    if (splatUrl) {
      console.log('Splat URL changed or Recreate triggered, initializing proxy search...');
      originalColorsRef.current.clear();
      
      // Cleanup existing proxy if any
      if (pointsProxyRef.current) {
          console.log('Cleaning up old splat proxy before recreation');
          if (pointsProxyRef.current.parent) {
              pointsProxyRef.current.parent.remove(pointsProxyRef.current);
          }
          if (pointsProxyRef.current.geometry) pointsProxyRef.current.geometry.dispose();
          if (pointsProxyRef.current.material) (pointsProxyRef.current.material as any).dispose();
          pointsProxyRef.current = null;
          splatRef.current = null;
      }

      // Reset settle timer
      foundCandidateTimeRef.current = null;

      let attempts = 0;
      const maxAttempts = 100; // 50 seconds max
      
      const interval = setInterval(() => {
        // If proxy is already created (by a previous attempt in this interval), stop.
        if (pointsProxyRef.current) {
          clearInterval(interval);
          return;
        }

        let foundMesh: THREE.Mesh | null = null;
        scene.traverse((obj) => {
          if (foundMesh) return;
          if (obj.name.includes('splat') && (obj as any).isMesh) {
             foundMesh = obj as THREE.Mesh;
          }
        });
        
        if (foundMesh) {
             const mesh = foundMesh as THREE.Mesh;
             const geometry = mesh.geometry as THREE.InstancedBufferGeometry;
             const material = mesh.material as any;
             
             // Check if it's the texture-based splat we identified
             if (material.uniforms && material.uniforms.centerAndScaleTexture) {
                const tex = material.uniforms.centerAndScaleTexture.value;
                
                if (tex && tex.image && tex.image.data) {
                   const texData = tex.image.data;
                   
                   // Check if data is actually loaded (look for non-zero values)
                   let hasData = false;
                   const sampleLimit = Math.min(1000, texData.length);
                   for (let i = 0; i < sampleLimit; i++) {
                     if (texData[i] !== 0) {
                       hasData = true;
                       break;
                     }
                   }

                   if (!hasData) {
                     console.log(`Splat texture found but appears empty (all zeros). Waiting for data...`);
                     foundCandidateTimeRef.current = null; // Reset if data disappears
                     return; // Continue polling
                   }

                   // Data found, check for stability/settle time
                   if (!foundCandidateTimeRef.current) {
                       foundCandidateTimeRef.current = Date.now();
                       console.log('Splat candidate found with data, waiting for settle (1s)...');
                       return;
                   }

                   if (Date.now() - foundCandidateTimeRef.current < 1000) {
                       return; // Wait
                   }

                   console.log('Splat settled. Extracting points...');
                   
                   const splatIndexAttr = geometry.attributes.splatIndex;
                   
                   // Determine the true count of splats
                   let splatCount = geometry.instanceCount || 0;
                   
                   if (splatIndexAttr && splatIndexAttr.count > splatCount) {
                      splatCount = splatIndexAttr.count;
                   }
                   
                   // Fallback: calculate from texture size
                   const texCount = texData.length / 4;
                   if (texCount > splatCount) {
                      splatCount = texCount;
                   }

                   console.log(`Extracting ${splatCount} points from texture (data size: ${texData.length})...`);
                   
                   const positions = new Float32Array(splatCount * 3);
                   const splatIndices = splatIndexAttr ? splatIndexAttr.array : null;
                   const proxyToSplatIndex = new Uint32Array(splatCount);
                   
                   for (let i = 0; i < splatCount; i++) {
                      // If splatIndex exists, use it to lookup the texture data. Otherwise linear.
                      const dataIndex = splatIndices ? splatIndices[i] : i;
                      proxyToSplatIndex[i] = dataIndex;
                      
                      // Assuming RGBA texture (4 components per pixel)
                      const srcOffset = dataIndex * 4;
                      
                      if (srcOffset + 2 < texData.length) {
                         positions[i * 3] = texData[srcOffset];
                         positions[i * 3 + 1] = texData[srcOffset + 1];
                         positions[i * 3 + 2] = texData[srcOffset + 2];
                      }
                   }
                   
                   // Create the proxy
                   const pointsGeo = new THREE.BufferGeometry();
                   pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                   
                   const pointsMat = new THREE.PointsMaterial({ 
                      size: debugProxyRef.current ? 0.5 : 0.1, 
                      visible: true,
                      vertexColors: true,
                      transparent: true,
                      alphaTest: 0.5
                   });
                   
                   const pointsObj = new THREE.Points(pointsGeo, pointsMat);
                   pointsObj.name = 'splat-proxy';
                   pointsObj.visible = debugProxyRef.current;
                   pointsObj.userData.proxyToSplatIndex = proxyToSplatIndex;
                   
                   // Add to the splat mesh parent so it transforms with it but isn't hidden when splat is hidden
                   if (mesh.parent) {
                     mesh.parent.add(pointsObj);
                   } else {
                     mesh.add(pointsObj);
                   }
                   pointsProxyRef.current = pointsObj;
                   splatRef.current = mesh;
                   
                   updateProxyColors();
                   
                   console.log(`Created Splat Proxy from Texture Data! (${splatCount} points)`);
                   clearInterval(interval);
                   return;
                } else {
                   console.warn('Splat texture found but no data available yet.');
                   foundCandidateTimeRef.current = null;
                }
             }
             
             // Fallback for non-texture splats (standard attributes)
             else {
                 const positions = geometry.attributes['center'] || geometry.attributes['position'];
                 if (positions && positions.count > 100 && !pointsProxyRef.current) {
                    
                    if (!foundCandidateTimeRef.current) {
                        foundCandidateTimeRef.current = Date.now();
                        console.log('Found standard attribute-based splat. Waiting for settle (1s)...');
                        return;
                    }

                    if (Date.now() - foundCandidateTimeRef.current < 1000) {
                        return;
                    }

                    console.log('Splat settled (attr). Creating proxy...');
                    
                    const pointsGeo = new THREE.BufferGeometry();
                    pointsGeo.setAttribute('position', positions);
                    
                    const proxyToSplatIndex = new Uint32Array(positions.count);
                    for (let i = 0; i < positions.count; i++) {
                       proxyToSplatIndex[i] = i;
                    }
                    
                    const pointsMat = new THREE.PointsMaterial({ 
                       size: debugProxyRef.current ? 0.5 : 0.1, 
                       visible: true,
                       vertexColors: true,
                       transparent: true,
                       alphaTest: 0.5
                    });
                    
                    const pointsObj = new THREE.Points(pointsGeo, pointsMat);
                    pointsObj.name = 'splat-proxy';
                    pointsObj.visible = debugProxyRef.current;
                    pointsObj.userData.proxyToSplatIndex = proxyToSplatIndex;
                    
                    if (mesh.parent) {
                      mesh.parent.add(pointsObj);
                    } else {
                      mesh.add(pointsObj);
                    }
                    pointsProxyRef.current = pointsObj;
                    splatRef.current = mesh;
                    
                    updateProxyColors();
                    
                    console.log(`Created Splat Proxy from Attributes! (${positions.count} points)`);
                    clearInterval(interval);
                    return;
                 }
             }
        } else {
             // Mesh not found yet
             foundCandidateTimeRef.current = null;
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          console.warn('Stopped polling for splat. Could not find suitable object.');
          clearInterval(interval);
        }
      }, 500);

      return () => {
        clearInterval(interval);
        // Cleanup previous proxy when url changes or component unmounts
        if (pointsProxyRef.current) {
            console.log('Cleaning up old splat proxy');
            if (pointsProxyRef.current.parent) {
                pointsProxyRef.current.parent.remove(pointsProxyRef.current);
            }
            if (pointsProxyRef.current.geometry) pointsProxyRef.current.geometry.dispose();
            if (pointsProxyRef.current.material) (pointsProxyRef.current.material as any).dispose();
            pointsProxyRef.current = null;
            splatRef.current = null;
        }
      };
    }
  }, [splatUrl, scene, recreateProxyTrigger]);

  useEffect(() => {
    if (pointsProxyRef.current) {
      pointsProxyRef.current.visible = debugProxy;
      if (pointsProxyRef.current.material) {
        const mat = pointsProxyRef.current.material as THREE.PointsMaterial;
        mat.size = debugProxy ? 0.5 : 0.1;
        mat.needsUpdate = true;
      }
    }
  }, [debugProxy]);

  // 2. Sync to SVG Overlay
  useEffect(() => {
    const container = document.getElementById('svg-overlay');
    if (!container) return;
    
    if (!selectionMode || selectionMode === 'brush' || selectionPath2D.length === 0) {
      container.innerHTML = '';
      return;
    }
    
    let html = '';
    if (selectionMode === 'rect' && selectionPath2D.length >= 2) {
      const minX = Math.min(selectionPath2D[0].x, selectionPath2D[selectionPath2D.length - 1].x);
      const minY = Math.min(selectionPath2D[0].y, selectionPath2D[selectionPath2D.length - 1].y);
      const w = Math.abs(selectionPath2D[selectionPath2D.length - 1].x - selectionPath2D[0].x);
      const h = Math.abs(selectionPath2D[selectionPath2D.length - 1].y - selectionPath2D[0].y);
      
      html = `<svg width="100%" height="100%"><rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="rgba(79, 70, 229, 0.2)" stroke="rgb(99, 102, 241)" stroke-width="2" stroke-dasharray="4 4" /></svg>`;
    } else if (selectionMode === 'lasso' || selectionMode === 'polygon') {
      const isCloseToStart = selectionPath2D.length > 2 && Math.hypot(
          selectionPath2D[selectionPath2D.length - 1].x - selectionPath2D[0].x,
          selectionPath2D[selectionPath2D.length - 1].y - selectionPath2D[0].y
      ) < 20;

      const points = selectionPath2D.map(p => `${p.x},${p.y}`).join(' ');
      const fill = isCloseToStart ? "rgba(99, 102, 241, 0.4)" : "rgba(79, 70, 229, 0.2)";
      const stroke = isCloseToStart ? "rgb(250, 204, 21)" : "rgb(99, 102, 241)";

      html = `<svg width="100%" height="100%">
        <polyline points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-dasharray="4 4" />
        ${isCloseToStart ? `<circle cx="${selectionPath2D[0].x}" cy="${selectionPath2D[0].y}" r="6" fill="rgb(250, 204, 21)" />` : ''}
      </svg>`;
    }
    
    container.innerHTML = html;
  }, [selectionMode, selectionPath2D]);

  return (
    <>
      <color attach="background" args={['#171717']} />
      
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      
      <Suspense fallback={
        <Html center>
          <div className="text-neutral-400 font-mono text-sm animate-pulse">Loading Splat...</div>
        </Html>
      }>
        <group>
          {layers.find(l => l.id === activeLayerId)?.visible !== false && splatUrl ? (
            <group ref={groupRef} scale={scale} rotation={rotation} position={splatPosition}>
              <Splat 
                name="splat"
                src={splatUrl} 
                alphaTest={1 - Math.min(0.99, Math.max(0.01, pointSize))} 
                visible={!debugProxy && (!isMoving || renderQuality === 'quality')}
              />
            </group>
          ) : null}
          {layers.filter(l => l.id !== activeLayerId).map(layer => (
            <LayerSplatComponent key={layer.id} layer={layer} isMoving={isMoving} renderQuality={renderQuality || 'quality'} />
          ))}
        </group>
        {visiblePoints.map((point, index) => (
          <Pin 
            key={point.id} 
            point={point} 
            index={index}
            onUpdate={onUpdatePoint} 
            isSelected={selectedPinId === point.id}
            onSelect={() => {
              if (selectionMode) return;
              setSelectedPinId(point.id);
              setShowDropdown(false);
            }}
            isAdjustingSplat={isAdjustingSplat}
            showCategories={showPinCategories}
            showFullCategories={showFullCategories}
            onContextMenu={(e) => {
              if (selectionMode) return;
              if (e.type === 'startMove') {
                setShowDropdown(false);
              } else if (selectedPinId === point.id) {
                setShowDropdown(true);
              }
            }}
            selectionMode={selectionMode}
          />
        ))}

        {/* Connection Lines */}
        {(() => {
          if (!connectedPinIds || connectedPinIds.length < 2) return null;
          const validPoints = connectedPinIds
            .map(id => points.find(p => p.id === id)?.position)
            .filter((pos): pos is [number, number, number] => pos !== undefined);
          
          if (validPoints.length < 2) return null;
          
          // If 3 or more points, close the loop by adding the first point to the end
          const linePoints = validPoints.length >= 3 
            ? [...validPoints, validPoints[0]] 
            : validPoints;
          
          return (
            <Line
              points={linePoints}
              color={connectionLineColor || '#00ff00'}
              lineWidth={3}
              dashed={false}
            />
          );
        })()}

        {/* Category Dropdown and Delete Option for Selected Pin */}
        {selectedPinId && showDropdown && pinCategories && onUpdatePointCategories && (
          <Html position={points.find(p => p.id === selectedPinId)?.position || [0,0,0]} zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }}>
            {/* Categories (Right) */}
            <div 
              className="absolute left-4 top-0 bg-neutral-900 border border-neutral-700 rounded shadow-xl p-1 w-40 pointer-events-auto max-h-48 overflow-y-auto"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="text-[10px] text-neutral-500 px-2 py-1 border-b border-neutral-800 mb-1">Categories</div>
              {pinCategories.map(cat => {
                const point = points.find(p => p.id === selectedPinId);
                const isSelected = point?.categories?.includes(cat.name);
                return (
                  <div key={cat.name} className="mb-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (point) {
                          const currentCats = point.categories || [];
                          const newCats = isSelected
                            ? currentCats.filter(c => c !== cat.name)
                            : [...currentCats, cat.name];
                          onUpdatePointCategories(point.id, newCats);
                        }
                      }}
                      className={`w-full text-left text-[10px] px-2 py-1 rounded hover:bg-neutral-800 font-medium ${isSelected ? 'text-indigo-400' : 'text-neutral-300'}`}
                    >
                      {cat.name} {isSelected && '✓'}
                    </button>
                    {cat.subcategories.map(sub => {
                      const subCatName = `${cat.name}-${sub}`;
                      const isSubSelected = point?.categories?.includes(subCatName);
                      return (
                        <button
                          key={subCatName}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (point) {
                              const currentCats = point.categories || [];
                              const newCats = isSubSelected
                                ? currentCats.filter(c => c !== subCatName)
                                : [...currentCats, subCatName];
                              onUpdatePointCategories(point.id, newCats);
                            }
                          }}
                          className={`w-full text-left text-[10px] px-2 py-1 pl-4 rounded hover:bg-neutral-800 ${isSubSelected ? 'text-indigo-400' : 'text-neutral-400'}`}
                        >
                          {sub} {isSubSelected && '✓'}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {pinCategories.length === 0 && <div className="text-[10px] text-neutral-500 px-2 py-1">No categories</div>}
            </div>

            {/* Delete Option (Left) */}
            <div 
              className="absolute right-4 top-0 bg-red-900/90 border border-red-700 rounded shadow-xl p-1 pointer-events-auto cursor-pointer hover:bg-red-800"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (onDeletePoint && selectedPinId) onDeletePoint(selectedPinId);
              }}
            >
              <div className="flex items-center gap-1 px-1 py-0.5 text-white text-[10px]">
                <Trash2 size={12} />
                <span>Delete</span>
              </div>
            </div>
          </Html>
        )}
      </Suspense>

      {ghostPosition && !selectionMode && (
        <mesh position={ghostPosition}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial 
            color={isCalibrationMode ? "#fbbf24" : "#ffff00"} 
            emissive={isCalibrationMode ? "#d97706" : "#ffff00"}
            emissiveIntensity={0.5}
            transparent
            opacity={0.8}
          />
        </mesh>
      )}

      {brushPosition && selectionMode === 'brush' && (
        <mesh position={brushPosition}>
          <sphereGeometry args={[brushSize || 0.5, 16, 16]} />
          <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.5} />
        </mesh>
      )}

      

      {/* Calibration Visuals */}
      {isCalibrationMode && calibrationPoints && (
        <>
           {calibrationPoints.map((pos, i) => (
             <CalibrationPoint
               key={`calib-${i}`}
               pos={pos}
               i={i}
               selectedCalibrationIndex={selectedCalibrationIndex}
               setSelectedCalibrationIndex={setSelectedCalibrationIndex}
               isAdjustingSplat={isAdjustingSplat}
               onUpdateCalibrationPoint={onUpdateCalibrationPoint}
             />
           ))}
           {calibrationPoints.length === 2 && (
             <Line
               points={calibrationPoints}
               color={"#fbbf24"}
               lineWidth={3}
               dashed={false}
               depthTest={false}
               renderOrder={1000}
             />
           )}
        </>
      )}

      {gridSize > 0 && viewDistance > 0 && (
        <group {...{ pointerEvents: 'none' } as any}>
          <Grid
            name="grid"
            position={[0, -0.01, 0]}
            args={[viewDistance * 2, viewDistance * 2]}
            cellSize={gridSize / gridDivisions}
            cellThickness={gridThickness}
            cellColor="#404040"
            sectionSize={gridSize / (gridDivisions / 5)}
            sectionThickness={gridThickness * 1.5}
            sectionColor="#525252"
            fadeDistance={viewDistance}
            fadeStrength={1}
            infiniteGrid={false}
          />
        </group>
      )}

      <OrbitControls 
        makeDefault 
        ref={controlsRef} 
        enabled={!isShiftPressed && (!selectionMode || isCtrlPressed) && !isPovRotating} 
        enableDamping={false}
        onChange={() => {
          if (renderQuality === 'efficacy') {
            setIsMoving(true);
            // Debounce the stop
            if (moveTimeoutRef.current) clearTimeout(moveTimeoutRef.current);
            moveTimeoutRef.current = window.setTimeout(() => setIsMoving(false), 100);
          }
        }}
      />
      {useWASD && <WASDHandler controlsRef={controlsRef} moveSpeed={moveSpeed} />}

      <GizmoHelper alignment="top-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#ff3653', '#8adb00', '#2c8fff']} labelColor="white" />
      </GizmoHelper>

      {/* Center Point Boundary Boxes */}
      {boundaries && boundaries.filter((boundary: any) => boundary.visible !== false).map((boundary: any) => (
        <BoundaryVisualizer
          key={boundary.id}
          boundary={boundary}
          isSelected={selectedBoundaryId === boundary.id}
          onSelect={() => setSelectedBoundaryId?.(boundary.id)}
          onUpdate={(id, pos) => {
            setBoundaries?.(prev => prev.map(b => b.id === id ? { ...b, center: pos } : b));
          }}
          selectionMode={selectionMode}
          boundariesOpacity={boundariesOpacity}
        />
      ))}
    </>
  );
});

function CalibrationPoint({ pos, i, selectedCalibrationIndex, setSelectedCalibrationIndex, isAdjustingSplat, onUpdateCalibrationPoint }: any) {
  const isControlsVisible = selectedCalibrationIndex === i && !isAdjustingSplat;

  return (
    <group>
      <TransformControls
        mode="translate"
        space="world"
        size={0.5}
        showX={isControlsVisible}
        showY={isControlsVisible}
        showZ={isControlsVisible}
        enabled={isControlsVisible}
        position={pos}
        onMouseUp={(e: any) => {
          if (e.target && e.target.object && onUpdateCalibrationPoint) {
            const newPos = e.target.object.position;
            onUpdateCalibrationPoint(i, [newPos.x, newPos.y, newPos.z]);
          }
        }}
      >
        <mesh 
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCalibrationIndex(i);
          }}
          renderOrder={1000}
        >
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial 
            color={selectedCalibrationIndex === i ? "#fbbf24" : "#fbbf24"} 
            emissive={selectedCalibrationIndex === i ? "#fbbf24" : "#d97706"}
            emissiveIntensity={selectedCalibrationIndex === i ? 1 : 0.5}
            depthTest={false}
            transparent
          />
          <Html position={[0, 0, 0]} center zIndexRange={[100, 0]}>
            <div 
              className="bg-neutral-900/80 backdrop-blur-sm text-yellow-400 text-[10px] px-1.5 py-0.5 rounded border border-yellow-500/50 whitespace-nowrap mt-4 cursor-pointer hover:bg-neutral-800 transition-colors pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCalibrationIndex(i);
              }}
            >
              {i === 0 ? "Start" : "End"}
            </div>
          </Html>
        </mesh>
      </TransformControls>
    </group>
  );
}

function LayerSplatComponent({ layer, isMoving, renderQuality }: { layer: LayerData, isMoving: boolean, renderQuality: string }) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const splatMesh = groupRef.current?.children[0] as any;
    if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (covAndColorTexture) {
        const colorData = covAndColorTexture.image.data;
        let modified = false;

        const currentlyErased = new Set(Array.from(layer.erasedIndices.keys()).filter(i => (layer.erasedIndices.get(i) || 0) > 0));

        // Restore everything first using originalColors if available
        for (const [idx, originalColor] of Array.from(layer.originalColors.entries())) {
          if (!currentlyErased.has(idx)) {
            const offset = idx * 4;
            colorData[offset + 3] = originalColor; // Assuming little endian (alpha is the highest byte in Uint32? Wait, the original code uses bitwise ops. No problem, the original code does colorData[offset+0...3])
          }
        }

        // We can just rely on the standard trick: if it's erased, hide it.
        // Actually, without full originalColors logic, we can just hide it by setting point length to 0... but let's copy the erasing logic from the main component. 
        // For inactive components, they won't be erased interactively, so just syncing once is ok but we need to keep the original color somehow.
        // Just use the standard trick!
        const numSplats = colorData.length / 4;
        for (let i = 0; i < numSplats; i++) {
          const offset = i * 4;
          if (currentlyErased.has(i)) {
             // To hide: make it so small it disappears or alpha to 0. 
             // Note: In original code, it's: alpha=0 by modifying covAndColorTexture but they restore it from originalColors.
             // We can just skip complex logic if inactive layers are rarely heavily edited, but we'll try!
          }
        }
      }
    }
  }, [layer.erasedIndices, layer.originalColors]);

  // But realistically, inactive layer erasure isn't crucial if the user's focus is on the active layer. Let's just restore erased indices simply if we can.
  // Wait! The simplest way for LayerSplatComponent is just doing exactly what ViewerScene does:
  useEffect(() => {
    const splatMesh = groupRef.current?.children[0] as any;
    if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (covAndColorTexture) {
        const colorData = covAndColorTexture.image.data; // Uint32Array
        let modified = false;

        const currentlyErased = new Set(Array.from(layer.erasedIndices.keys()).filter(i => (layer.erasedIndices.get(i) || 0) > 0));
        
        // Restore
        for (const [idx, origColor] of Array.from(layer.originalColors.entries())) {
          if (!currentlyErased.has(idx)) {
            const r = (origColor >> 0) & 0xff;
            const g = (origColor >> 8) & 0xff;
            const b = (origColor >> 16) & 0xff;
            const a = (origColor >> 24) & 0xff;
            colorData[idx * 4 + 0] = r;
            colorData[idx * 4 + 1] = g;
            colorData[idx * 4 + 2] = b;
            colorData[idx * 4 + 3] = a;
            modified = true;
          }
        }

        // Erase
        for (let i = 0; i < colorData.length / 4; i++) {
          if (currentlyErased.has(i)) {
              if (colorData[i * 4 + 3] !== 0) {
                 colorData[i * 4 + 3] = 0;
                 modified = true;
              }
          }
        }

        if (modified) {
          covAndColorTexture.needsUpdate = true;
        }
      }
    }
  }, [layer.erasedIndices, layer.originalColors]);

  return (
    <group ref={groupRef} scale={layer.scale} rotation={layer.rotation} position={layer.splatPosition}>
      {layer.splatUrl ? (
        <Splat 
          name="splat"
          src={layer.splatUrl} 
          alphaTest={1 - Math.min(0.99, Math.max(0.01, layer.pointSize))} 
          visible={layer.visible && (!isMoving || renderQuality === 'quality')}
        />
      ) : null}
    </group>
  );
}

export default forwardRef<ViewerHandle, ViewerProps>((props, ref) => {
  const controlsRef = useRef<any>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [selectedCalibrationIndex, setSelectedCalibrationIndex] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [selectionPath2D, setSelectionPath2D] = useState<{ x: number, y: number }[]>([]);

  useEffect(() => {
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setIsTyping(true);
      }
    };
    const handleBlur = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setIsTyping(false);
      }
    };

    window.addEventListener('focus', handleFocus, true);
    window.addEventListener('blur', handleBlur, true);
    return () => {
      window.removeEventListener('focus', handleFocus, true);
      window.removeEventListener('blur', handleBlur, true);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
      if (e.key === 'Control') setIsCtrlPressed(true);
      
      // Ctrl+Z for undo
      if (e.key === 'z' && e.ctrlKey && props.selectionMode && !isTyping) {
        if (props.eraserHistory && props.eraserHistory.length > 0 && props.setEraserHistory && props.setErasedIndices) {
          const newHistory = [...props.eraserHistory];
          const lastStroke = newHistory.pop();
          
          if (lastStroke) {
            props.setEraserHistory(newHistory);
            props.setErasedIndices(prev => {
              const next = new Map(prev);
              lastStroke.indices.forEach(idx => {
                const count = next.get(idx) || 0;
                if (count <= 1) next.delete(idx);
                else next.set(idx, count - 1);
              });
              return next;
            });
          }
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
      if (e.key === 'Control') setIsCtrlPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [props.selectionMode, isTyping, props.eraserHistory, props.setEraserHistory, props.setErasedIndices]);

  const keyboardMap = [
    { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
    { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
    { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
    { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
    { name: 'up', keys: ['e', 'E'] },
    { name: 'down', keys: ['q', 'Q'] },
  ];

  const wasdEnabled = props.useWASD && !isTyping;
  const viewerSceneRef = useRef<ViewerHandle>(null);

  useImperativeHandle(ref, () => ({
    exportCleanedPly: async () => {
      if (viewerSceneRef.current) {
        return await viewerSceneRef.current.exportCleanedPly();
      }
      return null;
    },
    goHome: () => {
      if (viewerSceneRef.current) {
        viewerSceneRef.current.goHome();
      }
    }
  }));

  return (
    <div className="w-full h-full bg-neutral-900 relative">
      <KeyboardControls map={keyboardMap}>
        <Canvas 
          camera={{ position: [3, 2, 3], fov: 50, far: 10000 }}
          onPointerMissed={() => {
            props.setSelectedPinId(null);
            setSelectedCalibrationIndex(null);
          }}
          raycaster={{ params: { Points: { threshold: 0.5 }, Mesh: {}, Line: { threshold: 1 }, LOD: {}, Sprite: {} } }}
        >
          <ViewerScene 
            {...props} 
            ref={viewerSceneRef}
            isShiftPressed={isShiftPressed} 
            isCtrlPressed={isCtrlPressed}
            controlsRef={controlsRef} 
            selectedCalibrationIndex={selectedCalibrationIndex}
            setSelectedCalibrationIndex={setSelectedCalibrationIndex}
            isAdjustingSplat={props.isAdjustingSplat}
            useWASD={wasdEnabled}
          />
        </Canvas>
      </KeyboardControls>

      {/* Home Button next to Navigation Gizmo */}
      <button
        id="navigation-home-button"
        onClick={() => {
          if (viewerSceneRef.current) {
            viewerSceneRef.current.goHome();
          }
        }}
        className="absolute top-[76px] right-[145px] z-50 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 p-2.5 rounded-full shadow-lg border border-neutral-700 hover:border-neutral-500 transition-all flex items-center justify-center hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto shadow-indigo-950/20"
        title="Reset Cam view to Default View Angle (45 degrees on all axes)"
      >
        <Home size={15} />
      </button>
      
      {/* Overlay info */}
      <div className="absolute bottom-6 right-6 pointer-events-none">
        <div className="bg-neutral-950/80 backdrop-blur-md border border-neutral-800 rounded-lg p-3 text-xs text-neutral-400 font-mono flex flex-col gap-1">
          {props.selectionMode ? (
            <>
              <div>Left Click + Drag: Erase</div>
              <div>Ctrl + Drag: Move View</div>
              <div>Ctrl + Z: Undo</div>
            </>
          ) : wasdEnabled ? (
            <>
              <div>WASD: Move</div>
              <div>Drag: Look around</div>
              <div>E/Q: Up/Down</div>
            </>
          ) : (
            <>
              <div>Left Click: Rotate</div>
              <div>Right Click: Pan</div>
              <div>Scroll: Zoom</div>
              <div>Shift + Click: Add Pin</div>
              <div>Ctrl + Left Click + Drag: POV Rotate</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// Helper for boundary outline coordinates and vertical corner posts (from custom sketch)
function getBoundaryLines(center: [number, number, number], size: number, rotationDeg: number) {
  const [cx, cy, cz] = center;
  const s = size / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  
  const rotateX = (x: number, z: number) => x * Math.cos(rad) - z * Math.sin(rad);
  const rotateZ = (x: number, z: number) => x * Math.sin(rad) + z * Math.cos(rad);
  
  const p1: [number, number, number] = [cx + rotateX(-s, -s), cy, cz + rotateZ(-s, -s)];
  const p2: [number, number, number] = [cx + rotateX(s, -s), cy, cz + rotateZ(s, -s)];
  const p3: [number, number, number] = [cx + rotateX(s, s), cy, cz + rotateZ(s, s)];
  const p4: [number, number, number] = [cx + rotateX(-s, s), cy, cz + rotateZ(-s, s)];
  
  const baseLoop = [p1, p2, p3, p4, p1];
  const diag1 = [p1, p3];
  const diag2 = [p2, p4];
  
  // Height is scaled based on size, with a minimum of 1.5 meters for visual appeal
  const h = Math.max(1.5, size * 0.4);
  const post1 = [p1, [p1[0], p1[1] + h, p1[2]] as [number, number, number]];
  const post2 = [p2, [p2[0], p2[1] + h, p2[2]] as [number, number, number]];
  const post3 = [p3, [p3[0], p3[1] + h, p3[2]] as [number, number, number]];
  const post4 = [p4, [p4[0], p4[1] + h, p4[2]] as [number, number, number]];
  
  return { baseLoop, diag1, diag2, posts: [post1, post2, post3, post4] };
}

function BoundaryWalls({ center, size, rotation, color, opacity }: { center: [number, number, number], size: number, rotation: number, color: string, opacity: number }) {
  const { baseLoop } = useMemo(() => getBoundaryLines(center, size, rotation), [center, size, rotation]);
  const h = Math.max(1.5, size * 0.4);
  const cy = center[1];

  const p1 = baseLoop[0];
  const p2 = baseLoop[1];
  const p3 = baseLoop[2];
  const p4 = baseLoop[3];

  const vertices = useMemo(() => {
    const arr = new Float32Array(24 * 3);
    const w1 = [
      p1, p2, [p2[0], p2[1]+h, p2[2]],
      p1, [p2[0], p2[1]+h, p2[2]], [p1[0], p1[1]+h, p1[2]]
    ];
    const w2 = [
      p2, p3, [p3[0], p3[1]+h, p3[2]],
      p2, [p3[0], p3[1]+h, p3[2]], [p2[0], p2[1]+h, p2[2]]
    ];
    const w3 = [
      p3, p4, [p4[0], p4[1]+h, p4[2]],
      p3, [p4[0], p4[1]+h, p4[2]], [p3[0], p3[1]+h, p3[2]]
    ];
    const w4 = [
      p4, p1, [p1[0], p1[1]+h, p1[2]],
      p4, [p1[0], p1[1]+h, p1[2]], [p4[0], p4[1]+h, p4[2]]
    ];
    const all = [...w1, ...w2, ...w3, ...w4];
    for (let i = 0; i < 24; i++) {
      const pt = all[i];
      arr[i * 3] = pt[0];
      arr[i * 3 + 1] = pt[1];
      arr[i * 3 + 2] = pt[2];
    }
    return arr;
  }, [p1, p2, p3, p4, h]);

  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color(color) },
    uBaseY: { value: cy },
    uHeight: { value: h },
    uOpacity: { value: opacity }
  }), []);

  useEffect(() => {
    uniforms.uColor.value.set(color);
    uniforms.uBaseY.value = cy;
    uniforms.uHeight.value = h;
    uniforms.uOpacity.value = opacity;
  }, [color, cy, h, opacity, uniforms]);

  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[vertices, 3]}
        />
      </bufferGeometry>
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        vertexShader={`
          varying vec3 vPosition;
          void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uColor;
          uniform float uBaseY;
          uniform float uHeight;
          uniform float uOpacity;
          varying vec3 vPosition;
          void main() {
            float relY = clamp((vPosition.y - uBaseY) / uHeight, 0.0, 1.0);
            float alpha = (1.0 - relY) * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `}
        uniforms={uniforms}
      />
    </mesh>
  );
}

// Visualizer component using Three.js lines and handles
function BoundaryVisualizer({
  boundary,
  isSelected,
  onSelect,
  onUpdate,
  selectionMode,
  boundariesOpacity = 0.4
}: {
  boundary: any;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (id: string, center: [number, number, number]) => void;
  selectionMode: any;
  boundariesOpacity?: number;
}) {
  const isControlsVisible = isSelected && !selectionMode;
  const { baseLoop, diag1, diag2, posts } = getBoundaryLines(boundary.center, boundary.size, boundary.rotation);
  
  // Custom boundary color (defaults to violet)
  const boundaryColor = boundary.color || '#a78bfa';
  const lineColor = boundaryColor;
  const lineOpacity = isSelected ? 0.9 : 0.45;
  const lineWidth = isSelected ? 2.5 : 1.5;

  return (
    <>
      <TransformControls
        mode="translate"
        space="world"
        size={0.5}
        showX={isControlsVisible}
        showY={isControlsVisible}
        showZ={isControlsVisible}
        enabled={isControlsVisible}
        position={boundary.center}
        onMouseUp={(e: any) => {
          if (e.target && e.target.object) {
            const pos = e.target.object.position;
            onUpdate(boundary.id, [pos.x, pos.y, pos.z]);
          }
        }}
      >
        <mesh 
          onClick={(e) => {
            if (selectionMode) return;
            e.stopPropagation();
            onSelect();
          }}
        >
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial 
            color={boundaryColor} 
            emissive={boundaryColor} 
            emissiveIntensity={isSelected ? 0.6 : 0.2} 
          />
          <Html position={[0, 0.16, 0]} center zIndexRange={[50, 0]} className={`${isSelected ? 'z-50' : 'z-0'}`}>
            <div 
              className={`text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap font-mono backdrop-blur-sm transition-all cursor-pointer select-none font-semibold shadow-md`}
              style={{
                backgroundColor: isSelected ? 'rgba(15, 7, 30, 0.9)' : 'rgba(23, 23, 23, 0.85)',
                color: isSelected ? '#ffffff' : '#e5e5e5',
                borderColor: boundaryColor,
                transform: isSelected ? 'scale(1.05)' : 'none'
              }}
              onClick={(e) => {
                if (selectionMode) return;
                e.stopPropagation();
                onSelect();
              }}
            >
              🚩 {boundary.name}
            </div>
          </Html>
        </mesh>
      </TransformControls>

      {/* Renders the bottom square outline loop on the floor */}
      <Line points={baseLoop} color={lineColor} lineWidth={lineWidth} transparent opacity={lineOpacity} />

      {/* Renders the visual diags of center placement intersection */}
      <Line points={diag1} color={lineColor} lineWidth={lineWidth * 0.6} transparent opacity={lineOpacity * 0.4} />
      <Line points={diag2} color={lineColor} lineWidth={lineWidth * 0.6} transparent opacity={lineOpacity * 0.4} />

      {/* Renders the vertical limits at each of the 4 outer corners matching the sketch */}
      {posts.map((post, idx) => (
        <Line key={idx} points={post} color={lineColor} lineWidth={lineWidth * 0.8} transparent opacity={lineOpacity * 0.8} />
      ))}

      {/* Transparent gradient walls of the same color */}
      <BoundaryWalls
        center={boundary.center}
        size={boundary.size}
        rotation={boundary.rotation}
        color={boundaryColor}
        opacity={boundariesOpacity * (isSelected ? 1.0 : 0.5)}
      />
    </>
  );
}
