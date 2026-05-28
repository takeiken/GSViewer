import React, { useState, useRef, useEffect } from 'react';
import { X, Box, Plus, Trash2, Edit2, Check, RotateCw, Eye, EyeOff } from 'lucide-react';

export interface Boundary {
  id: string;
  name: string;
  center: [number, number, number]; // [X, Y, Z]
  size: number; // in meters (side length of square)
  rotation: number; // in degrees (0 - 360)
  color?: string; // hex color
  visible?: boolean; // visibility
}

interface BoundaryBoxPanelProps {
  boundaries: Boundary[];
  setBoundaries: React.Dispatch<React.SetStateAction<Boundary[]>>;
  selectedBoundaryId: string | null;
  setSelectedBoundaryId: (id: string | null) => void;
  isPlacingBoundary: boolean;
  setIsPlacingBoundary: (val: boolean) => void;
  isExpanded: boolean;
  setIsExpanded: (val: boolean) => void;
  boundariesOpacity: number;
  setBoundariesOpacity: (val: number) => void;
}

const PRESET_COLORS = [
  { value: '#a78bfa', name: 'Violet' },
  { value: '#34d399', name: 'Emerald' },
  { value: '#fbbf24', name: 'Amber' },
  { value: '#f43f5e', name: 'Rose' },
  { value: '#38bdf8', name: 'Sky' },
];

