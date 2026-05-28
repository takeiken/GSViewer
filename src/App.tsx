import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import { HelpCircle, X } from 'lucide-react';
import Viewer, { ViewerHandle } from './components/Viewer';
import Sidebar from './components/Sidebar';
import NotificationContainer, { NotificationItem, NotificationType } from './components/Notification';
import WidgetPanel from './components/WidgetPanel';
import LayerWidget from './components/LayerWidget';
import SelectionWidget from './components/SelectionWidget';

export type Point = {
  id: string;
  position: [number, number, number];
  name: string;
  categories?: string[];
};

export type SplatSource = {
  type: 'url' | 'file';
  value: string;
};

export type EraserStroke = {
  type: 'manual' | 'noise';
  indices: number[];
};

export type PinCategory = {
  name: string;
  subcategories: string[];
};

export type PinFilter = {
  categories: string[];
  matchAll: boolean;
};

export type WGS84Coordinate = {
  lat: number;
  lng: number;
};

export type LayerData = {
  id: string;
  name: string;
  visible: boolean;
  splatUrl: string;
  splatSource: SplatSource;
  scale: number;
  rotation: [number, number, number];
  splatPosition: [number, number, number];
  pointSize: number;
  threshold: number;
  splatViewDistance: number;
  eraserHistory: EraserStroke[];
  erasedIndices: Map<number, number>;
  selectedIndices: Set<number>;
  originalColors: Map<number, number>;
};

export type WGS84Calibration = {
  p1: [number, number, number];
  p2: [number, number, number];
  wgs1: WGS84Coordinate;
  wgs2: WGS84Coordinate;
};

