import React from "react";
import { Keyframe } from "../types/slam";
import { Image as ImageIcon, MapPin, Clock } from "lucide-react";

interface KeyframeGalleryProps {
  keyframes: Keyframe[];
  activeKeyframe: Keyframe | null;
  onSelectKeyframe: (kf: Keyframe) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const KeyframeGallery: React.FC<KeyframeGalleryProps> = ({
  keyframes,
  activeKeyframe,
  onSelectKeyframe,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="absolute bottom-16 inset-x-4 max-w-2xl mx-auto bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md p-3 z-30 animate-in fade-in">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <ImageIcon className="w-4 h-4 text-amber-400" />
          <span>Galería de Keyframes ({keyframes.length})</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-xs px-2 py-0.5 rounded-lg bg-slate-800"
        >
          Cerrar
        </button>
      </div>

      {keyframes.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Aún no se han generado keyframes. Mueve la cámara para registrar nuevos puntos de vista clave.
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin">
          {keyframes.map((kf) => {
            const isSelected = activeKeyframe?.id === kf.id;
            return (
              <button
                key={kf.id}
                onClick={() => onSelectKeyframe(kf)}
                className={`relative shrink-0 rounded-xl overflow-hidden border transition-all text-left group ${
                  isSelected
                    ? "border-amber-400 ring-2 ring-amber-400/40 scale-105"
                    : "border-slate-700/60 hover:border-slate-500"
                }`}
              >
                <img
                  src={kf.thumbnail}
                  alt={`Keyframe ${kf.id}`}
                  className="w-24 h-18 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-1.5 text-[10px] text-white font-mono">
                  <span className="font-semibold text-amber-300">KF #{kf.id}</span>
                  <span className="text-slate-300 text-[9px]">
                    {kf.pointsCount.toLocaleString()} pts
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
