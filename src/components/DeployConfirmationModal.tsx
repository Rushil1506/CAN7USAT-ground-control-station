import React, { useState } from 'react';
import { Rocket, ShieldAlert, X, AlertTriangle, CheckCircle2, Flame, Sliders, Play } from 'lucide-react';
import { TEAM_INFO } from '../constants';

interface DeployConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDeploy: () => void;
}

export const DeployConfirmationModal: React.FC<DeployConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirmDeploy,
}) => {
  const [sliderVal, setSliderVal] = useState<number>(0);
  const [deployedSuccess, setDeployedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (sliderVal < 100) return;
    setDeployedSuccess(true);
    onConfirmDeploy();
    setTimeout(() => {
      setDeployedSuccess(false);
      setSliderVal(0);
      onClose();
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0E14]/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-[#161B22] border-2 border-[#FFB000] w-full max-w-md p-5 shadow-2xl relative flex flex-col gap-4 font-mono-data text-xs">
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-[#524533] pb-3">
          <div className="flex items-center gap-2 text-[#FFB000]">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="font-bold uppercase tracking-wider text-sm">
              CRITICAL TELECOMMAND UPLINK LATCH
            </h3>
          </div>
          <button onClick={onClose} className="text-[#9F8E78] hover:text-[#E1E2EB] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {deployedSuccess ? (
          <div className="py-8 flex flex-col items-center justify-center text-center gap-2">
            <CheckCircle2 className="w-12 h-12 text-[#38FA87] animate-bounce" />
            <div className="text-lg font-bold text-[#38FA87]">
              TELECOMMAND TRANSMITTED!
            </div>
            <div className="text-xs text-[#D7C4AC]">
              `CMD,{TEAM_INFO.id},DISREEF,OVERRIDE` EXECUTED
            </div>
          </div>
        ) : (
          <>
            <div className="bg-[#0B0E14] border border-[#524533] p-3 text-xs text-[#D7C4AC] leading-relaxed">
              <div className="text-[#FF5252] font-bold mb-1 flex items-center gap-1">
                <ShieldAlert className="w-4 h-4" /> DUAL BURNWIRE MANUAL DISREEF OVERRIDE
              </div>
              Transmits telecommand packet <code className="text-[#FFD597]">CMD,{TEAM_INFO.id},DISREEF,OVERRIDE</code> over 865MHz LoRa to trigger onboard MOSFETs and melt the PE reefing line junction for Stage 2 canopy expansion.
            </div>

            {/* Safety Lock Slider */}
            <div className="flex flex-col gap-2 my-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#9F8E78]">SAFETY ARM LATCH:</span>
                <span className={`font-bold ${sliderVal >= 100 ? 'text-[#38FA87]' : 'text-[#FFD597]'}`}>
                  {sliderVal >= 100 ? 'ARMED & READY' : `${sliderVal}% LOCKED`}
                </span>
              </div>

              <input
                type="range"
                min="0"
                max="100"
                value={sliderVal}
                onChange={(e) => setSliderVal(Number(e.target.value))}
                className="w-full accent-[#FFB000] bg-[#1D2026] h-3 cursor-pointer"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={onClose}
                className="flex-1 bg-[#272A31] hover:bg-[#32353C] text-[#E1E2EB] text-xs py-2.5 uppercase border border-[#524533] cursor-pointer"
              >
                ABORT
              </button>

              <button
                onClick={handleConfirm}
                disabled={sliderVal < 100}
                className={`flex-1 text-xs font-bold py-2.5 uppercase cursor-pointer flex items-center justify-center gap-1.5 transition-all ${
                  sliderVal >= 100
                    ? 'bg-[#FFB000] text-[#000] hover:bg-[#FFD597] go-button'
                    : 'bg-[#32353C] text-[#9F8E78] opacity-50 cursor-not-allowed'
                }`}
              >
                <Flame className="w-4 h-4 text-[#FF5252]" />
                TRIGGER BURNWIRE
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
