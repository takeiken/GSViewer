import React, { useState } from 'react';
import { MousePointer2, Square, Paintbrush, Hexagon, Eraser, Move, LassoSelect, History, Play, SkipForward, ChevronRight, Sparkles, Database } from 'lucide-react';

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
  hasSelection: boolean;
  isProcessing?: boolean;
  
  // History Timeline Props
  isTimelineExpanded: boolean;
  setIsTimelineExpanded: (val: boolean) => void;
  eraserHistory: Array<{ type: 'manual' | 'noise'; indices: number[] }>;
  timelineIndex: number;
  setTimelineIndex: (idx: number) => void;
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
  hasSelection,
  isProcessing = false,
  
  isTimelineExpanded,
  setIsTimelineExpanded,
  eraserHistory = [],
  timelineIndex,
  setTimelineIndex,
}: SelectionWidgetProps) {
  const [isSelectionExpanded, setIsSelectionExpanded] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div id="stackable-toolbars" className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none space-y-3">
      
      {/* 1. History Timeline Panel (Renders at the top of the stack) */}
      {isTimelineExpanded && (
        <div className="pointer-events-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl p-4 w-[420px] max-w-lg flex flex-col text-neutral-200 animate-slide-up">
          <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-neutral-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300 uppercase tracking-tight font-sans">
              <History size={14} className="text-indigo-400" />
              <span>History Timeline</span>
            </div>
            <span className="text-[10px] font-mono text-neutral-405 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
              Step {timelineIndex} of {eraserHistory.length}
            </span>
          </div>

          {/* Warning label placed ABOVE the slider */}
          {timelineIndex < eraserHistory.length && (
            <div className="mb-2 text-[10px] text-indigo-400/80 text-center italic font-mono bg-indigo-950/20 border border-indigo-805/30 rounded py-1 px-2">
              ⚠️ Warning: Editing now will overwrite steps beyond Step {timelineIndex}.
            </div>
          )}

          {/* Slider Controls */}
          <div className="flex items-center space-x-2 my-1">
            <span className="text-[10px] text-neutral-500 font-mono font-medium">0 (Base)</span>
            <input
              type="range"
              min="0"
              max={eraserHistory.length}
              step="1"
              value={timelineIndex}
              onChange={(e) => setTimelineIndex(parseInt(e.target.value))}
              className="flex-1 accent-indigo-500 cursor-pointer h-1.5 bg-neutral-800 rounded-lg appearance-none focus:outline-none"
            />
            <span className="text-[10px] text-neutral-500 font-mono font-medium">{eraserHistory.length} (Latest)</span>
          </div>

          {/* Step History Log List Rendered as Horizontal Node Sequence */}
          <div className="flex items-center gap-1.5 mt-2 px-1 py-1 overflow-x-auto select-none scrollbar-thin shrink-0 min-h-[44px]">
            
            {/* Base Step 0 (Original Splat Model) */}
            <div className="flex items-center">
              <div
                onClick={() => setTimelineIndex(0)}
                onMouseEnter={() => setHoveredIdx(0)}
                onMouseLeave={() => setHoveredIdx(null)}
                className={`relative group flex items-center justify-center w-7 h-7 rounded-full cursor-pointer transition-all border shrink-0 ${
                  timelineIndex === 0
                    ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/80 shadow'
                    : 'bg-neutral-950/50 hover:bg-neutral-800 text-neutral-400 border-neutral-800'
                }`}
                title="Step 0: Original Splat Model (Base State)"
              >
                <Database size={13} />
              </div>

              {eraserHistory.length > 0 && (
                <div className="w-3.5 h-[1.5px] bg-neutral-800 shrink-0"></div>
              )}
            </div>

            {/* Incremental Step Nodes */}
            {eraserHistory.map((stroke, idx) => {
              const stepNum = idx + 1;
              const isPast = stepNum <= timelineIndex;
              const isCurrent = stepNum === timelineIndex;
              const isNoise = stroke.type === 'noise';
              const label = isNoise ? 'Filter Noise Pixies' : 'Selection Erase';

              return (
                <div key={idx} className="flex items-center shrink-0">
                  <div
                    onClick={() => setTimelineIndex(stepNum)}
                    onMouseEnter={() => setHoveredIdx(stepNum)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className={`relative group flex items-center justify-center w-7 h-7 rounded-full cursor-pointer transition-all border shrink-0 ${
                      isCurrent
                        ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/80 shadow'
                        : !isPast
                          ? 'bg-neutral-950/20 text-neutral-600 border-neutral-850/50 opacity-40 hover:opacity-100'
                          : 'bg-neutral-950/50 hover:bg-neutral-800 text-neutral-300 border-neutral-800'
                    }`}
                    title={`Step ${stepNum}: ${label} (${stroke.indices.length.toLocaleString()} points affected)`}
                  >
                    {isNoise ? <Sparkles size={13} /> : <Eraser size={11} />}
                  </div>

                  {idx < eraserHistory.length - 1 && (
                    <div className={`w-3.5 h-[1.5px] shrink-0 ${isPast && (idx + 2 <= timelineIndex) ? 'bg-indigo-500/40' : 'bg-neutral-800'}`}></div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Active / Hovered Step Details region at the bottom of the card */}
          <div className="mt-2 bg-neutral-950/50 border border-neutral-800/80 rounded px-2.5 py-1.5 text-[11px] font-mono select-none">
            {(() => {
              const activeIdx = hoveredIdx !== null ? hoveredIdx : timelineIndex;
              if (activeIdx === 0) {
                return (
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="text-neutral-500">Step 0:</span>
                      <span className="text-neutral-200 font-medium">Original Splat Model</span>
                    </div>
                    <span className="text-neutral-500 text-[10px] uppercase font-semibold">Base State</span>
                  </div>
                );
              } else {
                const stroke = eraserHistory[activeIdx - 1];
                if (!stroke) return null;
                const isNoise = stroke.type === 'noise';
                return (
                  <div className="flex justify-between items-center animate-fade-in">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-neutral-500">Step {activeIdx}:</span>
                      <span className="text-indigo-300 font-medium truncate">
                        {isNoise ? 'Filter Noise Pixies' : 'Selection Erase'}
                      </span>
                    </div>
                    <span className="text-neutral-400 shrink-0 text-[10px] font-semibold ml-2">
                       {stroke.indices.length.toLocaleString()} pts
                    </span>
                  </div>
                );
              }
            })()}
          </div>
        </div>
      )}

      {/* 2. Selection Tools Panel (Renders in the middle of the stack) */}
      {isSelectionExpanded && (
        <div 
          className="pointer-events-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex items-center overflow-hidden transition-all duration-300"
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
                <LassoSelect size={16} />
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
                <Paintbrush size={16} />
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
                  !hasSelection ? 'bg-neutral-800 text-neutral-600' : 'bg-red-600/80 hover:bg-red-500 text-white shadow-md'
                }`}
              >
                <Eraser size={12} /> Erase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Combined Toggle Buttons Row (Renders at the very bottom) */}
      <div className="flex gap-2.5 pointer-events-auto">
        <button
          onClick={() => {
            const nextVal = !isSelectionExpanded;
            setIsSelectionExpanded(nextVal);
            if (!nextVal) {
              setSelectionMode(null);
            }
          }}
          className={`px-4 py-2 rounded-full shadow-lg border font-medium text-xs hover:bg-neutral-700 flex items-center gap-2 transition-all ${
            isSelectionExpanded 
              ? 'bg-neutral-200 text-neutral-900 border-neutral-100' 
              : 'bg-neutral-800 text-neutral-300 border-neutral-700'
          }`}
        >
          <MousePointer2 size={13} />
          {isSelectionExpanded ? 'Hide Tools' : 'Selection Tools'}
        </button>

        <button
          onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
          className={`px-4 py-2 rounded-full shadow-lg border font-medium text-xs hover:bg-neutral-700 flex items-center gap-2 transition-all ${
            isTimelineExpanded 
              ? 'bg-indigo-300/20 text-indigo-300 border-indigo-400/40 md:border-indigo-400' 
              : 'bg-neutral-800 text-neutral-300 border-neutral-700'
          }`}
        >
          <History size={13} />
          Timeline ({eraserHistory.length})
        </button>
      </div>
    </div>
  );
}
