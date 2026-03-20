import React, { useState, useRef, useEffect } from 'react';
import { X, Link, GripHorizontal } from 'lucide-react';
import type { Point, PinFilter, PinCategory } from '../App';

interface WidgetPanelProps {
  points: Point[];
  pinFilter: PinFilter;
  pinCategories: PinCategory[];
  showFullCategories: boolean;
  connectedPinIds: string[];
  setConnectedPinIds: React.Dispatch<React.SetStateAction<string[]>>;
  connectionLineColor: string;
  setConnectionLineColor: React.Dispatch<React.SetStateAction<string>>;
}

export default function WidgetPanel({
  points,
  pinFilter,
  pinCategories,
  showFullCategories,
  connectedPinIds,
  setConnectedPinIds,
  connectionLineColor,
  setConnectionLineColor,
}: WidgetPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Panel dragging state
  const [position, setPosition] = useState({ x: 0, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const panelStartPos = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Set initial position on mount (near the top-left widget icon)
    setPosition({ x: 80, y: 24 });
  }, []);

  const handlePanelPointerDown = (e: React.PointerEvent) => {
    // Only start dragging if left mouse button is pressed
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
    
    // Use the parent container's dimensions to avoid dragging out of the main area
    const parent = panelRef.current?.parentElement;
    const containerWidth = parent ? parent.clientWidth : document.documentElement.clientWidth;
    const containerHeight = parent ? parent.clientHeight : document.documentElement.clientHeight;
    
    const maxX = Math.max(0, containerWidth - 400);
    const maxY = Math.max(0, containerHeight - 400);
    
    const newX = Math.max(0, Math.min(maxX, panelStartPos.current.x + dx));
    const newY = Math.max(0, Math.min(maxY, panelStartPos.current.y + dy));
    
    setPosition({
      x: newX,
      y: newY,
    });
  };

  const handlePanelPointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Filter existing pins based on pinFilter
  const filteredPoints = points.filter((point) => {
    if (pinFilter.categories.length === 0) return true;
    if (!point.categories || point.categories.length === 0) return false;

    const hasCategoryOrSub = (filterCat: string) => {
      if (point.categories?.includes(filterCat)) return true;
      const parentCat = pinCategories.find(c => c.name === filterCat);
      if (parentCat) {
        return parentCat.subcategories.some(sub => point.categories?.includes(`${parentCat.name}-${sub}`));
      }
      return false;
    };

    if (pinFilter.matchAll) {
      return pinFilter.categories.every(hasCategoryOrSub);
    } else {
      return pinFilter.categories.some(hasCategoryOrSub);
    }
  });

  const handleDragStart = (e: React.DragEvent, pinId: string, index?: number) => {
    e.dataTransfer.setData('text/plain', pinId);
    if (index !== undefined) {
      e.dataTransfer.setData('source/index', index.toString());
      setDraggedIndex(index);
    }
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropToConnected = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pinId = e.dataTransfer.getData('text/plain');
    const sourceIndexStr = e.dataTransfer.getData('source/index');
    
    if (pinId) {
      if (sourceIndexStr !== '') {
        // Reordering within the list is handled by handleDragEnter on individual items
      } else if (!connectedPinIds.includes(pinId)) {
        // New item from existing pins
        setConnectedPinIds((prev) => [...prev, pinId]);
      }
    }
    setDraggedIndex(null);
  };

  const handleDragEnterConnectedItem = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    
    setConnectedPinIds((prev) => {
      const newIds = [...prev];
      const draggedId = newIds[draggedIndex];
      newIds.splice(draggedIndex, 1);
      newIds.splice(targetIndex, 0, draggedId);
      return newIds;
    });
    setDraggedIndex(targetIndex);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleDragOverRemove = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropToRemove = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIndexStr = e.dataTransfer.getData('source/index');
    // Only remove if it came from the connected list
    if (sourceIndexStr !== '') {
      const pinId = e.dataTransfer.getData('text/plain');
      if (pinId) {
        setConnectedPinIds((prev) => prev.filter((id) => id !== pinId));
      }
    }
    setDraggedIndex(null);
  };

  if (!isExpanded) {
    return (
      <div className="absolute top-6 left-6 z-50 flex flex-col gap-2">
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 p-3 rounded-full shadow-lg border border-neutral-700 transition-colors flex items-center justify-center"
          title="Open Connection Widget"
        >
          <Link size={20} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[400px] h-[400px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{ left: position.x, top: position.y }}
      onDragOver={handleDragOverRemove}
      onDrop={handleDropToRemove}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between bg-neutral-800 px-3 py-2 border-b border-neutral-700 cursor-move"
        onPointerDown={handlePanelPointerDown}
        onPointerMove={handlePanelPointerMove}
        onPointerUp={handlePanelPointerUp}
      >
        <div className="flex items-center gap-2 text-neutral-300 pointer-events-none">
          <Link size={16} />
          <span className="text-sm font-medium">Connection</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-4 gap-4 min-h-0" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between shrink-0">
          <label className="text-xs text-neutral-400">Line Color</label>
          <input
            type="color"
            value={connectionLineColor}
            onChange={(e) => setConnectionLineColor(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer border-0 p-0"
          />
        </div>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Existing Pins Column */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider shrink-0">Existing Pins</h3>
            <div className="flex-1 overflow-y-auto bg-neutral-950/50 rounded border border-neutral-800 p-2 flex flex-col gap-1">
              {filteredPoints.length === 0 ? (
                <div className="text-xs text-neutral-600 italic text-center py-4">No pins match filter</div>
              ) : (
                filteredPoints.map((point) => (
                  <div
                    key={point.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, point.id)}
                    className="text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded px-2 py-1.5 cursor-grab active:cursor-grabbing shrink-0 flex flex-col gap-1"
                    title={point.name}
                  >
                    <div className="truncate font-medium">{point.name}</div>
                    {point.categories && point.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {point.categories.map(cat => (
                          <span key={cat} className="text-[9px] bg-neutral-900 text-neutral-400 px-1 rounded border border-neutral-700 truncate max-w-full">
                            {showFullCategories ? cat : (cat.split('-').length > 1 ? cat.split('-').slice(1).join('-') : cat)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* To-be-connected Pins Column */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider shrink-0">To-be-connected</h3>
            <div
              className="flex-1 overflow-y-auto bg-neutral-950/50 rounded border border-neutral-800 p-2 flex flex-col gap-1"
              onDragOver={handleDragOver}
              onDrop={handleDropToConnected}
            >
              {connectedPinIds.length === 0 ? (
                <div className="text-xs text-neutral-600 italic text-center py-4">Drag pins here</div>
              ) : (
                connectedPinIds.map((id, index) => {
                  const point = points.find((p) => p.id === id);
                  if (!point) return null;
                  return (
                    <div
                      key={`${id}-${index}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, id, index)}
                      onDragEnter={(e) => handleDragEnterConnectedItem(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`text-xs bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-700/50 rounded px-2 py-1.5 cursor-grab active:cursor-grabbing flex flex-col gap-1 shrink-0 ${draggedIndex === index ? 'opacity-50' : ''}`}
                      title={point.name}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-indigo-400 font-mono opacity-50 shrink-0">{index + 1}.</span>
                        <span className="truncate font-medium">{point.name}</span>
                      </div>
                      {point.categories && point.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-5">
                          {point.categories.map(cat => (
                            <span key={cat} className="text-[9px] bg-indigo-950/50 text-indigo-300/70 px-1 rounded border border-indigo-800/50 truncate max-w-full">
                              {showFullCategories ? cat : (cat.split('-').length > 1 ? cat.split('-').slice(1).join('-') : cat)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-neutral-500 text-center italic shrink-0">
          Drag pins away from the list to remove them.
        </div>
      </div>
    </div>
  );
}
