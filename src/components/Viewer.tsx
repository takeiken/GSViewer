import { useRef, Suspense, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html, Grid, Splat, TransformControls, KeyboardControls, useKeyboardControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Trash2 } from 'lucide-react';
import type { Point, PinCategory } from '../App';

type ViewerProps = {
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
  isCalibrationMode?: boolean;
  calibrationPoints?: [number, number, number][];
  onCalibrationPointClick?: (point: [number, number, number]) => void;
  onUpdateCalibrationPoint?: (index: number, point: [number, number, number]) => void;
  recreateProxyTrigger: number;
  removeRedProxiesTrigger: number;
  debugProxy: boolean;
  proxyDistributionThreshold: number;
  onUpdatePoints?: (updatedPoints: Point[]) => void;
  isAdjustingSplat?: boolean;
  pinCategories?: PinCategory[];
  onUpdatePointCategories?: (id: string, categories: string[]) => void;
  showPinCategories?: boolean;
  showFullCategories?: boolean;
  pinFilter?: { categories: string[], matchAll: boolean };
  renderQuality?: 'quality' | 'efficacy';
  onDeletePoint?: (id: string) => void;
  isEraserMode?: boolean;
  brushSize?: number;
  eraserHistory?: number[][];
  setEraserHistory?: React.Dispatch<React.SetStateAction<number[][]>>;
  erasedIndices?: Map<number, number>;
  setErasedIndices?: React.Dispatch<React.SetStateAction<Map<number, number>>>;
  originalColors?: Map<number, number>;
  setOriginalColors?: React.Dispatch<React.SetStateAction<Map<number, number>>>;
  connectedPinIds?: string[];
  connectionLineColor?: string;
};

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
  isEraserMode
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
  isEraserMode?: boolean;
}) {
  const formattedCategories = point.categories?.map(cat => {
    if (showFullCategories) return cat;
    const parts = cat.split('-');
    return parts.length > 1 ? parts.slice(1).join('-') : cat;
  }) || [];

  const label = showCategories && formattedCategories.length > 0
    ? `${point.name} (${formattedCategories.join(', ')})`
    : point.name;

  const isControlsVisible = isSelected && !isAdjustingSplat && !isEraserMode;

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
          if (isEraserMode) return;
          e.stopPropagation();
          onSelect();
        }}
        onContextMenu={(e) => {
          if (isEraserMode) return;
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
              if (isEraserMode) return;
              e.stopPropagation();
              onSelect();
            }}
            onContextMenu={(e) => {
              if (isEraserMode) return;
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

function ViewerScene({ 
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
  isAdjustingSplat,
  pinCategories,
  onUpdatePointCategories,
  showPinCategories,
  showFullCategories,
  pinFilter,
  renderQuality,
  onDeletePoint,
  isEraserMode,
  brushSize,
  eraserHistory,
  setEraserHistory,
  erasedIndices,
  setErasedIndices,
  originalColors,
  setOriginalColors,
  connectedPinIds,
  connectionLineColor,
  isCtrlPressed
}: ViewerProps & { 
  isShiftPressed: boolean, 
  isCtrlPressed: boolean,
  controlsRef: React.RefObject<any>,
  selectedCalibrationIndex: number | null,
  setSelectedCalibrationIndex: (index: number | null) => void
}) {
  const groupRef = useRef<THREE.Group>(null);
  const splatRef = useRef<any>(null);
  const pointsProxyRef = useRef<THREE.Points | null>(null);
  const foundCandidateTimeRef = useRef<number | null>(null);
  const [ghostPosition, setGhostPosition] = useState<[number, number, number] | null>(null);
  const [brushPosition, setBrushPosition] = useState<[number, number, number] | null>(null);
  const lastHoverCheck = useRef(0);
  const [isMoving, setIsMoving] = useState(false);
  const moveTimeoutRef = useRef<number | null>(null);
  const isErasingRef = useRef(false);
  const currentStrokeRef = useRef<number[]>([]);
  
  const [showDropdown, setShowDropdown] = useState(false);
  const prevPointsLength = useRef(points.length);

  const { camera, raycaster, gl, scene } = useThree();

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
    // Throttle hover check
    const now = Date.now();
    if (now - lastHoverCheck.current < 50) return;
    lastHoverCheck.current = now;

    if (!isShiftPressed && !isEraserMode) {
      if (ghostPosition) setGhostPosition(null);
      if (brushPosition) setBrushPosition(null);
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const hitPoint = raycastSplat(raycaster);

    if (hitPoint) {
      if (isShiftPressed) {
        const offset = 0.1; 
        const direction = camera.position.clone().sub(hitPoint).normalize();
        const newPos = hitPoint.clone().add(direction.multiplyScalar(offset));
        setGhostPosition([newPos.x, newPos.y, newPos.z]);
      } else {
        setGhostPosition(null);
      }
      
      if (isEraserMode && !isCtrlPressed) {
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
                  // Erase! Clear alpha (top 8 bits)
                  if (!originalColorsRef.current.has(i)) {
                    originalColorsRef.current.set(i, colorUint);
                  }
                  colorData[i * 4 + 3] = colorUint & 0x00FFFFFF;
                  currentStrokeRef.current.push(i);
                  modified = true;
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
      if (isEraserMode) return; // Disable pin placement in eraser mode
      
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
            if (isCalibrationMode && onCalibrationPointClick) {
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
  }, [camera, gl, onAddPinAtPosition, isShiftPressed, isEraserMode]);

  // Handle eraser pointer events
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (isEraserMode && !isCtrlPressed && e.button === 0) {
        isErasingRef.current = true;
        currentStrokeRef.current = [];
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (isErasingRef.current) {
        isErasingRef.current = false;
        if (currentStrokeRef.current.length > 0) {
          if (setEraserHistory && setErasedIndices && setOriginalColors) {
            setEraserHistory(prev => [...prev, [...currentStrokeRef.current]]);
            setErasedIndices(prev => {
              const next = new Map(prev);
              currentStrokeRef.current.forEach(idx => {
                const count = next.get(idx) || 0;
                next.set(idx, count + 1);
              });
              return next;
            });
            setOriginalColors(prev => {
              const next = new Map(prev);
              originalColorsRef.current.forEach((color, idx) => {
                if (!next.has(idx)) {
                  next.set(idx, color);
                }
              });
              return next;
            });
          }
        }
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isEraserMode, isCtrlPressed, gl, setEraserHistory, setErasedIndices]);

  // Sync texture with erasedIndices (for Undo)
  useEffect(() => {
    const splatMesh = groupRef.current?.children[0] as any;
    if (splatMesh && splatMesh.material && splatMesh.material.uniforms) {
      const covAndColorTexture = splatMesh.material.uniforms.covAndColorTexture?.value;
      if (covAndColorTexture) {
        const colorData = covAndColorTexture.image.data; // Uint32Array
        let modified = false;

        const currentlyErased = new Set(Array.from(erasedIndices?.keys() || []).filter(i => (erasedIndices?.get(i) || 0) > 0));

        // Find splats to restore: in previouslyErased but not in currentlyErased
        previouslyErasedIndicesRef.current.forEach(i => {
          if (!currentlyErased.has(i)) {
            const offset = i * 4;
            const colorUint = colorData[offset + 3];
            // Restore
            const originalColor = originalColorsRef.current.get(i) ?? originalColors?.get(i) ?? (colorUint | 0xFF000000);
            colorData[offset + 3] = originalColor;
            modified = true;
          }
        });

        // Find splats to erase: in currentlyErased but not in previouslyErased
        currentlyErased.forEach(i => {
          if (!previouslyErasedIndicesRef.current.has(i)) {
            const offset = i * 4;
            const colorUint = colorData[offset + 3];
            // Erase
            colorData[offset + 3] = colorUint & 0x00FFFFFF;
            modified = true;
          }
        });

        previouslyErasedIndicesRef.current = currentlyErased;

        if (modified) {
          covAndColorTexture.needsUpdate = true;
        }
      }
    }
  }, [erasedIndices, originalColors]);

  const debugProxyRef = useRef(debugProxy);
  useEffect(() => {
    debugProxyRef.current = debugProxy;
  }, [debugProxy]);

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

    for (let i = 0; i < numPoints; i++) {
      if (proxyToSplatIndex && currentlyErased.has(proxyToSplatIndex[i])) continue;
      const x = Math.floor(positions[i * 3] / cellSize);
      const y = Math.floor(positions[i * 3 + 1] / cellSize);
      const z = Math.floor(positions[i * 3 + 2] / cellSize);
      const key = `${x},${y},${z}`;
      grid.set(key, (grid.get(key) || 0) + 1);
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

      const x = Math.floor(positions[i * 3] / cellSize);
      const y = Math.floor(positions[i * 3 + 1] / cellSize);
      const z = Math.floor(positions[i * 3 + 2] / cellSize);
      const key = `${x},${y},${z}`;
      const count = grid.get(key) || 0;
      
      if (count > 10) {
        // Blue (very close)
        colors[i * 4] = 0;
        colors[i * 4 + 1] = 0;
        colors[i * 4 + 2] = 1;
        colors[i * 4 + 3] = 1;
      } else if (count > 2) {
        // Green (slightly separated)
        colors[i * 4] = 0;
        colors[i * 4 + 1] = 1;
        colors[i * 4 + 2] = 0;
        colors[i * 4 + 3] = 1;
      } else {
        // Red (outliers)
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
  }, [proxyDistributionThreshold, erasedIndices]);

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

      for (let i = 0; i < numPoints; i++) {
        if (currentlyErased.has(proxyToSplatIndex[i])) continue;
        const x = Math.floor(positions[i * 3] / cellSize);
        const y = Math.floor(positions[i * 3 + 1] / cellSize);
        const z = Math.floor(positions[i * 3 + 2] / cellSize);
        const key = `${x},${y},${z}`;
        grid.set(key, (grid.get(key) || 0) + 1);
      }

      const indicesToErase: number[] = [];
      for (let i = 0; i < numPoints; i++) {
        if (currentlyErased.has(proxyToSplatIndex[i])) continue;

        const x = Math.floor(positions[i * 3] / cellSize);
        const y = Math.floor(positions[i * 3 + 1] / cellSize);
        const z = Math.floor(positions[i * 3 + 2] / cellSize);
        const key = `${x},${y},${z}`;
        const count = grid.get(key) || 0;

        if (count <= 2) {
          indicesToErase.push(proxyToSplatIndex[i]);
        }
      }

      if (indicesToErase.length > 0 && setEraserHistory && setErasedIndices && setOriginalColors) {
        setEraserHistory(prev => [...prev, [...indicesToErase]]);
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
        {splatUrl && (
          <group ref={groupRef} scale={scale} rotation={rotation} position={splatPosition}>
            <Splat 
              name="splat"
              src={splatUrl} 
              alphaTest={1 - Math.min(0.99, Math.max(0.01, pointSize))} 
              visible={!debugProxy && (!isMoving || renderQuality === 'quality')}
            />
          </group>
        )}
        {visiblePoints.map((point, index) => (
          <Pin 
            key={point.id} 
            point={point} 
            index={index}
            onUpdate={onUpdatePoint} 
            isSelected={selectedPinId === point.id}
            onSelect={() => {
              if (isEraserMode) return;
              setSelectedPinId(point.id);
              setShowDropdown(false);
            }}
            isAdjustingSplat={isAdjustingSplat}
            showCategories={showPinCategories}
            showFullCategories={showFullCategories}
            onContextMenu={(e) => {
              if (isEraserMode) return;
              if (e.type === 'startMove') {
                setShowDropdown(false);
              } else if (selectedPinId === point.id) {
                setShowDropdown(true);
              }
            }}
            isEraserMode={isEraserMode}
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

      {ghostPosition && !isEraserMode && (
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

      {brushPosition && isEraserMode && (
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
        enabled={!isShiftPressed && (!isEraserMode || isCtrlPressed)} 
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
    </>
  );
}

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

export default function Viewer(props: ViewerProps) {
  const controlsRef = useRef<any>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [selectedCalibrationIndex, setSelectedCalibrationIndex] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);

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
      if (e.key === 'z' && e.ctrlKey && props.isEraserMode && !isTyping) {
        if (props.eraserHistory && props.eraserHistory.length > 0 && props.setEraserHistory && props.setErasedIndices) {
          const newHistory = [...props.eraserHistory];
          const lastStroke = newHistory.pop();
          
          if (lastStroke) {
            props.setEraserHistory(newHistory);
            props.setErasedIndices(prev => {
              const next = new Map(prev);
              lastStroke.forEach(idx => {
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
  }, [props.isEraserMode, isTyping, props.eraserHistory, props.setEraserHistory, props.setErasedIndices]);

  const keyboardMap = [
    { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
    { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
    { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
    { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
    { name: 'up', keys: ['e', 'E'] },
    { name: 'down', keys: ['q', 'Q'] },
  ];

  const wasdEnabled = props.useWASD && !isTyping;

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
      
      {/* Overlay info */}
      <div className="absolute bottom-6 right-6 pointer-events-none">
        <div className="bg-neutral-950/80 backdrop-blur-md border border-neutral-800 rounded-lg p-3 text-xs text-neutral-400 font-mono flex flex-col gap-1">
          {props.isEraserMode ? (
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
