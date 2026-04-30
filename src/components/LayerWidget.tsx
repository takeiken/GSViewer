import React, { useState, useRef, useEffect } from 'react';
import { X, Layers, Eye, EyeOff, Trash2, Plus, RotateCcw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { LayerData } from '../App';

interface LayerWidgetProps {
  layers: LayerData[];
  setLayers: React.Dispatch<React.SetStateAction<LayerData[]>>;
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  deletedLayersHistory: LayerData[];
  setDeletedLayersHistory: React.Dispatch<React.SetStateAction<LayerData[]>>;
  undoneDeletedLayersHistory: LayerData[];
  setUndoneDeletedLayersHistory: React.Dispatch<React.SetStateAction<LayerData[]>>;
}

export default function LayerWidget({
  layers,
  setLayers,
  activeLayerId,
  setActiveLayerId,
  deletedLayersHistory,
  setDeletedLayersHistory,
  undoneDeletedLayersHistory,
  setUndoneDeletedLayersHistory
}: LayerWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const panelStartPos = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPosition({ x: 80, y: 80 });
  }, []);

  const handlePanelPointerDown = (e: React.PointerEvent) => {
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
    const maxY = Math.max(0, containerHeight - 400);
    
    const newX = Math.max(0, Math.min(maxX, panelStartPos.current.x + dx));
    const newY = Math.max(0, Math.min(maxY, panelStartPos.current.y + dy));
    
    setPosition({ x: newX, y: newY });
  };

  const handlePanelPointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleDeleteLayer = (layer: LayerData, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletedLayersHistory(prev => [...prev, layer]);
    setUndoneDeletedLayersHistory([]); // clear redo history on new delete
    const newLayers = layers.filter(l => l.id !== layer.id);
    setLayers(newLayers);
    if (activeLayerId === layer.id) {
      if (newLayers.length > 0) setActiveLayerId(newLayers[0].id);
      else setActiveLayerId('');
    }
  };

  const handleUndoDelete = () => {
    if (deletedLayersHistory.length === 0) return;
    const lastDeleted = deletedLayersHistory[deletedLayersHistory.length - 1];
    setDeletedLayersHistory(prev => prev.slice(0, -1));
    setLayers(prev => [...prev, lastDeleted]);
    setActiveLayerId(lastDeleted.id);
    setUndoneDeletedLayersHistory(prev => [...prev, lastDeleted]);
  };

  const handleRedoDelete = () => {
    if (undoneDeletedLayersHistory.length === 0) return;
    const layerToDelete = undoneDeletedLayersHistory[undoneDeletedLayersHistory.length - 1];
    setUndoneDeletedLayersHistory(prev => prev.slice(0, -1));
    setLayers(prev => {
      const newLayers = prev.filter(l => l.id !== layerToDelete.id);
      if (activeLayerId === layerToDelete.id) {
        if (newLayers.length > 0) setActiveLayerId(newLayers[0].id);
        else setActiveLayerId('');
      }
      return newLayers;
    });
    setDeletedLayersHistory(prev => [...prev, layerToDelete]);
  };

  const handleAddLayer = () => {
    const newLayer: LayerData = {
      id: uuidv4(),
      name: `Layer ${layers.length + 1}`,
      visible: true,
      splatUrl: '',
      splatSource: { type: 'url', value: '' },
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
    };
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  if (!isExpanded) {
    return (
      <div className="absolute top-20 left-6 z-50 flex flex-col gap-2">
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 p-3 rounded-full shadow-lg border border-neutral-700 transition-colors flex items-center justify-center"
          title="Open Layers Widget"
        >
          <Layers size={20} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[300px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      style={{ left: position.x, top: position.y, maxHeight: '600px' }}
    >
      <div 
        className="flex items-center justify-between bg-neutral-800 px-3 py-2 border-b border-neutral-700 cursor-move"
        onPointerDown={handlePanelPointerDown}
        onPointerMove={handlePanelPointerMove}
        onPointerUp={handlePanelPointerUp}
      >
        <div className="flex items-center gap-2 text-neutral-300 pointer-events-none">
          <Layers size={16} />
          <span className="text-sm font-medium">Layers</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-neutral-400 hover:text-neutral-200 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Layers</h2>
          <div className="flex gap-1">
            <button
              onClick={handleUndoDelete}
              disabled={deletedLayersHistory.length === 0}
              className={`p-1 rounded ${deletedLayersHistory.length === 0 ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'}`}
              title="Undo delete layer (Ctrl+Z)"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={handleRedoDelete}
              disabled={undoneDeletedLayersHistory.length === 0}
              className={`p-1 rounded ${undoneDeletedLayersHistory.length === 0 ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'} transform -scale-x-100`}
              title="Redo delete layer (Ctrl+Shift+Z)"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {layers.map(layer => (
            <div 
              key={layer.id} 
              className={`flex items-center justify-between p-2 rounded border ${layer.id === activeLayerId ? 'bg-indigo-900/30 border-indigo-500/50' : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700'}`}
            >
              <div 
                className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
                onClick={() => setActiveLayerId(layer.id)}
              >
                <button 
                  onClick={(e) => { e.stopPropagation(); setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l)); }}
                  className="text-neutral-400 hover:text-neutral-200"
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <input 
                  type="text"
                  value={layer.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setLayers(prev => prev.map(l => l.id === layer.id ? { ...l, name: newName } : l));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 min-w-[50px] w-full text-sm text-neutral-200 truncate"
                />
              </div>
              {layers.length > 1 && (
                <button 
                  onClick={(e) => handleDeleteLayer(layer, e)}
                  className="text-neutral-500 hover:text-red-400 p-1"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button
             onClick={handleAddLayer}
             className="w-full py-2 flex justify-center items-center gap-2 border border-dashed border-neutral-700 rounded text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors text-sm"
          >
            <Plus size={14} /> Add Layer
          </button>
        </div>
      </div>
    </div>
  );
}
