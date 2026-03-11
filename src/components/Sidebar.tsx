import { useState, useEffect } from 'react';
import { Point, SplatSource, PinFilter } from '../App';
import { Trash2, Plus, Upload, Pencil, Lock, Unlock, RotateCcw, Download, FileDown, FileUp, AlertTriangle, Filter, X } from 'lucide-react';
import * as spz from 'spz-js';
import { convertToSplat } from '../utils/splatConverter';
import { NotificationType } from './Notification';

type SidebarProps = {
  splatUrl: string;
  setSplatUrl: (url: string) => void;
  splatSource: SplatSource;
  setSplatSource: (source: SplatSource) => void;
  scale: number;
  setScale: (scale: number) => void;
  pointSize: number;
  setPointSize: (size: number) => void;
  threshold: number;
  setThreshold: (threshold: number) => void;
  rotation: [number, number, number];
  setRotation: (rotation: [number, number, number]) => void;
  splatPosition: [number, number, number];
  setSplatPosition: (position: [number, number, number]) => void;
  gridSize: number;
  setGridSize: (size: number) => void;
  gridDivisions: number;
  setGridDivisions: (divs: number) => void;
  gridThickness: number;
  setGridThickness: (thickness: number) => void;
  points: Point[];
  onAddPoint: () => void;
  onDeletePoint: (id: string) => void;
  onUpdatePoint: (id: string, position: [number, number, number]) => void;
  onUpdatePointName: (id: string, name: string) => void;
  selectedPinId: string | null;
  setSelectedPinId: (id: string | null) => void;
  useWASD: boolean;
  setUseWASD: (useWASD: boolean) => void;
  moveSpeed: number;
  setMoveSpeed: (speed: number) => void;
  viewDistance: number;
  setViewDistance: (distance: number) => void;
  addNotification: (message: string, type: NotificationType) => void;
  onImportSettings: (settings: any) => void;
  lockedFields: Record<string, boolean>;
  onToggleLock: (field: string) => void;
  isCalibrationMode: boolean;
  calibrationPoints: [number, number, number][];
  onStartCalibration: () => void;
  onCancelCalibration: () => void;
  onApplyCalibration: (distance: number) => void;
  onRecreateProxy: () => void;
  debugProxy: boolean;
  setDebugProxy: (debug: boolean) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  pinCategories: string[];
  setPinCategories: (categories: string[]) => void;
  pinFilter: PinFilter;
  setPinFilter: (filter: PinFilter) => void;
  onUpdatePointCategories: (id: string, categories: string[]) => void;
  showPinCategories: boolean;
  setShowPinCategories: (show: boolean) => void;
  renderQuality: 'quality' | 'efficacy';
  setRenderQuality: (quality: 'quality' | 'efficacy') => void;
  isEraserMode: boolean;
  setIsEraserMode: (mode: boolean) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  eraserHistory: number[][];
  setEraserHistory: React.Dispatch<React.SetStateAction<number[][]>>;
  erasedIndices: Set<number>;
  setErasedIndices: React.Dispatch<React.SetStateAction<Set<number>>>;
};

const BufferedInput = ({ 
  value, 
  onCommit, 
  className,
  disabled
}: { 
  value: number; 
  onCommit: (val: number) => void; 
  className?: string;
  disabled?: boolean;
}) => {
  const [localValue, setLocalValue] = useState<string>(value.toString());

  useEffect(() => {
    setLocalValue(value.toFixed(2));
  }, [value]);

  const handleBlur = () => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed)) {
      onCommit(parsed);
    } else {
      setLocalValue(value.toFixed(2));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="number"
      step="0.1"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      disabled={disabled}
    />
  );
};