export default function App() {
  const viewerRef = useRef<ViewerHandle>(null);
  
  const [layers, setLayers] = useState<LayerData[]>([{
    id: uuidv4(),
    name: 'Main Splat',
    visible: true,
    splatUrl: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat',
    splatSource: { type: 'url', value: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat' },
    scale: 1,
    rotation: [0, 0, 0],
    splatPosition: [0, 0, 0],
    pointSize: 1,
    threshold: 0.1,
    splatViewDistance: 0,
    erasedIndices: new Map(),
    selectedIndices: new Set(),
    eraserHistory: [],
    originalColors: new Map(),
  }]);
  const [activeLayerId, setActiveLayerId] = useState<string>(layers[0].id);

  const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];

  const updateActiveLayer = useCallback((updates: Partial<LayerData>) => {
    setLayers(prev => prev.map(l => l.id === (activeLayerId || prev[0].id) ? { ...l, ...updates } : l));
  }, [activeLayerId]);

  const splatUrl = activeLayer.splatUrl;
  const setSplatUrl = (url: string) => updateActiveLayer({ splatUrl: url });

  const splatSource = activeLayer.splatSource;
  const setSplatSource = (source: SplatSource) => updateActiveLayer({ splatSource: source });

  const scale = activeLayer.scale;
  const setScale = (s: number | ((prev: number) => number)) => updateActiveLayer({ scale: typeof s === 'function' ? s(activeLayer.scale) : s });

  const pointSize = activeLayer.pointSize;
  const setPointSize = (s: number | ((prev: number) => number)) => updateActiveLayer({ pointSize: typeof s === 'function' ? s(activeLayer.pointSize) : s });

  const threshold = activeLayer.threshold;
  const setThreshold = (s: number | ((prev: number) => number)) => updateActiveLayer({ threshold: typeof s === 'function' ? s(activeLayer.threshold) : s });

  const rotation = activeLayer.rotation;
  const setRotation = (s: [number, number, number] | ((prev: [number, number, number]) => [number, number, number])) => updateActiveLayer({ rotation: typeof s === 'function' ? s(activeLayer.rotation) : s });

  const splatPosition = activeLayer.splatPosition;
  const setSplatPosition = (s: [number, number, number] | ((prev: [number, number, number]) => [number, number, number])) => updateActiveLayer({ splatPosition: typeof s === 'function' ? s(activeLayer.splatPosition) : s });

  const splatViewDistance = activeLayer.splatViewDistance;
  const setSplatViewDistance = (s: number | ((prev: number) => number)) => updateActiveLayer({ splatViewDistance: typeof s === 'function' ? s(activeLayer.splatViewDistance) : s });

  const erasedIndices = activeLayer.erasedIndices;
  const setErasedIndices = (val: any) => updateActiveLayer({ erasedIndices: typeof val === 'function' ? val(activeLayer.erasedIndices) : val });

  const selectedIndices = activeLayer.selectedIndices;
  const setSelectedIndices = (val: any) => updateActiveLayer({ selectedIndices: typeof val === 'function' ? val(activeLayer.selectedIndices) : val });

  const eraserHistory = activeLayer.eraserHistory;
  const setEraserHistory = (val: any) => updateActiveLayer({ eraserHistory: typeof val === 'function' ? val(activeLayer.eraserHistory) : val });

  const originalColors = activeLayer.originalColors;
  const setOriginalColors = (val: any) => updateActiveLayer({ originalColors: typeof val === 'function' ? val(activeLayer.originalColors) : val });
  const [gridSize, setGridSize] = useState<number>(10);
  const [gridDivisions, setGridDivisions] = useState<number>(10);
  const [gridThickness, setGridThickness] = useState<number>(1.0);
  const [points, setPoints] = useState<Point[]>([]);
  const [pinCategories, setPinCategories] = useState<PinCategory[]>([
    { name: 'Coral', subcategories: ['Porites', 'Pavona'] },
    { name: 'Area', subcategories: [] }
  ]);
  const [pinFilter, setPinFilter] = useState<PinFilter>({ categories: [], matchAll: false });
  const [showPinCategories, setShowPinCategories] = useState<boolean>(false);
  const [showFullCategories, setShowFullCategories] = useState<boolean>(false);
  const [renderQuality, setRenderQuality] = useState<'quality' | 'efficacy'>('quality');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [useWASD, setUseWASD] = useState<boolean>(false);
  const [moveSpeed, setMoveSpeed] = useState<number>(5);
  const [viewDistance, setViewDistance] = useState<number>(100);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({ gridSize: true });
  const [wgs84Calibration, setWgs84Calibration] = useState<WGS84Calibration | null>(null);

  // Calibration State
  const [isCalibrationMode, setIsCalibrationMode] = useState(false);
  const [calibrationMethod, setCalibrationMethod] = useState<'size' | 'vertical_marker'>('size');
  const [calibrationPoints, setCalibrationPoints] = useState<[number, number, number][]>([]);
  const [recreateProxyTrigger, setRecreateProxyTrigger] = useState(0);
  const [removeRedProxiesTrigger, setRemoveRedProxiesTrigger] = useState(0);
  const [debugProxy, setDebugProxy] = useState(false);
  const [proxyDistributionThreshold, setProxyDistributionThreshold] = useState(0.1);
  const [sorThreshold, setSorThreshold] = useState(2.0);
  const [sorNeighbors, setSorNeighbors] = useState(20);
  const [volumetricThresholdPercent, setVolumetricThresholdPercent] = useState(10.0);
  const [splatExportFileName, setSplatExportFileName] = useState('cleaned_model.splat');
  const [exportFormat, setExportFormat] = useState<'splat' | 'ply'>('splat');
  const [showProxyHelp, setShowProxyHelp] = useState(false);
  const [showEditToolsHelp, setShowEditToolsHelp] = useState(false);
  const [showSettingsHelp, setShowSettingsHelp] = useState(false);

  // Selection State
  const [selectionMode, setSelectionMode] = useState<'rect' | 'lasso' | 'polygon' | 'brush' | null>(null);
  const [selectionPenetrate, setSelectionPenetrate] = useState(true);
  const [brushSize, setBrushSize] = useState(0.5);
  const [invertSelectionTrigger, setInvertSelectionTrigger] = useState(0);

  // Layer History State
  const [deletedLayersHistory, setDeletedLayersHistory] = useState<LayerData[]>([]);
  const [undoneDeletedLayersHistory, setUndoneDeletedLayersHistory] = useState<LayerData[]>([]);

  // Connection State
  const [connectedPinIds, setConnectedPinIds] = useState<string[]>([]);
  const [connectionLineColor, setConnectionLineColor] = useState<string>('#00ff00');

  useEffect(() => {
    setSelectionMode(null);
  }, [splatUrl]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const updateSplatTransform = (
    newScale?: number,
    newRotation?: [number, number, number],
    newPosition?: [number, number, number]
  ) => {
    // Current Transform
    const currentScale = scale;
    const currentRotationEuler = new THREE.Euler(...rotation);
    const currentPos = new THREE.Vector3(...splatPosition);
    
    const currentMatrix = new THREE.Matrix4().compose(
      currentPos,
      new THREE.Quaternion().setFromEuler(currentRotationEuler),
      new THREE.Vector3(currentScale, currentScale, currentScale)
    );
    
    // New Transform
    const nextScale = newScale ?? scale;
    const nextRotationEuler = newRotation ? new THREE.Euler(...newRotation) : currentRotationEuler;
    const nextPos = newPosition ? new THREE.Vector3(...newPosition) : currentPos;
    
    const nextMatrix = new THREE.Matrix4().compose(
      nextPos,
      new THREE.Quaternion().setFromEuler(nextRotationEuler),
      new THREE.Vector3(nextScale, nextScale, nextScale)
    );
    
    // Update Points
    const inverseCurrent = currentMatrix.invert();
    const newPoints = points.map(p => {
      const vec = new THREE.Vector3(...p.position);
      vec.applyMatrix4(inverseCurrent); // To Local
      vec.applyMatrix4(nextMatrix);     // To New World
      return { ...p, position: [vec.x, vec.y, vec.z] as [number, number, number] };
    });
    
    setPoints(newPoints);

    // Update Calibration Points
    const newCalibrationPoints = calibrationPoints.map(p => {
      const vec = new THREE.Vector3(...p);
      vec.applyMatrix4(inverseCurrent); // To Local
      vec.applyMatrix4(nextMatrix);     // To New World
      return [vec.x, vec.y, vec.z] as [number, number, number];
    });
    setCalibrationPoints(newCalibrationPoints);

    if (newScale !== undefined) setScale(newScale);
    if (newRotation !== undefined) setRotation(newRotation);
    if (newPosition !== undefined) setSplatPosition(newPosition);
  };

  const handleSetScale = (s: number) => updateSplatTransform(s, undefined, undefined);
  const handleSetRotation = (r: [number, number, number]) => updateSplatTransform(undefined, r, undefined);
  const handleSetSplatPosition = (p: [number, number, number]) => updateSplatTransform(undefined, undefined, p);

  const addNotification = useCallback((message: string, type: NotificationType) => {
    const id = uuidv4();
    setNotifications((prev) => {
      const newNotifications = [...prev, { id, message, type }];
      if (newNotifications.length > 4) {
        return newNotifications.slice(newNotifications.length - 4);
      }
      return newNotifications;
    });
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleToggleLock = useCallback((field: string) => {
    const currentLocked = lockedFields[field];
    const nextLocked = !currentLocked;
    setLockedFields(prev => ({ ...prev, [field]: nextLocked }));
    addNotification(`Field ${field} ${nextLocked ? 'locked' : 'unlocked'}`, 'info');
  }, [lockedFields, addNotification]);

  const handleStartCalibration = (method: 'size' | 'vertical_marker') => {
    setIsCalibrationMode(true);
    setCalibrationMethod(method);
    setCalibrationPoints([]);
    if (method === 'vertical_marker') {
      addNotification('Vertical Marker: Shift+Click higher point, then lower point.', 'info');
    } else {
      addNotification('Calibration Mode: Shift+Click two points to define distance', 'info');
    }
  };

  const handleCancelCalibration = () => {
    setIsCalibrationMode(false);
    setCalibrationPoints([]);
    addNotification('Calibration cancelled', 'info');
  };

  const handleCalibrationPointClick = (point: [number, number, number]) => {
    if (calibrationPoints.length < 2) {
      const newPoints = [...calibrationPoints, point];
      setCalibrationPoints(newPoints);
      if (newPoints.length === 2) {
         addNotification('Points selected. Enter real distance in sidebar.', 'success');
      } else {
         addNotification('First point selected. Select second point.', 'info');
      }
    }
  };

  const handleUpdateCalibrationPoint = (index: number, newPosition: [number, number, number]) => {
    const newPoints = [...calibrationPoints];
    newPoints[index] = newPosition;
    setCalibrationPoints(newPoints);
  };

  const handleApplyCalibration = (realDistance: number, wgs1?: WGS84Coordinate, wgs2?: WGS84Coordinate) => {
    if (calibrationPoints.length !== 2) return;
    
    // Calculate distance between points in 3D space
    const dx = calibrationPoints[0][0] - calibrationPoints[1][0];
    const dy = calibrationPoints[0][1] - calibrationPoints[1][1];
    const dz = calibrationPoints[0][2] - calibrationPoints[1][2];
    const virtualDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (virtualDistance === 0) {
        addNotification('Points are identical. Cannot calibrate.', 'error');
        return;
    }

    const newGridSize = (virtualDistance / realDistance) * 0.1 * gridDivisions;
    setGridSize(newGridSize);
    setLockedFields(prev => ({ ...prev, gridSize: true }));

    if (calibrationMethod === 'vertical_marker') {
      const v = new THREE.Vector3(dx, dy, dz);
      v.normalize();
      const targetV = new THREE.Vector3(0, 1, 0); // pointing up
      const deltaQ = new THREE.Quaternion().setFromUnitVectors(v, targetV);
      const currentQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
      const nextQ = deltaQ.multiply(currentQ);
      const nextEuler = new THREE.Euler().setFromQuaternion(nextQ, 'XYZ');
      updateSplatTransform(undefined, [nextEuler.x, nextEuler.y, nextEuler.z], undefined);
    }
    
    setIsCalibrationMode(false);
    
    if (wgs1 && wgs2) {
      setWgs84Calibration({
        p1: calibrationPoints[0],
        p2: calibrationPoints[1],
        wgs1,
        wgs2
      });
      addNotification(`Grid and WGS84 calibrated! 1 cell = 10cm`, 'success');
    } else {
      addNotification(`Grid calibrated! 1 cell = 10cm`, 'success');
    }
    
    setCalibrationPoints([]);
  };


  const handleRecreateProxy = () => {
    setRecreateProxyTrigger(prev => prev + 1);
    addNotification('Recreating proxy mesh...', 'info');
  };

  const handleRemoveRedProxies = () => {
    setRemoveRedProxiesTrigger(prev => prev + 1);
    addNotification('Removing red proxies...', 'info');
  };

  const handleAddPoint = () => {
    const newId = uuidv4();
    const newName = `Pin ${points.length + 1}`;
    setPoints([...points, { id: newId, position: [0, 0, 0], name: newName }]);
    setSelectedPinId(newId);
    addNotification('New pin added', 'success');
  };

  const handleAddPinAtPosition = (position: [number, number, number]) => {
    const newId = uuidv4();
    const newName = `Pin ${points.length + 1}`;
    setPoints([...points, { id: newId, position, name: newName }]);
    setSelectedPinId(newId);
    addNotification('New pin added at cursor', 'success');
  };

  const [isAdjustingSplat, setIsAdjustingSplat] = useState(false);

  const handleUpdatePoints = (updatedPoints: Point[]) => {
    setPoints(updatedPoints);
  };

  const handleUpdatePoint = (id: string, newPosition: [number, number, number]) => {
    setPoints(points.map(p => p.id === id ? { ...p, position: newPosition } : p));
  };

  const handleUpdatePointName = (id: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      addNotification('Pin name cannot be empty', 'error');
      return;
    }

    const isDuplicate = points.some(p => p.id !== id && p.name === trimmedName);
    if (isDuplicate) {
      addNotification(`Pin name "${trimmedName}" is already taken`, 'error');
      return;
    }
    
    setPoints(points.map(p => p.id === id ? { ...p, name: trimmedName } : p));
    addNotification(`Pin renamed to "${trimmedName}"`, 'success');
  };

  const handleUpdatePointCategories = (id: string, categories: string[]) => {
    setPoints(points.map(p => p.id === id ? { ...p, categories } : p));
  };

  const handleDeletePoint = (id: string) => {
    setPoints(points.filter(p => p.id !== id));
    if (selectedPinId === id) {
      setSelectedPinId(null);
    }
    setConnectedPinIds(prev => prev.filter(pinId => pinId !== id));
    addNotification('Pin deleted', 'info');
  };

  const handleImportSettings = async (settings: any) => {
    try {
      // Unlock all fields except gridSize
      setLockedFields({ gridSize: true });

      let urlValid = true;
      if (settings.source) {
        // Handle new source format
        if (settings.source.type && settings.source.value) {
            setSplatSource(settings.source);
            if (settings.source.type === 'url') {
                // Validate URL
                 const url = settings.source.value;
                 if (url.includes('blob:')) {
                     urlValid = false;
                     addNotification('Blob URLs are not allowed.', 'error');
                 } else {
                     try {
                         new URL(url);
                         setSplatUrl(url);
                     } catch (e) {
                         urlValid = false;
                         addNotification('Imported URL is invalid.', 'error');
                     }
                 }
            } else {
                // File type logic...
                if (settings.source.splatUrl) {
                    const url = settings.source.splatUrl;
                    if (url.includes('blob:')) {
                        // For file type, if the saved URL is blob, we can't use it.
                        // We just notify the user.
                        addNotification(`Scene uses local file "${settings.source.value}". You may need to re-upload it.`, 'info');
                    } else {
                        setSplatUrl(url);
                    }
                }
            }
        } else if (settings.source.splatUrl) {
            // Legacy/Fallback
            const url = settings.source.splatUrl;
            setSplatSource({ type: 'url', value: url });
            
            if (url.includes('blob:')) {
                 urlValid = false;
                 addNotification('Blob URLs are not allowed.', 'error');
            } else {
               try {
                 new URL(url);
                 setSplatUrl(url);
               } catch (e) {
                 urlValid = false;
                 addNotification('Imported URL is invalid.', 'error');
               }
            }
        }
      }

      if (settings.transform?.scale !== undefined) setScale(settings.transform.scale);
      if (settings.transform?.pointSize !== undefined) setPointSize(settings.transform.pointSize);
      if (settings.transform?.threshold !== undefined) setThreshold(settings.transform.threshold);
      if (settings.grid?.size !== undefined) setGridSize(settings.grid.size);
      if (settings.grid?.divisions !== undefined) setGridDivisions(settings.grid.divisions);
      if (settings.grid?.thickness !== undefined) setGridThickness(settings.grid.thickness);
      if (settings.grid?.viewDistance !== undefined) setViewDistance(settings.grid.viewDistance);
      if (settings.transform?.splatViewDistance !== undefined) setSplatViewDistance(settings.transform.splatViewDistance);
      if (settings.navigation?.moveSpeed !== undefined) setMoveSpeed(settings.navigation.moveSpeed);
      if (settings.pins) setPoints(settings.pins);
      if (settings.pinCategories) setPinCategories(settings.pinCategories);
      if (settings.showPinCategories !== undefined) setShowPinCategories(settings.showPinCategories);
      if (settings.showFullCategories !== undefined) setShowFullCategories(settings.showFullCategories);
      
      addNotification('Settings imported successfully', 'success');
    } catch (error) {
      addNotification('Failed to import settings', 'error');
      console.error(error);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      // Ctrl+Shift+Z or Ctrl+Y for redo layer deletion if not in eraser mode
      if (((e.key === 'z' && e.ctrlKey && e.shiftKey) || (e.key === 'y' && e.ctrlKey)) && !selectionMode) {
        setUndoneDeletedLayersHistory(prev => {
          if (prev.length === 0) return prev;
          const layerToDelete = prev[prev.length - 1];
          setLayers(oldLayers => {
            const newLayers = oldLayers.filter(l => l.id !== layerToDelete.id);
            if (activeLayerId === layerToDelete.id) {
              if (newLayers.length > 0) setActiveLayerId(newLayers[0].id);
              else setActiveLayerId('');
            }
            return newLayers;
          });
          setDeletedLayersHistory(oldArr => [...oldArr, layerToDelete]);
          addNotification(`Redid delete layer: ${layerToDelete.name}`, 'info');
          return prev.slice(0, -1);
        });
        return;
      }

      // Ctrl+Z for undo layer deletion if not in eraser mode
      if (e.key === 'z' && e.ctrlKey && !e.shiftKey && !selectionMode) {
        setDeletedLayersHistory(prev => {
          if (prev.length === 0) return prev;
          const lastDeleted = prev[prev.length - 1];
          setLayers(oldLayers => [...oldLayers, lastDeleted]);
          setActiveLayerId(lastDeleted.id);
          setUndoneDeletedLayersHistory(oldArr => [...oldArr, lastDeleted]);
          addNotification(`Restored layer: ${lastDeleted.name}`, 'info');
          return prev.slice(0, -1);
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectionMode, activeLayerId, addNotification]);

  const handleExportCleanedPly = async (filename: string) => {
    if (!viewerRef.current) return;
    addNotification('Preparing PLY export...', 'info');
    try {
      const blob = await (viewerRef.current as any).exportCleanedPly();
      if (!blob) throw new Error('Failed to generate PLY blob');
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.toLowerCase().endsWith('.ply') ? filename : `${filename}.ply`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addNotification('PLY exported successfully!', 'success');
    } catch (error) {
      console.error(error);
      addNotification('Failed to export PLY.', 'error');
    }
  };

  return (
    <div 
      className="flex h-screen w-full bg-neutral-900 text-neutral-100 font-sans overflow-hidden select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Sidebar
        layers={layers}
        setLayers={setLayers}
        activeLayerId={activeLayerId}
        setActiveLayerId={setActiveLayerId}
        splatUrl={splatUrl}
        setSplatUrl={setSplatUrl}
        splatSource={splatSource}
        setSplatSource={setSplatSource}
        scale={scale}
        setScale={handleSetScale}
        pointSize={pointSize}
        setPointSize={setPointSize}
        threshold={threshold}
        setThreshold={setThreshold}
        rotation={rotation}
        setRotation={handleSetRotation}
        splatPosition={splatPosition}
        setSplatPosition={handleSetSplatPosition}
        gridSize={gridSize}
        setGridSize={setGridSize}
        gridDivisions={gridDivisions}
        setGridDivisions={setGridDivisions}
        gridThickness={gridThickness}
        setGridThickness={setGridThickness}
        points={points}
        onAddPoint={handleAddPoint}
        onDeletePoint={handleDeletePoint}
        onUpdatePoint={handleUpdatePoint}
        onUpdatePointName={handleUpdatePointName}
        selectedPinId={selectedPinId}
        setSelectedPinId={setSelectedPinId}
        useWASD={useWASD}
        setUseWASD={setUseWASD}
        moveSpeed={moveSpeed}
        setMoveSpeed={setMoveSpeed}
        viewDistance={viewDistance}
        setViewDistance={setViewDistance}
        splatViewDistance={splatViewDistance}
        setSplatViewDistance={setSplatViewDistance}
        addNotification={addNotification}
        onImportSettings={handleImportSettings}
        lockedFields={lockedFields}
        onToggleLock={handleToggleLock}
        isCalibrationMode={isCalibrationMode}
        calibrationPoints={calibrationPoints}
        onStartCalibration={handleStartCalibration}
        onCancelCalibration={handleCancelCalibration}
        onApplyCalibration={handleApplyCalibration}
        onRecreateProxy={handleRecreateProxy}
        onRemoveRedProxies={handleRemoveRedProxies}
        debugProxy={debugProxy}
        setDebugProxy={setDebugProxy}
        proxyDistributionThreshold={proxyDistributionThreshold}
        setProxyDistributionThreshold={setProxyDistributionThreshold}
        sorThreshold={sorThreshold}
        setSorThreshold={setSorThreshold}
        sorNeighbors={sorNeighbors}
        setSorNeighbors={setSorNeighbors}
        volumetricThresholdPercent={volumetricThresholdPercent}
        setVolumetricThresholdPercent={setVolumetricThresholdPercent}
        onInteractionStart={() => setIsAdjustingSplat(true)}
        onInteractionEnd={() => setIsAdjustingSplat(false)}
        pinCategories={pinCategories}
        setPinCategories={setPinCategories}
        pinFilter={pinFilter}
        setPinFilter={setPinFilter}
        onUpdatePointCategories={handleUpdatePointCategories}
        showPinCategories={showPinCategories}
        setShowPinCategories={setShowPinCategories}
        showFullCategories={showFullCategories}
        setShowFullCategories={setShowFullCategories}
        renderQuality={renderQuality}
        setRenderQuality={setRenderQuality}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        eraserHistory={eraserHistory}
        setEraserHistory={setEraserHistory}
        erasedIndices={erasedIndices}
        setErasedIndices={setErasedIndices}
        originalColors={originalColors}
        setOriginalColors={setOriginalColors}
        wgs84Calibration={wgs84Calibration}
        splatExportFileName={splatExportFileName}
        setSplatExportFileName={setSplatExportFileName}
        exportFormat={exportFormat}
        setExportFormat={setExportFormat}
        onExportPly={handleExportCleanedPly}
        onShowProxyHelp={() => setShowProxyHelp(true)}
        onShowEditToolsHelp={() => setShowEditToolsHelp(true)}
        onShowSettingsHelp={() => setShowSettingsHelp(true)}
      />
      <main className="flex-1 relative">
        <div id="svg-overlay" className="absolute top-0 left-0 w-full h-full pointer-events-none z-50"></div>
        <Viewer
          ref={viewerRef}
          layers={layers}
          activeLayerId={activeLayerId}
          splatUrl={splatUrl}
          scale={scale}
          pointSize={pointSize}
          threshold={threshold}
          rotation={rotation}
          splatPosition={splatPosition}
          gridSize={gridSize}
          gridDivisions={gridDivisions}
          gridThickness={gridThickness}
          points={points}
          onUpdatePoint={handleUpdatePoint}
          onUpdatePoints={handleUpdatePoints}
          onAddPinAtPosition={handleAddPinAtPosition}
          selectedPinId={selectedPinId}
          setSelectedPinId={setSelectedPinId}
          useWASD={useWASD}
          moveSpeed={moveSpeed}
          viewDistance={viewDistance}
          splatViewDistance={splatViewDistance}
          isCalibrationMode={isCalibrationMode}
          calibrationPoints={calibrationPoints}
          onCalibrationPointClick={handleCalibrationPointClick}
          onUpdateCalibrationPoint={handleUpdateCalibrationPoint}
          recreateProxyTrigger={recreateProxyTrigger}
          removeRedProxiesTrigger={removeRedProxiesTrigger}
          debugProxy={debugProxy}
          proxyDistributionThreshold={proxyDistributionThreshold}
          sorThreshold={sorThreshold}
          sorNeighbors={sorNeighbors}
          volumetricThresholdPercent={volumetricThresholdPercent}
          isAdjustingSplat={isAdjustingSplat}
          pinCategories={pinCategories}
          onUpdatePointCategories={handleUpdatePointCategories}
          showPinCategories={showPinCategories}
          showFullCategories={showFullCategories}
          pinFilter={pinFilter}
          renderQuality={renderQuality}
          onDeletePoint={handleDeletePoint}
          selectionMode={selectionMode}
          selectionPenetrate={selectionPenetrate}
          brushSize={brushSize}
          eraserHistory={eraserHistory}
          setEraserHistory={setEraserHistory}
          erasedIndices={erasedIndices}
          setErasedIndices={setErasedIndices}
          selectedIndices={selectedIndices}
          setSelectedIndices={setSelectedIndices}
          invertSelectionTrigger={invertSelectionTrigger}
          originalColors={originalColors}
          setOriginalColors={setOriginalColors}
          connectedPinIds={connectedPinIds}
          connectionLineColor={connectionLineColor}
        />
        <WidgetPanel
          points={points}
          pinFilter={pinFilter}
          pinCategories={pinCategories}
          showFullCategories={showFullCategories}
          connectedPinIds={connectedPinIds}
          setConnectedPinIds={setConnectedPinIds}
          connectionLineColor={connectionLineColor}
          setConnectionLineColor={setConnectionLineColor}
        />
        <LayerWidget
          layers={layers}
          setLayers={setLayers}
          activeLayerId={activeLayerId}
          setActiveLayerId={setActiveLayerId}
          deletedLayersHistory={deletedLayersHistory}
          setDeletedLayersHistory={setDeletedLayersHistory}
          undoneDeletedLayersHistory={undoneDeletedLayersHistory}
          setUndoneDeletedLayersHistory={setUndoneDeletedLayersHistory}
        />
        <SelectionWidget
          selectionMode={selectionMode}
          setSelectionMode={setSelectionMode}
          selectionPenetrate={selectionPenetrate}
          setSelectionPenetrate={setSelectionPenetrate}
          brushSize={brushSize}
          setBrushSize={setBrushSize}
          hasSelection={selectedIndices.size > 0}
          onEraseSelected={() => {
            if (selectedIndices.size === 0) return;
            // Record eraser history
            const newStroke = {
              type: 'manual' as const,
              indices: Array.from(selectedIndices)
            };
            setEraserHistory(prev => [...prev, newStroke]);
            // Apply erased
            setErasedIndices((prev: Map<number, number>) => {
              const next = new Map(prev);
              selectedIndices.forEach(idx => {
                const current = next.get(idx) || 0;
                next.set(idx, current + 1);
              });
              return next;
            });
            // Clear selection
            setSelectedIndices(new Set());
          }}
          onInvertSelection={() => {
            setInvertSelectionTrigger(prev => prev + 1);
          }}
          onClearSelection={() => {
            setSelectedIndices(new Set());
          }}
        />
        <NotificationContainer notifications={notifications} removeNotification={removeNotification} />
      </main>

      {showProxyHelp && (
        <div className="fixed inset-0 z-[999999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={() => setShowProxyHelp(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
              title="Close Guide"
            >
              <X size={16} />
            </button>

            {/* Title */}
            <div className="flex items-center gap-2 text-indigo-400 mb-6 pb-4 border-b border-neutral-800">
              <HelpCircle size={24} />
              <h3 className="font-semibold text-lg text-neutral-100 font-sans">Splat Proxy Sliders Explained</h3>
            </div>

            {/* Explanation Content */}
            <div className="space-y-6 text-sm text-neutral-300 leading-relaxed">
              <p className="text-neutral-400 font-sans">
                The Splat Proxy filters let you dynamically analyze 3D Gaussian distributions to isolate and remove background noise, floaters, and reconstruction artifacts.
              </p>

              {/* Slider 1 */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60 font-sans">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Proxy Grid Scale / Color Threshold
                </h4>
                <div className="space-y-2 mt-2">
                  <div>
                    <span className="text-neutral-400 font-medium font-sans">What it does: </span>
                    Defines the local neighborhood density search grid cell dimension.
                  </div>
                  <div>
                    <span className="text-neutral-400 font-medium font-sans">How it works: </span>
                    Splat points are binned into a spatial hash grid using the threshold value as the voxel size. Low-density grid blocks containing sparse points are classified as outlier candidates.
                  </div>
                  <div className="bg-neutral-950 p-2.5 rounded font-mono text-xs text-indigo-400 border border-neutral-900">
                    <span className="text-neutral-500 font-semibold uppercase text-[10px] block mb-1">Grid/Voxel Size:</span>
                    Voxel Dimension = Slider Value (meters)
                    <span className="block mt-1 text-neutral-500">Outliers defined as points in voxels with count &le; 2</span>
                  </div>
                </div>
              </div>

              {/* Slider 2 */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60 font-sans">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  SOR Threshold (Std Dev)
                </h4>
                <div className="space-y-2 mt-2">
                  <div>
                    <span className="text-neutral-400 font-medium font-sans">What it does: </span>
                    Specifies the strictness threshold of Statistical Outlier Removal.
                  </div>
                  <div>
                    <span className="text-neutral-400 font-medium font-sans">How it works: </span>
                    Computes the average distance to neighboring points. Points with neighbor distances exceeding the global average by more than a set standard deviation multiple are flagged as noise.
                  </div>
                  <div className="bg-neutral-950 p-2.5 rounded font-mono text-xs text-indigo-400 border border-neutral-900">
                    <span className="text-neutral-500 font-semibold uppercase text-[10px] block mb-1">Mathematical Formula:</span>
                    d_i &gt; &mu; + &alpha; &times; &sigma;
                    <span className="block mt-1 text-neutral-500">
                      where d_i = avg distance to k-neighbors, &mu; = global mean distance, &sigma; = global standard deviation, and &alpha; = SOR threshold slider value.
                    </span>
                  </div>
                </div>
              </div>

              {/* Slider 3 */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60 font-sans">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  SOR Neighbors
                </h4>
                <div className="space-y-2 mt-2 font-sans">
                  <div>
                    <span className="text-neutral-400 font-medium">What it does: </span>
                    Sets the local sample resolution neighborhood parameter for distance analysis.
                  </div>
                  <div>
                    <span className="text-neutral-400 font-medium">How it works: </span>
                    Determines how many k-nearest neighbors to query and average for each point in the dataset when performing distance evaluation.
                  </div>
                  <div className="bg-neutral-950 p-2.5 rounded font-mono text-xs text-indigo-400 border border-neutral-900">
                    <span className="text-neutral-500 font-semibold uppercase text-[10px] block mb-1 font-sans">Parameter:</span>
                    Neighbor Sample Count (k) = Slider Value
                    <span className="block mt-1 text-neutral-500 font-sans">Lower values capture isolated points; higher values capture cloud anomalies.</span>
                  </div>
                </div>
              </div>

              {/* Slider 4 */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60 font-sans">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Volumetric Noise %
                </h4>
                <div className="space-y-2 mt-2 font-sans">
                  <div>
                    <span className="text-neutral-400 font-medium">What it does: </span>
                    Filters out big, loose, and low-density "cloud floaters" by their volumetric opacity.
                  </div>
                  <div>
                    <span className="text-neutral-400 font-medium">How it works: </span>
                    Estimates the physical volume of each Gaussian splat ellipsoidal region, then computes an opacity-to-volume ratio score. Low-ranking splats in the bottom percentile are flagged.
                  </div>
                  <div className="bg-neutral-950 p-2.5 rounded font-mono text-xs text-indigo-400 border border-neutral-900">
                    <span className="text-neutral-500 font-semibold uppercase text-[10px] block mb-1">Mathematical Formula:</span>
                    Volume = &radic;Max(0, Det(&Sigma;))
                    <span className="block text-indigo-400">Score = Opacity / (Volume + 10⁻¹⁰)</span>
                    <span className="block mt-1 text-neutral-500">
                      where &Sigma; = covariance matrix. Bottom &beta;% (slider value) of splats with lowest scores are removed.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Close Actions */}
            <div className="mt-6 pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setShowProxyHelp(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 px-4 py-2 rounded-md text-sm transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditToolsHelp && (
        <div className="fixed inset-0 z-[999999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={() => setShowEditToolsHelp(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
              title="Close Guide"
            >
              <X size={16} />
            </button>

            {/* Title */}
            <div className="flex items-center gap-2 text-indigo-400 mb-6 pb-4 border-b border-neutral-800">
              <HelpCircle size={24} />
              <h3 className="font-semibold text-lg text-neutral-100 font-sans">Edit & Export Tools Guide</h3>
            </div>

            {/* Explanation Content */}
            <div className="space-y-6 text-sm text-neutral-300 leading-relaxed font-sans">
              <p className="text-neutral-400">
                The layout lets you refine 3D Gaussian Splats surgically, and export your polished results to either <span className="text-neutral-200 font-semibold">.splat</span> or <span className="text-neutral-200 font-semibold">.ply</span> file types.
              </p>

              {/* Key Features */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-indigo-300 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Export Formats Supported
                </h4>
                <ul className="list-disc pl-5 space-y-2 mt-1 text-neutral-300">
                  <li>
                    <span className="text-neutral-400 font-medium">Standard (.splat): </span>
                    Perfect for WebGL renderers and standard viewers. Saves your modified scene with position offsets and rotations applied directly to the internal buffer.
                  </li>
                  <li>
                    <span className="text-neutral-400 font-medium">Stanford PLY (.ply): </span>
                    Perfect for pipeline tools and software (e.g. Polycam, Luma, Blender, Unity plugins). Transcribes spatial transformation alignments, transparency, spherical harmonics, covariances, and scale dimensions.
                  </li>
                </ul>
              </div>

              {/* Transformations Included */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Active Transformations Preserved
                </h4>
                <div className="space-y-2 mt-2">
                  <p className="text-neutral-400">
                    Unlike ordinary viewers, any edits and spatial changes you make in the viewport are baked directly into your exported file:
                  </p>
                  <div className="bg-neutral-950 p-3 rounded font-mono text-xs text-indigo-400 border border-neutral-900 grid grid-cols-2 gap-x-4 gap-y-2">
                    <div>
                      <span className="text-neutral-500 font-semibold uppercase text-[10px] block">Spatial Translation:</span>
                      X, Y, Z Position (Offsets)
                    </div>
                    <div>
                      <span className="text-neutral-500 font-semibold uppercase text-[10px] block">Spatial Rotation:</span>
                      Yaw, Pitch, Roll (Euler/Quat)
                    </div>
                    <div className="col-span-2 border-t border-neutral-900 pt-2 mt-1">
                      <span className="text-neutral-500 font-semibold uppercase text-[10px] block">Eraser & Selection Bounds:</span>
                      Manual brush strokes and volume/lasso crops are fully omitted from the exported point cloud.
                    </div>
                  </div>
                </div>
              </div>

              {/* Selection Modes */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Refinement Modes
                </h4>
                <div className="space-y-2 mt-2 text-neutral-400">
                  <p>
                    Use the bottom bar tool selectors to crop chunks cleanly:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-neutral-300">
                    <li><span className="font-semibold text-neutral-200">Brush:</span> Paint directly in 3D perspective space to paint selection outlines.</li>
                    <li><span className="font-semibold text-neutral-200">Lasso / Polygon / Rectangle:</span> Trap background scatter inside a 2D lasso region.</li>
                    <li><span className="font-semibold text-neutral-200">Invert/Clear Selection:</span> Rapidly alternate focus to carve out complex structures.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Footer Close Actions */}
            <div className="mt-6 pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setShowEditToolsHelp(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 px-4 py-2 rounded-md text-sm transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsHelp && (
        <div className="fixed inset-0 z-[999999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button
              onClick={() => setShowSettingsHelp(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-800 transition-colors"
              title="Close Guide"
            >
              <X size={16} />
            </button>

            {/* Title */}
            <div className="flex items-center gap-2 text-indigo-400 mb-6 pb-4 border-b border-neutral-800">
              <HelpCircle size={24} />
              <h3 className="font-semibold text-lg text-neutral-100 font-sans">Settings Import/Export Explained</h3>
            </div>

            {/* Explanation Content */}
            <div className="space-y-6 text-sm text-neutral-300 leading-relaxed font-sans">
              <p className="text-neutral-400">
                You can save and restore your entire session layout, calibration configurations, and scene settings into highly serialized <span className="text-neutral-200 font-semibold">JSON settings files</span>.
              </p>

              {/* What is recorded */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  What Parameters Are Exported & Saved:
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs mt-1">
                  <div className="border-r border-neutral-800 pr-2">
                    <span className="font-semibold text-neutral-300 block mb-1">Visual Transformations</span>
                    <ul className="list-disc pl-4 space-y-1 text-neutral-400">
                      <li>Model Scale & pointSize multiplier</li>
                      <li>Rendering Threshold filter values</li>
                      <li>Viewer camera step navigation distance</li>
                    </ul>
                  </div>
                  <div>
                    <span className="font-semibold text-neutral-300 block mb-1">Grid & Guides</span>
                    <ul className="list-disc pl-4 space-y-1 text-neutral-400">
                      <li>Voxel helper grid boundaries limit</li>
                      <li>Grid thickness rendering options</li>
                      <li>Divisions and relative distances parameters</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* What is read */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-indigo-300 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  Calibration & Pin Telemetry Schema:
                </h4>
                <div className="space-y-2 text-xs text-neutral-400">
                  <p>
                    Importing settings recovers all active anchors and geospatial linkages dynamically:
                  </p>
                  <table className="w-full table-fixed border border-neutral-800 bg-neutral-950 text-left rounded-md overflow-hidden">
                    <thead>
                      <tr className="bg-neutral-900 text-neutral-300 text-[10px] uppercase font-mono border-b border-neutral-800">
                        <th className="p-2 w-1/3">Key Category</th>
                        <th className="p-2">Properties Map Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px] text-neutral-400">
                      <tr className="border-b border-neutral-800/40">
                        <td className="p-2 text-indigo-400 font-semibold">pins: []</td>
                        <td className="p-2 text-neutral-300">Name descriptions, categories, active colors, connected linkages, physical X/Y/Z coords, geographic Lat/Lng tags</td>
                      </tr>
                      <tr className="border-b border-neutral-800/40">
                        <td className="p-2 text-indigo-400 font-semibold">wgs84Calibration</td>
                        <td className="p-2 text-neutral-300">High-precision georeferencing anchor coordinate mappings (WGS1, WGS2, elevation layers)</td>
                      </tr>
                      <tr>
                        <td className="p-2 text-indigo-400 font-semibold">source</td>
                        <td className="p-2 text-neutral-300">Splat URL values, active file type reference catalogs</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Behavior Note */}
              <div className="bg-neutral-950/40 p-4 rounded-lg border border-neutral-800/60">
                <h4 className="font-medium text-amber-400 mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Safety Mechanism
                </h4>
                <p className="text-neutral-400 mt-1">
                  When a settings file is read/imported, a confirmation overlay ensures existing setups are not accidentally overwritten. On approval, all calibrated metrics, visual scopes, and geographical coordinates are restored instantly.
                </p>
              </div>
            </div>

            {/* Footer Close Actions */}
            <div className="mt-6 pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setShowSettingsHelp(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 px-4 py-2 rounded-md text-sm transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
