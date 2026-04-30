import React, { useState } from 'react';
import { MousePointer2, Square, PenTool, Hexagon, Eraser, Move, Scissors, MousePointerClick, ChevronDown, ChevronUp } from 'lucide-react';

interface SelectionWidgetProps {
  selectionMode: 'rect' | 'lasso' | 'polygon' | 'brush' | null;
  setSelectionMode: (mode: 'rect' | 'lasso' | 'polygon' | 'brush' | null) => void;
  selectionPenetrate: boolean;
  setSelectionPenetrate: (val: boolean) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  onEraseSelected: () => void;
  onInvertSelection: () => void;
  onClearSelection: () => void;
  onAutoTile: () => void;
  hasSelection: boolean;
  isProcessing?: boolean;
}

export default function SelectionWidget({
  selectionMode,
  setSelectionMode,
  selectionPenetrate,
  setSelectionPenetrate,
  brushSize,
  setBrushSize,
  onEraseSelected,
  onInvertSelection,
  onClearSelection,
  onAutoTile,
  hasSelection,
  isProcessing = false
}: SelectionWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none">
      <div 
        className={`bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex items-center overflow-hidden transition-all duration-300 pointer-events-auto ${isExpanded ? 'opacity-100 mb-3' : 'opacity-0 h-0 w-0 mb-0'}`}
      >
        <div className="flex items-center p-2 space-x-4">
          {/* Tools */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setSelectionMode(null)}
              className={`p-2 rounded flex items-center justify-center transition-colors ${selectionMode === null ? 'bg-indigo-600/50 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}
              title="Move / View (No Selection Tool)"
            >
              <Move size={16} />
            </button>
            <button
              onClick={() => setSelectionMode('rect')}
              className={`p-2 rounded flex items-center justify-center transition-colors ${selectionMode === 'rect' ? 'bg-indigo-600/50 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}
              title="Rect Select"
            >
              <Square size={16} />
            </button>
            <button
              onClick={() => setSelectionMode('lasso')}
              className={`p-2 rounded flex items-center justify-center transition-colors ${selectionMode === 'lasso' ? 'bg-indigo-600/50 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}
              title="Lasso Select"
            >
              <PenTool size={16} />
            </button>
            <button
              onClick={() => setSelectionMode('polygon')}
              className={`p-2 rounded flex items-center justify-center transition-colors ${selectionMode === 'polygon' ? 'bg-indigo-600/50 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}
              title="Polygon Select"
            >
              <Hexagon size={16} />
            </button>
            <button
              onClick={() => setSelectionMode('brush')}
              className={`p-2 rounded flex items-center justify-center transition-colors ${selectionMode === 'brush' ? 'bg-indigo-600/50 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}
              title="Brush Select"
            >
              <MousePointerClick size={16} />
            </button>
          </div>

          <div className="w-px h-6 bg-neutral-700"></div>

          {/* Options */}
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer text-xs text-neutral-300" title="Select through volume instead of just surface">
              <span>Penetrate</span>
              <button
                onClick={() => setSelectionPenetrate(!selectionPenetrate)}
                className={`w-8 h-4 rounded-full relative transition-colors ${selectionPenetrate ? 'bg-indigo-500' : 'bg-neutral-700'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${selectionPenetrate ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
              </button>
            </label>
            
            {selectionMode === 'brush' && (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-neutral-400">Size</span>
                <input
                  type="range"
                  min="0.01"
                  max="2"
                  step="0.01"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseFloat(e.target.value))}
                  className="w-24 accent-indigo-500"
                />
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-neutral-700"></div>

          {/* Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onInvertSelection()}
              disabled={!hasSelection}
              className={`py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center ${
                !hasSelection ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
              }`}
            >
              Invert
            </button>
            <button
              onClick={() => onClearSelection()}
              disabled={!hasSelection}
              className={`py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center ${
                !hasSelection ? 'bg-neutral-800 text-neutral-600' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
              }`}
            >
              Clear
            </button>
            <button
              onClick={() => onEraseSelected()}
              disabled={!hasSelection}
              className={`py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1 ${
                !hasSelection ? 'bg-neutral-800 text-neutral-600' : 'bg-red-600/80 hover:bg-red-500 text-white'
              }`}
            >
              <Eraser size={12} /> Erase
            </button>
          </div>

          <div className="w-px h-6 bg-neutral-700"></div>

          {/* Feature: Auto Tile */}
          <button
            onClick={() => onAutoTile()}
            disabled={isProcessing}
            className={`py-1.5 px-4 rounded text-xs transition-all flex items-center justify-center gap-2 font-medium ${
              isProcessing 
                ? 'bg-indigo-900/50 text-indigo-300 cursor-wait' 
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)] hover:shadow-[0_0_20px_rgba(79,70,229,0.6)]'
            }`}
          >
            {isProcessing ? 'Processing...' : 'Auto Tile'}
          </button>
        </div>
      </div>

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="pointer-events-auto bg-neutral-800 text-neutral-300 px-4 py-1.5 rounded-full shadow-lg border border-neutral-700 font-medium text-sm hover:bg-neutral-700 flex items-center gap-2 transition-colors"
      >
        <MousePointer2 size={14} />
        {isExpanded ? 'Hide Tools' : 'Selection Tools'}
      </button>
    </div>
  );
}