export default function Sidebar({
  splatUrl,
  setSplatUrl,
  splatSource,
  setSplatSource,
  scale,
  setScale,
  pointSize,
  setPointSize,
  threshold,
  setThreshold,
  rotation,
  setRotation,
  splatPosition,
  setSplatPosition,
  gridSize,
  setGridSize,
  gridDivisions,
  setGridDivisions,
  gridThickness,
  setGridThickness,
  points,
  onAddPoint,
  onDeletePoint,
  onUpdatePoint,
  onUpdatePointName,
  selectedPinId,
  setSelectedPinId,
  useWASD,
  setUseWASD,
  moveSpeed,
  setMoveSpeed,
  viewDistance,
  setViewDistance,
  addNotification,
  onImportSettings,
  lockedFields,
  onToggleLock,
  isCalibrationMode,
  calibrationPoints,
  onStartCalibration,
  onCancelCalibration,
  onApplyCalibration,
  onRecreateProxy,
  debugProxy,
  setDebugProxy,
  onInteractionStart,
  onInteractionEnd,
  pinCategories,
  setPinCategories,
  pinFilter,
  setPinFilter,
  onUpdatePointCategories,
  showPinCategories,
  setShowPinCategories,
  renderQuality,
  setRenderQuality,
  isEraserMode,
  setIsEraserMode,
  brushSize,
  setBrushSize,
  eraserHistory,
  setEraserHistory,
  erasedIndices,
  setErasedIndices,
}: SidebarProps) {
  const [inputUrl, setInputUrl] = useState(splatUrl);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState<string>('');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingImportSettings, setPendingImportSettings] = useState<any>(null);
  const [calibrationDistance, setCalibrationDistance] = useState<string>("1.0");
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [editingCategoriesId, setEditingCategoriesId] = useState<string | null>(null);
  const [exportFileName, setExportFileName] = useState('cleaned_model.splat');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Handle Filter Dropdown
      if (showFilter) {
        const dropdown = document.getElementById('filter-dropdown');
        const toggle = document.getElementById('filter-toggle');
        if (dropdown && !dropdown.contains(target) && toggle && !toggle.contains(target)) {
          setShowFilter(false);
        }
      }

      // Handle Category Dropdown
      if (editingCategoriesId) {
        const dropdown = document.getElementById(`category-dropdown-${editingCategoriesId}`);
        const toggle = document.getElementById(`category-toggle-${editingCategoriesId}`);
        if (dropdown && !dropdown.contains(target) && toggle && !toggle.contains(target)) {
          setEditingCategoriesId(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilter, editingCategoriesId]);

  const isLocked = (field: string) => !!lockedFields[field];

  const toReal = (val: number) => {
    if (gridSize === 0) return "---";
    const realVal = val * gridDivisions / (10 * gridSize);
    return realVal.toFixed(3) + "m";
  };

  const resetField = (field: string, defaultValue: any, setter: (val: any) => void) => {
    if (isLocked(field)) return;
    setter(defaultValue);
    addNotification(`Field ${field} reset`, 'info');
  };

  const resetTransform = () => {
    if (!isLocked('scale')) setScale(1);
    if (!isLocked('pointSize')) setPointSize(1);
    if (!isLocked('threshold')) setThreshold(1);
    if (!isLocked('position')) setSplatPosition([0, 0, 0]);
    if (!isLocked('rotation')) setRotation([0, 0, 0]);
    addNotification('Transform section reset', 'info');
  };

  const resetGrid = () => {
    if (!isLocked('gridSize')) setGridSize(10);
    if (!isLocked('gridDivisions')) setGridDivisions(10);
    if (!isLocked('gridThickness')) setGridThickness(1.0);
    if (!isLocked('viewDistance')) setViewDistance(100);
    addNotification('Grid section reset', 'info');
  };

  const handleExportSettings = () => {
    const settings = {
      source: { 
        splatUrl,
        type: splatSource.type,
        value: splatSource.value
      },
      transform: { scale, pointSize, threshold, position: splatPosition, rotation },
      grid: { size: gridSize, divisions: gridDivisions, viewDistance, thickness: gridThickness },
      navigation: { moveSpeed },
      pins: points.map(p => ({
        ...p,
        realPosition: gridSize > 0 ? {
          x: (p.position[0] * gridDivisions / (10 * gridSize)).toFixed(4),
          y: (p.position[1] * gridDivisions / (10 * gridSize)).toFixed(4),
          z: (p.position[2] * gridDivisions / (10 * gridSize)).toFixed(4),
          unit: 'meters'
        } : null
      })),
      pinCategories
    };
    
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName.trim() ? `${exportFileName.trim()}.json` : 'splat-viewer-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addNotification('Settings exported', 'success');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const settings = JSON.parse(event.target?.result as string);
        setPendingImportSettings(settings);
        setShowImportConfirm(true);
      } catch (error) {
        addNotification('Invalid settings file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const confirmImport = () => {
    if (pendingImportSettings) {
      onImportSettings(pendingImportSettings);
      setExportFileName(''); // Clear export filename on import
      setShowImportConfirm(false);
      setPendingImportSettings(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.splat')) {
        const url = URL.createObjectURL(file);
        setSplatUrl(url);
        setInputUrl(url);
        setSplatSource({ type: 'file', value: file.name });
        setExportFileName(''); // Clear export filename
      } else if (file.name.endsWith('.ply')) {
        const stream = file.stream();
        const result = await spz.loadPly(stream);
        const splatBuffer = convertToSplat(result);
        const blob = new Blob([splatBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setSplatUrl(url);
        setInputUrl(file.name);
        setSplatSource({ type: 'file', value: file.name });
        setExportFileName(''); // Clear export filename
      } else if (file.name.endsWith('.spz')) {
        const buffer = await file.arrayBuffer();
        const result = await spz.loadSpz(new Uint8Array(buffer));
        const splatBuffer = convertToSplat(result);
        const blob = new Blob([splatBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setSplatUrl(url);
        setInputUrl(file.name);
        setSplatSource({ type: 'file', value: file.name });
        setExportFileName(''); // Clear export filename
      } else {
        addNotification('Unsupported file format. Please upload .splat, .ply, or .spz files.', 'error');
      }
    } catch (error) {
      console.error('Error loading file:', error);
      addNotification('Failed to load file. See console for details.', 'error');
    }
  };

  const updateRotation = (axis: 0 | 1 | 2, value: number) => {
    if (isLocked('rotation')) return;
    const newRotation = [...rotation] as [number, number, number];
    newRotation[axis] = (value * Math.PI) / 180; // Convert degrees to radians
    setRotation(newRotation);
  };

  const updatePosition = (index: number, value: number) => {
    if (isLocked('position')) return;
    const newPosition = [...splatPosition] as [number, number, number];
    newPosition[index] = value;
    setSplatPosition(newPosition);
  };

  const updatePointPosition = (id: string, index: number, value: number) => {
    const point = points.find(p => p.id === id);
    if (point) {
      const newPos = [...point.position] as [number, number, number];
      newPos[index] = value;
      onUpdatePoint(id, newPos);
    }
  };

  const handleExportSplat = async () => {
    try {
      addNotification('Preparing export...', 'info');
      
      // Fetch the original splat file
      const response = await fetch(splatUrl);
      const buffer = await response.arrayBuffer();
      
      // A standard .splat file has 32 bytes per splat
      const splatSize = 32;
      const numSplats = buffer.byteLength / splatSize;
      
      // Calculate new size
      const newNumSplats = numSplats - erasedIndices.size;
      const newBuffer = new ArrayBuffer(newNumSplats * splatSize);
      
      const srcView = new Uint8Array(buffer);
      const dstView = new Uint8Array(newBuffer);
      
      let dstIndex = 0;
      for (let i = 0; i < numSplats; i++) {
        if (!erasedIndices.has(i)) {
          // Copy 32 bytes
          const srcOffset = i * splatSize;
          const dstOffset = dstIndex * splatSize;
          dstView.set(srcView.subarray(srcOffset, srcOffset + splatSize), dstOffset);
          dstIndex++;
        }
      }
      
      // Create and download blob
      const blob = new Blob([newBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName || 'cleaned_model.splat';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addNotification(`Exported ${newNumSplats} splats successfully!`, 'success');
    } catch (error) {
      console.error('Error exporting splat:', error);
      addNotification('Failed to export splat file.', 'error');
    }
  };

  return (
    <aside className="w-80 bg-neutral-950 border-r border-neutral-800 flex flex-col overflow-y-auto relative">
      {showImportConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-4 shadow-xl max-w-xs w-full">
            <div className="flex items-center gap-2 text-amber-500 mb-2">
              <AlertTriangle size={20} />
              <h3 className="font-semibold text-neutral-200">Confirm Import</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-4">
              Importing settings will override all current settings and unlock all fields. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowImportConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmImport}
                className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors"
              >
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-4 shadow-xl max-w-xs w-full">
            <div className="flex items-center gap-2 text-amber-500 mb-2">
              <AlertTriangle size={20} />
              <h3 className="font-semibold text-neutral-200">Confirm Reset</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-4">
              Resetting will discard all your eraser edits. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  setEraserHistory([]);
                  setErasedIndices(new Set());
                  setShowResetConfirm(false);
                  addNotification('Eraser edits reset', 'info');
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded transition-colors"
              >
                Reset Splat
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 border-b border-neutral-800">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-100">Splat Viewer</h1>
        <p className="text-sm text-neutral-400 mt-1">Gaussian Splatting in 3D</p>
        <p className="text-xs text-neutral-600 mt-0.5">v0.2</p>
      </div>

      <div className="p-6 space-y-8 flex-1">
        {/* Source Control */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Source</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  className="flex-1 bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                  placeholder="https://..."
                />
                <button 
                  onClick={async () => {
                    try {
                      if (inputUrl.endsWith('.ply')) {
                        const response = await fetch(inputUrl);
                        if (!response.body) throw new Error('No response body');
                        const result = await spz.loadPly(response.body);
                        const splatBuffer = convertToSplat(result);
                        const blob = new Blob([splatBuffer], { type: 'application/octet-stream' });
                        setSplatUrl(URL.createObjectURL(blob));
                      } else if (inputUrl.endsWith('.spz')) {
                        const response = await fetch(inputUrl);
                        const buffer = await response.arrayBuffer();
                        const result = await spz.loadSpz(new Uint8Array(buffer));
                        const splatBuffer = convertToSplat(result);
                        const blob = new Blob([splatBuffer], { type: 'application/octet-stream' });
                        setSplatUrl(URL.createObjectURL(blob));
                      } else {
                        setSplatUrl(inputUrl);
                      }
                      setSplatSource({ type: 'url', value: inputUrl });
                      setExportFileName(''); // Clear export filename
                      addNotification('URL loaded successfully', 'success');
                    } catch (error) {
                      console.error('Error loading URL:', error);
                      addNotification('Failed to load URL', 'error');
                    }
                  }}
                  className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-2 rounded-md text-sm transition-colors border border-neutral-700 whitespace-nowrap"
                >
                  Load
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="file"
                accept=".splat,.ply,.spz"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <button className="w-full flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 py-2 px-4 rounded-md text-sm transition-colors border border-neutral-700">
                <Upload size={16} />
                Upload Local File
              </button>
            </div>
            
            <div className="flex gap-2 mt-2">
              <button 
                onClick={onRecreateProxy}
                className="flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 py-2 px-2 rounded-md text-sm transition-colors border border-neutral-700"
                title="Recreate Proxy Mesh"
              >
                <RotateCcw size={16} />
                Recreate
              </button>
              <button 
                onClick={() => setDebugProxy(!debugProxy)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-2 rounded-md text-sm transition-colors border ${debugProxy ? 'bg-indigo-900/50 border-indigo-500 text-indigo-200' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border-neutral-700'}`}
                title="Toggle Proxy Visibility"
              >
                {debugProxy ? 'Hide Proxy' : 'Show Proxy'}
              </button>
            </div>
            
            <div className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5">
              <label className="text-xs text-neutral-400">Render Mode</label>
              <div className="flex bg-neutral-800 rounded p-0.5">
                <button
                  onClick={() => setRenderQuality('quality')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${renderQuality === 'quality' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-300'}`}
                >
                  Quality
                </button>
                <button
                  onClick={() => setRenderQuality('efficacy')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${renderQuality === 'efficacy' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-300'}`}
                >
                  Efficacy
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Export/Import Setting */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Settings</h2>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Export Filename (Optional)</label>
              <input
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="splat-viewer-settings"
                className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={handleExportSettings}
                className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 py-2 px-3 rounded-md text-xs transition-colors border border-neutral-700"
              >
                <FileDown size={14} />
                Export
              </button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <button className="w-full flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 py-2 px-3 rounded-md text-xs transition-colors border border-neutral-700">
                  <FileUp size={14} />
                  Import
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Navigation Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Navigation</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-neutral-500">WASD Navigation</label>
              <button
                onClick={() => setUseWASD(!useWASD)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useWASD ? 'bg-indigo-500' : 'bg-neutral-700'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useWASD ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
            
            <div className={!useWASD ? 'opacity-50' : ''}>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Speed</label>
                  <button onClick={() => onToggleLock('moveSpeed')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('moveSpeed') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('moveSpeed', 5, setMoveSpeed)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={moveSpeed}
                  onChange={(e) => !isLocked('moveSpeed') && setMoveSpeed(parseFloat(e.target.value) || 0.1)}
                  disabled={!useWASD || isLocked('moveSpeed')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${(!useWASD || isLocked('moveSpeed')) ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0.1"
                max="50"
                step="0.1"
                value={moveSpeed}
                onChange={(e) => !isLocked('moveSpeed') && setMoveSpeed(parseFloat(e.target.value))}
                disabled={!useWASD || isLocked('moveSpeed')}
                className={`w-full accent-indigo-500 ${(!useWASD || isLocked('moveSpeed')) ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>
        </section>

        {/* Transform Controls */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Transform</h2>
            <button 
              onClick={resetTransform}
              className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"
              title="Reset Section"
            >
              <RotateCcw size={12} /> Reset All
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Scale</label>
                  <button onClick={() => onToggleLock('scale')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('scale') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('scale', 1, setScale)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={scale}
                  onChange={(e) => !isLocked('scale') && setScale(parseFloat(e.target.value) || 0.1)}
                  disabled={isLocked('scale')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('scale') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={scale}
                onChange={(e) => !isLocked('scale') && setScale(parseFloat(e.target.value))}
                onMouseDown={onInteractionStart}
                onMouseUp={onInteractionEnd}
                onTouchStart={onInteractionStart}
                onTouchEnd={onInteractionEnd}
                disabled={isLocked('scale')}
                className={`w-full accent-indigo-500 ${isLocked('scale') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Point Size (Alpha)</label>
                  <button onClick={() => onToggleLock('pointSize')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('pointSize') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('pointSize', 1, setPointSize)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value={pointSize}
                  onChange={(e) => !isLocked('pointSize') && setPointSize(Math.min(1, Math.max(0.01, parseFloat(e.target.value) || 0.01)))}
                  disabled={isLocked('pointSize')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('pointSize') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={pointSize}
                onChange={(e) => !isLocked('pointSize') && setPointSize(parseFloat(e.target.value))}
                onMouseDown={onInteractionStart}
                onMouseUp={onInteractionEnd}
                onTouchStart={onInteractionStart}
                onTouchEnd={onInteractionEnd}
                disabled={isLocked('pointSize')}
                className={`w-full accent-indigo-500 ${isLocked('pointSize') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Raycast Threshold</label>
                  <button onClick={() => onToggleLock('threshold')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('threshold') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('threshold', 1, setThreshold)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={threshold}
                  onChange={(e) => !isLocked('threshold') && setThreshold(Math.min(10, Math.max(0.1, parseFloat(e.target.value) || 0.1)))}
                  disabled={isLocked('threshold')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('threshold') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={threshold}
                onChange={(e) => !isLocked('threshold') && setThreshold(parseFloat(e.target.value))}
                onMouseDown={onInteractionStart}
                onMouseUp={onInteractionEnd}
                onTouchStart={onInteractionStart}
                onTouchEnd={onInteractionEnd}
                disabled={isLocked('threshold')}
                className={`w-full accent-indigo-500 ${isLocked('threshold') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-500">Position Offset</label>
                <button onClick={() => onToggleLock('position')} className="text-neutral-600 hover:text-neutral-400">
                  {isLocked('position') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                </button>
                <button onClick={() => resetField('position', [0, 0, 0], setSplatPosition)} className="text-red-500 hover:text-red-400">
                  <RotateCcw size={10} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-400 font-mono">X</span>
                  <BufferedInput
                    value={splatPosition[0]}
                    onCommit={(val) => updatePosition(0, val)}
                    disabled={isLocked('position')}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-green-400 font-mono">Y</span>
                  <BufferedInput
                    value={splatPosition[1]}
                    onCommit={(val) => updatePosition(1, val)}
                    disabled={isLocked('position')}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-blue-400 font-mono">Z</span>
                  <BufferedInput
                    value={splatPosition[2]}
                    onCommit={(val) => updatePosition(2, val)}
                    disabled={isLocked('position')}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-500">Rotation (Degrees)</label>
                <button onClick={() => onToggleLock('rotation')} className="text-neutral-600 hover:text-neutral-400">
                  {isLocked('rotation') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                </button>
                <button onClick={() => resetField('rotation', [0, 0, 0], setRotation)} className="text-red-500 hover:text-red-400">
                  <RotateCcw size={10} />
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400 font-mono w-3">X</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={Math.round((rotation[0] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(0, parseFloat(e.target.value))}
                  onMouseDown={onInteractionStart}
                  onMouseUp={onInteractionEnd}
                  onTouchStart={onInteractionStart}
                  onTouchEnd={onInteractionEnd}
                  disabled={isLocked('rotation')}
                  className={`w-full accent-red-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                <input
                  type="number"
                  value={Math.round((rotation[0] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(0, parseFloat(e.target.value) || 0)}
                  disabled={isLocked('rotation')}
                  className={`w-14 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-red-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-400 font-mono w-3">Y</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={Math.round((rotation[1] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(1, parseFloat(e.target.value))}
                  onMouseDown={onInteractionStart}
                  onMouseUp={onInteractionEnd}
                  onTouchStart={onInteractionStart}
                  onTouchEnd={onInteractionEnd}
                  disabled={isLocked('rotation')}
                  className={`w-full accent-green-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                <input
                  type="number"
                  value={Math.round((rotation[1] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(1, parseFloat(e.target.value) || 0)}
                  disabled={isLocked('rotation')}
                  className={`w-14 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-green-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-400 font-mono w-3">Z</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={Math.round((rotation[2] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(2, parseFloat(e.target.value))}
                  onMouseDown={onInteractionStart}
                  onMouseUp={onInteractionEnd}
                  onTouchStart={onInteractionStart}
                  onTouchEnd={onInteractionEnd}
                  disabled={isLocked('rotation')}
                  className={`w-full accent-blue-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
                <input
                  type="number"
                  value={Math.round((rotation[2] * 180) / Math.PI)}
                  onChange={(e) => updateRotation(2, parseFloat(e.target.value) || 0)}
                  disabled={isLocked('rotation')}
                  className={`w-14 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500 ${isLocked('rotation') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Grid Controls */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Grid</h2>
            <button 
              onClick={resetGrid}
              className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"
              title="Reset Section"
            >
              <RotateCcw size={12} /> Reset All
            </button>
          </div>
          <div className="space-y-3">
            
            {/* Calibration UI */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-md p-3 space-y-2">
              <label className="text-xs font-medium text-neutral-400 block">Calibration (10cm Grid)</label>
              
              {!isCalibrationMode ? (
                <button 
                  onClick={onStartCalibration}
                  disabled={!isLocked('gridSize')}
                  className={`w-full py-1.5 px-3 rounded text-xs transition-colors ${
                    !isLocked('gridSize') 
                      ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                  title={!isLocked('gridSize') ? "Lock grid size to enable calibration" : "Start Calibration"}
                >
                  Start Calibration
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-neutral-300">
                    {calibrationPoints.length === 0 && "Shift+Click 1st point"}
                    {calibrationPoints.length === 1 && "Shift+Click 2nd point"}
                    {calibrationPoints.length === 2 && "Enter distance & Apply"}
                  </div>
                  
                  {calibrationPoints.length === 2 && (
                    <div>
                      <label className="text-[10px] text-neutral-500 block mb-1">Real Distance (meters)</label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          min="0.01" 
                          step="0.01"
                          value={calibrationDistance}
                          onChange={(e) => setCalibrationDistance(e.target.value)}
                          onBlur={() => {
                            const val = parseFloat(calibrationDistance);
                            if (!isNaN(val) && val > 0) {
                              setCalibrationDistance(val.toString());
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = parseFloat(calibrationDistance);
                              if (!isNaN(val) && val > 0) {
                                onApplyCalibration(val);
                              }
                            }
                          }}
                          className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                        />
                        <button 
                          onClick={() => {
                            const val = parseFloat(calibrationDistance);
                            if (!isNaN(val) && val > 0) {
                              onApplyCalibration(val);
                            }
                          }}
                          className="bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={onCancelCalibration}
                    className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 py-1.5 px-3 rounded text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Size (0 = Hidden)</label>
                  <button onClick={() => onToggleLock('gridSize')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('gridSize') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('gridSize', 10, setGridSize)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  value={gridSize}
                  onChange={(e) => !isLocked('gridSize') && setGridSize(parseInt(e.target.value) || 0)}
                  disabled={isLocked('gridSize')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('gridSize') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="1"
                value={gridSize}
                onChange={(e) => !isLocked('gridSize') && setGridSize(parseInt(e.target.value))}
                disabled={isLocked('gridSize')}
                className={`w-full accent-indigo-500 ${isLocked('gridSize') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Grid Thickness</label>
                  <button onClick={() => onToggleLock('gridThickness')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('gridThickness') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('gridThickness', 1.5, setGridThickness)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={gridThickness}
                  onChange={(e) => !isLocked('gridThickness') && setGridThickness(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                  disabled={isLocked('gridThickness')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('gridThickness') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={gridThickness}
                onChange={(e) => !isLocked('gridThickness') && setGridThickness(parseFloat(e.target.value))}
                disabled={isLocked('gridThickness')}
                className={`w-full accent-indigo-500 ${isLocked('gridThickness') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>

            
            <div>
              <div className="flex justify-between mb-1 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-500">Grid View Distance (0 = Hidden)</label>
                  <button onClick={() => onToggleLock('viewDistance')} className="text-neutral-600 hover:text-neutral-400">
                    {isLocked('viewDistance') ? <Lock size={10} className="text-yellow-500" /> : <Unlock size={10} className="text-green-500" />}
                  </button>
                  <button onClick={() => resetField('viewDistance', 100, setViewDistance)} className="text-red-500 hover:text-red-400">
                    <RotateCcw size={10} />
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  step="10"
                  value={viewDistance}
                  onChange={(e) => !isLocked('viewDistance') && setViewDistance(parseInt(e.target.value) || 0)}
                  disabled={isLocked('viewDistance')}
                  className={`w-16 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isLocked('viewDistance') ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <input
                type="range"
                min="0"
                max="1000"
                step="10"
                value={viewDistance}
                onChange={(e) => !isLocked('viewDistance') && setViewDistance(parseInt(e.target.value))}
                disabled={isLocked('viewDistance')}
                className={`w-full accent-indigo-500 ${isLocked('viewDistance') ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>
        </section>

        {/* Pin Category Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Pin Categories</h2>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New Category"
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCategoryName.trim()) {
                    if (!pinCategories.includes(newCategoryName.trim())) {
                      setPinCategories([...pinCategories, newCategoryName.trim()]);
                      setNewCategoryName('');
                    } else {
                      addNotification('Category already exists', 'error');
                    }
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newCategoryName.trim()) {
                    if (!pinCategories.includes(newCategoryName.trim())) {
                      setPinCategories([...pinCategories, newCategoryName.trim()]);
                      setNewCategoryName('');
                    } else {
                      addNotification('Category already exists', 'error');
                    }
                  }
                }}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-2 rounded-md text-sm transition-colors border border-neutral-700"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {pinCategories.map((category) => (
                <div key={category} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5">
                  <span className="text-xs text-neutral-300">{category}</span>
                  <button
                    onClick={() => {
                      setPinCategories(pinCategories.filter(c => c !== category));
                      // Also remove this category from all pins
                      points.forEach(p => {
                        if (p.categories?.includes(category)) {
                          onUpdatePointCategories(p.id, p.categories.filter(c => c !== category));
                        }
                      });
                      // And from filter
                      if (pinFilter.categories.includes(category)) {
                        setPinFilter({ ...pinFilter, categories: pinFilter.categories.filter(c => c !== category) });
                      }
                    }}
                    className="text-neutral-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {pinCategories.length === 0 && (
                <p className="text-xs text-neutral-500 italic">No categories added.</p>
              )}
            </div>
          </div>
        </section>

        {/* Edit Tools */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Edit Tools</h2>
          <div className="bg-neutral-900 border border-neutral-800 rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-300">Eraser Mode</span>
              <button
                onClick={() => setIsEraserMode(!isEraserMode)}
                className={`w-10 h-5 rounded-full relative transition-colors ${isEraserMode ? 'bg-indigo-500' : 'bg-neutral-700'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isEraserMode ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {isEraserMode && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-neutral-400">Brush Size</label>
                  <span className="text-[10px] text-neutral-500 font-mono">{brushSize.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="2"
                  step="0.01"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
            )}

            {isEraserMode && (
              <div className="space-y-2">
                <label className="text-xs text-neutral-400">Export File Name</label>
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(e) => setExportFileName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
                  placeholder="cleaned_model.splat"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={erasedIndices.size === 0}
                className={`flex-1 py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1 ${
                  erasedIndices.size === 0
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
                }`}
              >
                <Trash2 size={12} /> Reset
              </button>

              <button
                onClick={() => {
                  if (eraserHistory.length > 0) {
                    const lastStroke = eraserHistory[eraserHistory.length - 1];
                    setEraserHistory(prev => prev.slice(0, -1));
                    setErasedIndices(prev => {
                      const next = new Set(prev);
                      lastStroke.forEach(idx => next.delete(idx));
                      return next;
                    });
                    addNotification(`Undid ${lastStroke.length} erased splats`, 'info');
                  }
                }}
                disabled={eraserHistory.length === 0}
                className={`flex-1 py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1 ${
                  eraserHistory.length === 0
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
                }`}
              >
                <RotateCcw size={12} /> Undo
              </button>
              
              <button
                onClick={handleExportSplat}
                disabled={erasedIndices.size === 0}
                className={`flex-1 py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1 ${
                  erasedIndices.size === 0
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                }`}
              >
                <Download size={12} /> Export
              </button>
            </div>
          </div>
        </section>

        {/* Points Controls */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Pins</h2>
            <div className="flex gap-2">
              <div className="relative">
                <button
                  id="filter-toggle"
                  onClick={() => setShowFilter(!showFilter)}
                  className={`p-1 rounded transition-colors ${showFilter || pinFilter.categories.length > 0 ? 'bg-indigo-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
                  title="Filter Pins"
                >
                  <Filter size={16} />
                </button>
                {showFilter && (
                  <div id="filter-dropdown" className="absolute right-0 top-full mt-2 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 p-2">
                    <div className="text-xs font-medium text-neutral-400 mb-2 px-1">Filter by Category</div>
                    <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
                      {pinCategories.map(cat => (
                        <label key={cat} className="flex items-center gap-2 px-1 py-0.5 hover:bg-neutral-800 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pinFilter.categories.includes(cat)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPinFilter({ ...pinFilter, categories: [...pinFilter.categories, cat] });
                              } else {
                                setPinFilter({ ...pinFilter, categories: pinFilter.categories.filter(c => c !== cat) });
                              }
                            }}
                            className="rounded border-neutral-700 bg-neutral-800 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs text-neutral-200">{cat}</span>
                        </label>
                      ))}
                      {pinCategories.length === 0 && <div className="text-xs text-neutral-500 px-1">No categories defined</div>}
                    </div>
                    {pinCategories.length > 0 && (
                      <div className="border-t border-neutral-800 pt-2">
                        <label className="flex items-center gap-2 px-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pinFilter.matchAll}
                            onChange={(e) => setPinFilter({ ...pinFilter, matchAll: e.target.checked })}
                            className="rounded border-neutral-700 bg-neutral-800 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs text-neutral-400">Match All Selected</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={onAddPoint}
                className="p-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                title="Add Pin"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center justify-between px-1">
            <label className="text-xs text-neutral-500 flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showPinCategories} 
                onChange={(e) => setShowPinCategories(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-800 text-indigo-600 focus:ring-indigo-500"
              />
              Show Categories on Pins
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-neutral-500 flex justify-between">
               <span>
                 {pinFilter.categories.length > 0 
                   ? `Showing ${points.filter(p => {
                        if (pinFilter.categories.length === 0) return true;
                        const pointCats = p.categories || [];
                        if (pinFilter.matchAll) {
                          return pinFilter.categories.every(c => pointCats.includes(c));
                        } else {
                          return pinFilter.categories.some(c => pointCats.includes(c));
                        }
                      }).length} of ${points.length} pins`
                   : `${points.length} pins created`
                 }
               </span>
               {pinFilter.categories.length > 0 && (
                 <button 
                   onClick={() => setPinFilter({ categories: [], matchAll: false })}
                   className="text-indigo-400 hover:text-indigo-300"
                 >
                   Clear Filter
                 </button>
               )}
            </div>

            {points.filter(p => {
                if (pinFilter.categories.length === 0) return true;
                const pointCats = p.categories || [];
                if (pinFilter.matchAll) {
                  return pinFilter.categories.every(c => pointCats.includes(c));
                } else {
                  return pinFilter.categories.some(c => pointCats.includes(c));
                }
              }).length === 0 ? (
              <p className="text-xs text-neutral-500 italic">No pins found.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {points.filter(p => {
                    if (pinFilter.categories.length === 0) return true;
                    const pointCats = p.categories || [];
                    if (pinFilter.matchAll) {
                      return pinFilter.categories.every(c => pointCats.includes(c));
                    } else {
                      return pinFilter.categories.some(c => pointCats.includes(c));
                    }
                  }).map((point, index) => (
                  <div 
                    key={point.id} 
                    className={`border rounded p-2 flex flex-col gap-2 transition-colors ${selectedPinId === point.id ? 'bg-neutral-800 border-indigo-500/50' : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'}`}
                    onClick={() => setSelectedPinId(point.id)}
                  >
                    <div className="flex items-center justify-between">
                      {editingNameId === point.id ? (
                        <input
                          type="text"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onBlur={() => {
                            onUpdatePointName(point.id, tempName);
                            setEditingNameId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onUpdatePointName(point.id, tempName);
                              setEditingNameId(null);
                            }
                          }}
                          autoFocus
                          className="text-xs font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 w-full mr-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="flex items-center gap-1 flex-1 min-w-0 mr-2">
                          <span className="text-xs font-medium text-neutral-300 truncate">
                            {point.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNameId(point.id);
                              setTempName(point.name);
                            }}
                            className="text-neutral-500 hover:text-indigo-400 transition-colors p-1"
                            title="Rename"
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePoint(point.id);
                        }}
                        className="text-neutral-500 hover:text-red-400 transition-colors p-1 shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Categories Row */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {point.categories?.map(cat => (
                        <button
                          key={cat}
                          onClick={(e) => {
                            e.stopPropagation();
                            const currentCats = point.categories || [];
                            onUpdatePointCategories(point.id, currentCats.filter(c => c !== cat));
                          }}
                          className="flex items-center gap-1 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-300 px-1.5 py-0.5 rounded border border-neutral-700 transition-colors"
                          title={`Remove ${cat}`}
                        >
                          {cat}
                          <X size={8} />
                        </button>
                      ))}
                      <div className="relative">
                        <button
                          id={`category-toggle-${point.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategoriesId(editingCategoriesId === point.id ? null : point.id);
                          }}
                          className="text-[10px] text-neutral-500 hover:text-neutral-300 px-1 py-0.5 border border-neutral-800 rounded hover:border-neutral-700"
                        >
                          + Cat
                        </button>
                        {editingCategoriesId === point.id && (
                          <div id={`category-dropdown-${point.id}`} className="absolute left-0 top-full mt-1 w-32 bg-neutral-900 border border-neutral-700 rounded shadow-xl z-10 p-1">
                            {pinCategories.map(cat => (
                              <button
                                key={cat}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const currentCats = point.categories || [];
                                  const newCats = currentCats.includes(cat)
                                    ? currentCats.filter(c => c !== cat)
                                    : [...currentCats, cat];
                                  onUpdatePointCategories(point.id, newCats);
                                  setEditingCategoriesId(null);
                                }}
                                className={`w-full text-left text-[10px] px-2 py-1 rounded hover:bg-neutral-800 ${point.categories?.includes(cat) ? 'text-indigo-400' : 'text-neutral-400'}`}
                              >
                                {cat} {point.categories?.includes(cat) && '✓'}
                              </button>
                            ))}
                            {pinCategories.length === 0 && <div className="text-[10px] text-neutral-500 px-2 py-1">No categories</div>}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-red-400 font-mono mb-0.5">X</span>
                        <BufferedInput
                          value={point.position[0]}
                          onCommit={(val) => updatePointPosition(point.id, 0, val)}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-green-400 font-mono mb-0.5">Y</span>
                        <BufferedInput
                          value={point.position[1]}
                          onCommit={(val) => updatePointPosition(point.id, 1, val)}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-blue-400 font-mono mb-0.5">Z</span>
                        <BufferedInput
                          value={point.position[2]}
                          onCommit={(val) => updatePointPosition(point.id, 2, val)}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded px-1 py-0.5 text-xs text-right text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-1 pt-1 border-t border-neutral-800">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-neutral-500 font-mono">Real X</span>
                        <span className="text-[10px] text-neutral-300 font-mono text-right">{toReal(point.position[0])}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] text-neutral-500 font-mono">Real Y</span>
                        <span className="text-[10px] text-neutral-300 font-mono text-right">{toReal(point.position[1])}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] text-neutral-500 font-mono">Real Z</span>
                        <span className="text-[10px] text-neutral-300 font-mono text-right">{toReal(point.position[2])}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