function BoundaryRow({
  boundary,
  isSelected,
  setSelectedBoundaryId,
  editingId,
  setEditingId,
  editingName,
  setEditingName,
  handleSaveRename,
  handleStartRename,
  handleDelete,
  setBoundaries
}: {
  boundary: Boundary;
  isSelected: boolean;
  setSelectedBoundaryId: (id: string | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editingName: string;
  setEditingName: (val: string) => void;
  handleSaveRename: (id: string) => void;
  handleStartRename: (boundary: Boundary, e: React.MouseEvent) => void;
  handleDelete: (id: string, e: React.MouseEvent) => void;
  setBoundaries: React.Dispatch<React.SetStateAction<Boundary[]>>;
}) {
  const isEditing = editingId === boundary.id;
  const colorValue = boundary.color || '#a78bfa';
  const isVisible = boundary.visible !== false;

  // Local string inputs for decimals without forcing prefilled 0
  const [localSizeStr, setLocalSizeStr] = useState(boundary.size.toString());
  const [localRotStr, setLocalRotStr] = useState(boundary.rotation.toString());

  useEffect(() => {
    if (document.activeElement?.id !== `size-input-${boundary.id}`) {
      setLocalSizeStr(boundary.size.toString());
    }
  }, [boundary.size, boundary.id]);

  useEffect(() => {
    if (document.activeElement?.id !== `rot-input-${boundary.id}`) {
      setLocalRotStr(boundary.rotation.toString());
    }
  }, [boundary.rotation, boundary.id]);

  const handleSizeChange = (str: string) => {
    setLocalSizeStr(str);
    const parsed = parseFloat(str);
    if (!isNaN(parsed) && parsed > 0) {
      setBoundaries((prev) =>
        prev.map((b) => (b.id === boundary.id ? { ...b, size: Math.max(0.1, parsed) } : b))
      );
    }
  };

  const handleSizeBlur = () => {
    const parsed = parseFloat(localSizeStr);
    if (isNaN(parsed) || parsed <= 0) {
      setLocalSizeStr(boundary.size.toString());
    } else {
      const clamped = Math.max(0.1, parsed);
      setLocalSizeStr(clamped.toString());
      setBoundaries((prev) =>
        prev.map((b) => (b.id === boundary.id ? { ...b, size: clamped } : b))
      );
    }
  };

  const handleRotChange = (str: string) => {
    setLocalRotStr(str);
    const parsed = parseFloat(str);
    if (!isNaN(parsed)) {
      const wrapped = ((parsed % 360) + 360) % 360;
      setBoundaries((prev) =>
        prev.map((b) => (b.id === boundary.id ? { ...b, rotation: wrapped } : b))
      );
    }
  };

  const handleRotBlur = () => {
    const parsed = parseFloat(localRotStr);
    if (isNaN(parsed)) {
      setLocalRotStr(boundary.rotation.toString());
    } else {
      const wrapped = ((parsed % 360) + 360) % 360;
      setLocalRotStr(wrapped.toString());
      setBoundaries((prev) =>
        prev.map((b) => (b.id === boundary.id ? { ...b, rotation: wrapped } : b))
      );
    }
  };

  const toggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBoundaries((prev) =>
      prev.map((b) => (b.id === boundary.id ? { ...b, visible: !isVisible } : b))
    );
  };

  const selectColor = (colorHex: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBoundaries((prev) =>
      prev.map((b) => (b.id === boundary.id ? { ...b, color: colorHex } : b))
    );
  };

  return (
    <div
      onClick={() => setSelectedBoundaryId(isSelected ? null : boundary.id)}
      className={`group border rounded-lg p-2.5 transition-all text-xs cursor-pointer ${
        isSelected
          ? 'bg-indigo-950/20 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/20'
          : 'bg-neutral-950/40 border-neutral-800 hover:border-neutral-700'
      }`}
    >
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2 flex-1 min-w-0 mr-1">
          {/* Color circular tag */}
          <span 
            className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/30 shadow-sm"
            style={{ backgroundColor: colorValue }}
          ></span>

          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename(boundary.id);
                }}
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-xs text-white uppercase focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                autoFocus
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveRename(boundary.id);
                }}
                className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white shrink-0"
              >
                <Check size={11} />
              </button>
            </div>
          ) : (
            <div className="font-mono text-neutral-200 flex items-center gap-1.5 flex-1 min-w-0 font-medium select-text">
              <span className="truncate">{boundary.name}</span>
              <button
                onClick={(e) => handleStartRename(boundary, e)}
                className="opacity-0 group-hover:opacity-100 hover:text-white text-neutral-400 p-0.5 transition-all focus:opacity-100 focus:outline-none shrink-0"
                title="Rename boundary"
              >
                <Edit2 size={10} />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Visibility eye toggle button */}
          <button
            onClick={toggleVisibility}
            className={`p-1 rounded hover:bg-neutral-800 transition-colors ${
              isVisible ? 'text-neutral-400 hover:text-neutral-100' : 'text-neutral-600 hover:text-neutral-300'
            }`}
            title={isVisible ? 'Hide boundary' : 'Show boundary'}
          >
            {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          {/* Delete action button */}
          <button
            onClick={(e) => handleDelete(boundary.id, e)}
            className="text-neutral-500 hover:text-red-400 p-1 rounded hover:bg-neutral-800 transition-colors"
            title="Remove"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Inputs panel shown in active state */}
      {isSelected && (
        <div className="space-y-2.5 mt-2.5 pt-2 border-t border-neutral-800/60 transition-all duration-200">
          {/* Color Picker dots grid */}
          <div className="flex items-center justify-between pb-1">
            <span className="text-[9px] text-neutral-500 font-mono uppercase">Color Option</span>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {PRESET_COLORS.map((preset) => {
                const isColorSelected = colorValue.toLowerCase() === preset.value.toLowerCase();
                return (
                  <button
                    key={preset.value}
                    onClick={(e) => selectColor(preset.value, e)}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-150 relative ${
                      isColorSelected ? 'ring-1.5 ring-offset-1 ring-offset-neutral-900 ring-white scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: preset.value }}
                    title={preset.name}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-[9px] text-neutral-500 font-mono uppercase">Size (meters)</span>
              <input
                id={`size-input-${boundary.id}`}
                type="text"
                inputMode="decimal"
                value={localSizeStr}
                onChange={(e) => handleSizeChange(e.target.value)}
                onBlur={handleSizeBlur}
                className="w-full bg-neutral-950 border border-neutral-850 rounded px-1.5 py-0.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 text-indigo-300 pointer-events-auto"
                placeholder="0.5"
              />
            </div>
            <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-[9px] text-neutral-500 font-mono uppercase flex items-center gap-0.5">
                <RotateCw size={8} /> Angle (deg)
              </span>
              <input
                id={`rot-input-${boundary.id}`}
                type="text"
                inputMode="decimal"
                value={localRotStr}
                onChange={(e) => handleRotChange(e.target.value)}
                onBlur={handleRotBlur}
                className="w-full bg-neutral-950 border border-neutral-850 rounded px-1.5 py-0.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 text-indigo-300 pointer-events-auto"
                placeholder="0"
              />
            </div>
          </div>

          {/* Coordinate readings */}
          <div className="pt-1.5 border-t border-neutral-850/40 grid grid-cols-3 text-[9px] text-neutral-500 font-mono uppercase">
            <div>X: {boundary.center[0].toFixed(2)}</div>
            <div>Y: {boundary.center[1].toFixed(2)}</div>
            <div>Z: {boundary.center[2].toFixed(2)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BoundaryBoxPanel({
  boundaries,
  setBoundaries,
  selectedBoundaryId,
  setSelectedBoundaryId,
  isPlacingBoundary,
  setIsPlacingBoundary,
  isExpanded,
  setIsExpanded,
  boundariesOpacity,
  setBoundariesOpacity,
}: BoundaryBoxPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Panel drag position (placed nicely below layers widget position)
  const [position, setPosition] = useState({ x: 80, y: 140 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const panelStartPos = useRef({ x: 0, y: 0 });

  const handlePanelPointerDown = (e: React.PointerEvent) => {
    if (e.target && (e.target as HTMLElement).closest('button, input, select')) return;
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    panelStartPos.current = { ...position };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePanelPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;

    const parent = panelRef.current?.parentElement;
    const containerWidth = parent ? parent.clientWidth : document.documentElement.clientWidth;
    const containerHeight = parent ? parent.clientHeight : document.documentElement.clientHeight;

    const maxX = Math.max(0, containerWidth - 300);
    const maxY = Math.max(0, containerHeight - 300);

    const newX = Math.max(0, Math.min(maxX, panelStartPos.current.x + dx));
    const newY = Math.max(0, Math.min(maxY, panelStartPos.current.y + dy));

    setPosition({ x: newX, y: newY });
  };

  const handlePanelPointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleAddClick = () => {
    setIsPlacingBoundary(true);
    setSelectedBoundaryId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBoundaries((prev) => prev.filter((b) => b.id !== id));
    if (selectedBoundaryId === id) {
      setSelectedBoundaryId(null);
    }
  };

  const handleStartRename = (boundary: Boundary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(boundary.id);
    setEditingName(boundary.name);
  };

  const handleSaveRename = (id: string) => {
    if (editingName.trim() !== "") {
      setBoundaries((prev) =>
        prev.map((b) => (b.id === id ? { ...b, name: editingName.trim() } : b))
      );
    }
    setEditingId(null);
  };

  // Master show/hide visibility toggle
  const allVisible = boundaries.length > 0 && boundaries.every((b) => b.visible !== false);
  const handleToggleAllVisible = () => {
    setBoundaries((prev) =>
      prev.map((b) => ({ ...b, visible: !allVisible }))
    );
  };

  const handleClose = () => {
    setIsExpanded(false);
    setSelectedBoundaryId(null); // Deselect the boundary after closing the boundary widget
  };

  if (!isExpanded) return null;

  return (
    <div
      id="boundary-box-widget-panel"
      ref={panelRef}
      className="absolute z-50 w-[350px] bg-neutral-900 border border-neutral-750 rounded-lg shadow-2xl flex flex-col overflow-hidden text-neutral-200"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between bg-neutral-800 px-3 py-2 border-b border-neutral-700 cursor-move shrink-0"
        onPointerDown={handlePanelPointerDown}
        onPointerMove={handlePanelPointerMove}
        onPointerUp={handlePanelPointerUp}
      >
        <div className="flex items-center gap-2 text-neutral-300 pointer-events-none">
          <Box size={16} className="text-indigo-400" />
          <span className="text-sm font-medium">Boundary Box Panel</span>
        </div>
        <button
          onClick={handleClose}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-3.5 max-h-[480px] overflow-y-auto shrink-0 select-none pb-4" onPointerDown={(e) => e.stopPropagation()}>
        
        {/* Opacity slider inside widget */}
        <div className="bg-neutral-950/40 border border-neutral-800/80 rounded-lg p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex justify-between items-center text-[10px] font-mono uppercase text-neutral-400">
            <span>Walls Opacity</span>
            <span className="text-indigo-400 font-semibold">{Math.round(boundariesOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={boundariesOpacity}
            onChange={(e) => setBoundariesOpacity(parseFloat(e.target.value))}
            className="w-full accent-indigo-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Master toggles row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-400 uppercase font-mono tracking-wider">Boundaries ({boundaries.length})</span>
            {boundaries.length > 0 && (
              <button
                onClick={handleToggleAllVisible}
                className="text-[9px] text-neutral-400 hover:text-indigo-400 font-mono flex items-center gap-1 px-1.5 py-0.5 rounded border border-neutral-800 bg-neutral-950/20 hover:bg-neutral-850/50 transition-all select-none"
                title={allVisible ? "Hide all boundaries" : "Show all boundaries"}
              >
                {allVisible ? <Eye size={10} /> : <EyeOff size={10} />}
                <span>{allVisible ? 'Hide All' : 'Show All'}</span>
              </button>
            )}
          </div>
          
          <button
            onClick={handleAddClick}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-all font-medium ${
              isPlacingBoundary
                ? 'bg-amber-600/80 text-white cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md active:scale-95'
            }`}
            disabled={isPlacingBoundary}
            title="Splat placement"
          >
            <Plus size={14} />
            {isPlacingBoundary ? 'Click Viewport...' : 'Add Boundary'}
          </button>
        </div>

        {isPlacingBoundary && (
          <div className="bg-amber-950/20 border border-amber-800/40 rounded p-2 text-[11px] text-amber-300 font-mono leading-relaxed animate-pulse">
            <div>📍 Action Active:</div>
            <div>Shift + Click inside the viewport to set the boundary's center point.</div>
          </div>
        )}

        <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-0.5 scrollbar-thin">
          {boundaries.length === 0 ? (
            <div className="text-xs text-neutral-500 text-center py-6 italic border border-dashed border-neutral-800 rounded">
              No boundary boxes added yet.
            </div>
          ) : (
            boundaries.map((boundary) => (
              <BoundaryRow
                key={boundary.id}
                boundary={boundary}
                isSelected={selectedBoundaryId === boundary.id}
                setSelectedBoundaryId={setSelectedBoundaryId}
                editingId={editingId}
                setEditingId={setEditingId}
                editingName={editingName}
                setEditingName={setEditingName}
                handleSaveRename={handleSaveRename}
                handleStartRename={handleStartRename}
                handleDelete={handleDelete}
                setBoundaries={setBoundaries}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
