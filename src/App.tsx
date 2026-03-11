import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import Viewer from './components/Viewer';
import Sidebar from './components/Sidebar';
import NotificationContainer, { NotificationItem, NotificationType } from './components/Notification';

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

export type PinFilter = {
  categories: string[];
  matchAll: boolean;
};

export default function App() {
  const [splatUrl, setSplatUrl] = useState<string>('https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat');
  const [splatSource, setSplatSource] = useState<SplatSource>({ type: 'url', value: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat' });
  const [scale, setScale] = useState<number>(1);
  const [pointSize, setPointSize] = useState<number>(1);
  const [threshold, setThreshold] = useState<number>(0.1);
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [splatPosition, setSplatPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [gridSize, setGridSize] = useState<number>(10);
  const [gridDivisions, setGridDivisions] = useState<number>(10);
  const [gridThickness, setGridThickness] = useState<number>(1.0);
  const [points, setPoints] = useState<Point[]>([]);
  const [pinCategories, setPinCategories] = useState<string[]>(['Coral', 'Area']);
  const [pinFilter, setPinFilter] = useState<PinFilter>({ categories: [], matchAll: false });
  const [showPinCategories, setShowPinCategories] = useState<boolean>(false);
  const [renderQuality, setRenderQuality] = useState<'quality' | 'efficacy'>('quality');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [useWASD, setUseWASD] = useState<boolean>(false);
  const [moveSpeed, setMoveSpeed] = useState<number>(5);
  const [viewDistance, setViewDistance] = useState<number>(100);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({ gridSize: true });

  // Calibration State
  const [isCalibrationMode, setIsCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<[number, number, number][]>([]);
  const [recreateProxyTrigger, setRecreateProxyTrigger] = useState(0);
  const [debugProxy, setDebugProxy] = useState(false);

  // Eraser State
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [brushSize, setBrushSize] = useState(0.5);
  const [eraserHistory, setEraserHistory] = useState<number[][]>([]);
  const [erasedIndices, setErasedIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    setIsEraserMode(false);
    setEraserHistory([]);
    setErasedIndices(new Set());
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

  const handleStartCalibration = () => {
    setIsCalibrationMode(true);
    setCalibrationPoints([]);
    addNotification('Calibration Mode: Shift+Click two points to define distance', 'info');
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

  const handleApplyCalibration = (realDistance: number) => {
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

    // Formula: gridSize = (virtualDistance / realDistance) * 0.1 * gridDivisions
    // This ensures 1 cell (gridSize/gridDivisions) = 0.1 meters * (virtual / real)
    // Wait, let's re-verify.
    // Scale Factor S = virtual / real (units per meter)
    // We want cell size to be 0.1 meters.
    // In virtual units, cell size should be 0.1 * S.
    // Cell Size = 0.1 * (virtualDistance / realDistance).
    // Grid Size = Cell Size * gridDivisions.
    // Grid Size = 0.1 * (virtualDistance / realDistance) * gridDivisions.
    
    const newGridSize = (virtualDistance / realDistance) * 0.1 * gridDivisions;
    
    setGridSize(newGridSize);
    setLockedFields(prev => ({ ...prev, gridSize: true }));
    setIsCalibrationMode(false);
    setCalibrationPoints([]);
    addNotification(`Grid calibrated! 1 cell = 10cm`, 'success');
  };


  const handleRecreateProxy = () => {
    setRecreateProxyTrigger(prev => prev + 1);
    addNotification('Recreating proxy mesh...', 'info');
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
      if (settings.transform?.position) setSplatPosition(settings.transform.position);
      if (settings.transform?.rotation) setRotation(settings.transform.rotation);
      if (settings.grid?.size !== undefined) setGridSize(settings.grid.size);
      if (settings.grid?.divisions !== undefined) setGridDivisions(settings.grid.divisions);
      if (settings.grid?.thickness !== undefined) setGridThickness(settings.grid.thickness);
      if (settings.grid?.viewDistance !== undefined) setViewDistance(settings.grid.viewDistance);
      if (settings.navigation?.moveSpeed !== undefined) setMoveSpeed(settings.navigation.moveSpeed);
      if (settings.pins) setPoints(settings.pins);
      if (settings.pinCategories) setPinCategories(settings.pinCategories);
      
      addNotification('Settings imported successfully', 'success');
    } catch (error) {
      addNotification('Failed to import settings', 'error');
      console.error(error);
    }
  };

  return (
    <div className="flex h-screen w-full bg-neutral-900 text-neutral-100 font-sans overflow-hidden select-none">
      <Sidebar
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
        debugProxy={debugProxy}
        setDebugProxy={setDebugProxy}
        onInteractionStart={() => setIsAdjustingSplat(true)}
        onInteractionEnd={() => setIsAdjustingSplat(false)}
        pinCategories={pinCategories}
        setPinCategories={setPinCategories}
        pinFilter={pinFilter}
        setPinFilter={setPinFilter}
        onUpdatePointCategories={handleUpdatePointCategories}
        showPinCategories={showPinCategories}
        setShowPinCategories={setShowPinCategories}
        renderQuality={renderQuality}
        setRenderQuality={setRenderQuality}
        isEraserMode={isEraserMode}
        setIsEraserMode={setIsEraserMode}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        eraserHistory={eraserHistory}
        setEraserHistory={setEraserHistory}
        erasedIndices={erasedIndices}
        setErasedIndices={setErasedIndices}
      />
      <main className="flex-1 relative">
        <Viewer
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
          isCalibrationMode={isCalibrationMode}
          calibrationPoints={calibrationPoints}
          onCalibrationPointClick={handleCalibrationPointClick}
          onUpdateCalibrationPoint={handleUpdateCalibrationPoint}
          recreateProxyTrigger={recreateProxyTrigger}
          debugProxy={debugProxy}
          isAdjustingSplat={isAdjustingSplat}
          pinCategories={pinCategories}
          onUpdatePointCategories={handleUpdatePointCategories}
          showPinCategories={showPinCategories}
          pinFilter={pinFilter}
          renderQuality={renderQuality}
          onDeletePoint={handleDeletePoint}
          isEraserMode={isEraserMode}
          brushSize={brushSize}
          eraserHistory={eraserHistory}
          setEraserHistory={setEraserHistory}
          erasedIndices={erasedIndices}
          setErasedIndices={setErasedIndices}
        />
        <NotificationContainer notifications={notifications} removeNotification={removeNotification} />
      </main>
    </div>
  );
}
