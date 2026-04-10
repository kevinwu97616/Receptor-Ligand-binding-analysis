import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import * as $3Dmol from '3dmol';
import { getMatchingAtoms, kabsch, applyTransform } from '../lib/kabsch';
import { MOD_COLORS, ORIG_COLOR } from '../constants';

export interface FileData {
  name: string;
  content: string;
  type: string;
  energy?: string;
}

export interface LigandInfo {
  type: 'chain' | 'residue';
  chain?: string;
  resn?: string;
  resi?: number;
  label: string;
  count: number; // For chains: residue count; For residues: atom count
}

export interface Interaction {
  type: 'polar' | 'hydrophobic';
  ligandAtom: any;
  receptorAtom: any;
  distance: number;
}

export interface AnalysisResult {
  ligandName: string;
  interactingResidues: { resn: string; resi: number; chain: string; types: Set<string>; ligands: Set<string> }[];
  centroid?: { x: number; y: number; z: number };
  ligandAtoms?: { name: string; elem: string; x: number; y: number; z: number }[];
}

export interface Viewer3DHandle {
  getSnapshot: () => string;
  zoomToLigand: (modelIdx: number) => void;
  resetView: () => void;
  getView: () => any;
  setView: (view: any) => void;
}

interface Viewer3DProps {
  originalFile: FileData | null;
  modifiedFiles: FileData[];
  selectedLigandsMap: Record<string, LigandInfo[]>;
  visibleFiles: Set<string>;
  showSurface: boolean;
  showInteractions: boolean;
  isAligned: boolean;
  origAlignChain: string;
  modAlignChain: string;
  onLigandsDetected: (fileName: string, ligands: LigandInfo[]) => void;
  onAnalysisComplete: (fileName: string, result: AnalysisResult | null) => void;
}

export const Viewer3D = forwardRef<Viewer3DHandle, Viewer3DProps>(({
  originalFile,
  modifiedFiles,
  selectedLigandsMap,
  visibleFiles,
  showSurface,
  showInteractions,
  isAligned,
  origAlignChain,
  modAlignChain,
  onLigandsDetected,
  onAnalysisComplete
}, ref) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerInstance = useRef<any>(null);
  const lastFiles = useRef({ original: '', modified: '' });
  const shouldZoom = useRef(false);
  const [hoveredResidue, setHoveredResidue] = useState<string | null>(null);
  
  // Use refs for callbacks to avoid re-triggering useEffect unnecessarily
  const callbacks = useRef({ onLigandsDetected, onAnalysisComplete });

  useImperativeHandle(ref, () => ({
    getSnapshot: () => {
      if (viewerInstance.current) {
        return viewerInstance.current.pngURI();
      }
      return '';
    },
    resetView: () => {
      if (viewerInstance.current) {
        const viewer = viewerInstance.current;
        // Reset rotation and position using an identity-like matrix
        // 3Dmol's setView takes a 16-element array (4x4 matrix)
        viewer.setView([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        viewer.zoomTo(); // This will center the molecule and adjust distance
        viewer.render();
      }
    },
    getView: () => {
      if (viewerInstance.current) {
        return viewerInstance.current.getView();
      }
      return null;
    },
    setView: (view: any) => {
      if (viewerInstance.current && view) {
        viewerInstance.current.setView(view);
      }
    },
    zoomToLigand: (modelIdx: number) => {
      if (!viewerInstance.current) return;
      const viewer = viewerInstance.current;
      
      const fileName = modelIdx === 0 ? originalFile?.name : modifiedFiles[modelIdx - 1]?.name;
      if (!fileName) return;

      let model = modelIdx === 0 ? models.current.orig : models.current.mods.get(fileName);

      if (model) {
        const targetLigands = selectedLigandsMap[fileName] || [];
          if (targetLigands.length > 0) {
            const ligandSels = targetLigands.map(targetLigand => {
              const sel: any = { model };
              if (targetLigand.type === 'chain') {
                if (targetLigand.chain) sel.chain = targetLigand.chain;
              } else {
                if (targetLigand.chain) sel.chain = targetLigand.chain;
                sel.resi = targetLigand.resi;
                sel.resn = targetLigand.resn;
              }
              return sel;
            });
            const ligandSel = ligandSels.length === 1 ? ligandSels[0] : { or: ligandSels };
            viewer.zoomTo(ligandSel);
          }
        }
      }
  }), [originalFile, modifiedFiles, selectedLigandsMap]);
  useEffect(() => {
    callbacks.current = { onLigandsDetected, onAnalysisComplete };
  }, [onLigandsDetected, onAnalysisComplete]);

  const loadedState = useRef({
    origContent: '',
    modContents: '',
    isAligned: false,
    origAlignChain: '',
    modAlignChain: ''
  });
  const models = useRef<{ orig: any, mods: Map<string, any> }>({ orig: null, mods: new Map() });

  useEffect(() => {
    if (!viewerRef.current) return;

    if (!viewerInstance.current) {
      viewerInstance.current = $3Dmol.createViewer(viewerRef.current, {
        backgroundColor: '#ffffff', // Bright and clear white background
      });
    }

    const viewer = viewerInstance.current;

    const modContents = modifiedFiles.map(f => f.content).join('|||');
    const needsReload =
      originalFile?.content !== loadedState.current.origContent ||
      modContents !== loadedState.current.modContents ||
      isAligned !== loadedState.current.isAligned ||
      origAlignChain !== loadedState.current.origAlignChain ||
      modAlignChain !== loadedState.current.modAlignChain;

    const isElectronegative = (elem: string) => ['O', 'N', 'S', 'F'].includes(elem?.toUpperCase());
    const isCarbon = (elem: string) => elem?.toUpperCase() === 'C';
    const solventResn = ['HOH', 'WAT', 'NA', 'CL', 'MG', 'ZN', 'CA', 'SO4', 'PO4', 'EDO', 'GOL', 'FMT', 'ACT', 'DOD'];

    if (needsReload) {
      viewer.clear();
      models.current = { orig: null, mods: new Map() };

      const currentModNames = modifiedFiles.map(f => f.name).join(',');
      if (originalFile?.name !== lastFiles.current.original || currentModNames !== lastFiles.current.modified) {
        shouldZoom.current = true;
        lastFiles.current = { original: originalFile?.name || '', modified: currentModNames };
      }

      const loadModel = (file: FileData) => {
        if (!file) return null;
        const format = file.name.toLowerCase().endsWith('.cif') ? 'cif' : 'pdb';
        const model = viewer.addModel(file.content, format);

        const candidates: LigandInfo[] = [];

        // 1. Extract all chains
        const allAtoms = model.selectedAtoms({});
        const chainMap = new Map<string, Set<number>>();
        allAtoms.forEach((a: any) => {
          const c = a.chain || '';
          if (!chainMap.has(c)) chainMap.set(c, new Set());
          chainMap.get(c)!.add(a.resi);
        });

        chainMap.forEach((residues, chain) => {
          candidates.push({
            type: 'chain',
            chain: chain,
            label: `Chain ${chain || 'Default'} (${residues.size} residues)`,
            count: residues.size
          });
        });

        // 2. Extract HETATMs
        const hetAtoms = model.selectedAtoms({ hetflag: true, not: { resn: solventResn } });
        const hetMap = new Map<string, { a: any, count: number }>();
        hetAtoms.forEach((a: any) => {
          const c = a.chain || '';
          const key = `${c}-${a.resn}-${a.resi}`;
          if (!hetMap.has(key)) {
            hetMap.set(key, { a, count: 0 });
          }
          hetMap.get(key)!.count += 1;
        });

        hetMap.forEach((val) => {
          candidates.push({
            type: 'residue',
            chain: val.a.chain,
            resn: val.a.resn,
            resi: val.a.resi,
            label: `[HET] ${val.a.resn} ${val.a.resi} (Chain ${val.a.chain || 'Default'})`,
            count: val.count
          });
        });

        callbacks.current.onLigandsDetected(file.name, candidates);
        return model;
      };

      if (originalFile) {
        models.current.orig = loadModel(originalFile);
      }
      modifiedFiles.forEach(f => {
        const m = loadModel(f);
        if (m) models.current.mods.set(f.name, m);
      });

      if (isAligned && models.current.orig && origAlignChain) {
        const alignModel = (targetModel: any, targetAlignChain: string) => {
          // Get CA atoms for alignment calculation to avoid sidechain noise
          let origAtoms = models.current.orig.selectedAtoms({ chain: origAlignChain, atom: 'CA' });
          let modAtoms = targetModel.selectedAtoms({ chain: targetAlignChain, atom: 'CA' });

          // Fallback for nucleic acids or small molecules
          if (origAtoms.length === 0 || modAtoms.length === 0) {
            origAtoms = models.current.orig.selectedAtoms({ chain: origAlignChain, atom: ['P', "C4'", "O3'"] });
            modAtoms = targetModel.selectedAtoms({ chain: targetAlignChain, atom: ['P', "C4'", "O3'"] });
          }

          // Fallback to all atoms if still empty
          if (origAtoms.length === 0 || modAtoms.length === 0) {
            origAtoms = models.current.orig.selectedAtoms({ chain: origAlignChain });
            modAtoms = targetModel.selectedAtoms({ chain: targetAlignChain });
          }

          const { matched1, matched2 } = getMatchingAtoms(origAtoms, modAtoms);

          if (matched1.length >= 3) {
            const { R, t } = kabsch(matched2, matched1);
            
            // Apply transform to all atoms in the modified model
            const allModAtoms = targetModel.selectedAtoms({});
            const allModPoints = allModAtoms.map((a: any) => ({ x: a.x, y: a.y, z: a.z }));
            const transformedPoints = applyTransform(allModPoints, R, t);
            
            for (let i = 0; i < allModAtoms.length; i++) {
              allModAtoms[i].x = transformedPoints[i].x;
              allModAtoms[i].y = transformedPoints[i].y;
              allModAtoms[i].z = transformedPoints[i].z;
            }
          }
        };

        models.current.mods.forEach(m => alignModel(m, modAlignChain));
      }

      loadedState.current = {
        origContent: originalFile?.content || '',
        modContents,
        isAligned,
        origAlignChain,
        modAlignChain
      };
    }

    // Always clear volatile visuals and re-apply styles
    viewer.removeAllShapes();
    viewer.removeAllSurfaces();
    viewer.removeAllLabels();

    const styleModel = (model: any, fileName: string, targetLigands: LigandInfo[], colorIdx: number = -1) => {
      if (!model) return;
      
      // Base style: cartoon for receptor
      let proteinColor = ORIG_COLOR.hex;
      let ligandColorScheme = ORIG_COLOR.ligand;
      let pocketColorScheme = ORIG_COLOR.pocket;

      if (colorIdx > 0) {
        const modColor = MOD_COLORS[(colorIdx - 1) % MOD_COLORS.length];
        proteinColor = modColor.hex;
        ligandColorScheme = modColor.ligand;
        pocketColorScheme = modColor.pocket;
      }

      viewer.setStyle({ model }, { cartoon: { color: proteinColor, opacity: 0.5 } });

      if (!targetLigands || targetLigands.length === 0) {
        callbacks.current.onAnalysisComplete(fileName, null);
        return;
      }

      // Build selection for the target ligands
      const ligandSels = targetLigands.map(targetLigand => {
        const sel: any = { model };
        if (targetLigand.type === 'chain') {
          if (targetLigand.chain) sel.chain = targetLigand.chain;
        } else {
          if (targetLigand.chain) sel.chain = targetLigand.chain;
          sel.resi = targetLigand.resi;
          sel.resn = targetLigand.resn;
        }
        return sel;
      });
      
      const ligandSel = ligandSels.length === 1 ? ligandSels[0] : { or: ligandSels };

      const ligandAtoms = model.selectedAtoms(ligandSel);
      
      if (ligandAtoms.length === 0) {
        callbacks.current.onAnalysisComplete(fileName, null);
        return;
      }

      // Style Ligand
      viewer.setStyle(ligandSel, { stick: { colorscheme: ligandColorScheme, radius: 0.25 } });

      // Calculate centroid
      let sumX = 0, sumY = 0, sumZ = 0;
      ligandAtoms.forEach((a: any) => {
        sumX += a.x;
        sumY += a.y;
        sumZ += a.z;
      });
      const centroid = {
        x: sumX / ligandAtoms.length,
        y: sumY / ligandAtoms.length,
        z: sumZ / ligandAtoms.length
      };

      // Find Pocket and Interactions
      const pocketSel = { model, within: { distance: 5.0, sel: ligandSel }, not: ligandSel };
      
      if (showInteractions) {
        viewer.addStyle(pocketSel, { stick: { colorscheme: pocketColorScheme, radius: 0.15 } });
      }

      const receptorAtoms = model.selectedAtoms(pocketSel);
      const interactions: Interaction[] = [];
      const interactingResiduesMap = new Map<string, { resn: string; resi: number; chain: string; types: Set<string>; ligands: Set<string> }>();

      // Interaction Detection
      ligandAtoms.forEach((lAtom: any) => {
        receptorAtoms.forEach((rAtom: any) => {
          const dx = lAtom.x - rAtom.x;
          const dy = lAtom.y - rAtom.y;
          const dz = lAtom.z - rAtom.z;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq <= 16.0) {
            const dist = Math.sqrt(distSq);
            let type: 'polar' | 'hydrophobic' | null = null;

            if (dist <= 3.5 && isElectronegative(lAtom.elem) && isElectronegative(rAtom.elem)) {
              type = 'polar';
            } else if (dist <= 4.0 && isCarbon(lAtom.elem) && isCarbon(rAtom.elem)) {
              type = 'hydrophobic';
            }

            if (type) {
              interactions.push({ type, ligandAtom: lAtom, receptorAtom: rAtom, distance: dist });
              const resKey = `${rAtom.chain}-${rAtom.resn}-${rAtom.resi}`;
              if (!interactingResiduesMap.has(resKey)) {
                interactingResiduesMap.set(resKey, { resn: rAtom.resn, resi: rAtom.resi, chain: rAtom.chain, types: new Set(), ligands: new Set() });
              }
              interactingResiduesMap.get(resKey)!.types.add(type);
              
              const ligChain = lAtom.chain ? `${lAtom.chain}:` : '';
              interactingResiduesMap.get(resKey)!.ligands.add(`${ligChain}${lAtom.resn}${lAtom.resi}`);
            }
          }
        });
      });

      if (showInteractions) {
        interactions.forEach(interaction => {
          viewer.addCylinder({
            start: { x: interaction.ligandAtom.x, y: interaction.ligandAtom.y, z: interaction.ligandAtom.z },
            end: { x: interaction.receptorAtom.x, y: interaction.receptorAtom.y, z: interaction.receptorAtom.z },
            radius: 0.05,
            color: interaction.type === 'polar' ? '#2563eb' : '#ea580c',
            dashed: true,
            fromCap: 1,
            toCap: 1,
          });
        });
      }

      if (showSurface) {
        viewer.addSurface($3Dmol.SurfaceType.VDW, {
          opacity: 0.5,
          color: proteinColor
        }, { model, not: ligandSel });
      }

      callbacks.current.onAnalysisComplete(fileName, {
        ligandName: targetLigands.map(l => l.label).join(', '),
        interactingResidues: Array.from(interactingResiduesMap.values()).sort((a, b) => a.resi - b.resi),
        centroid,
        ligandAtoms: ligandAtoms.map((a: any) => ({ name: a.atom, elem: a.elem, x: a.x, y: a.y, z: a.z }))
      });
    };

    if (models.current.orig) {
      if (originalFile && visibleFiles.has(originalFile.name)) {
        styleModel(models.current.orig, originalFile.name, selectedLigandsMap[originalFile.name] || [], 0);
      } else if (originalFile) {
        viewer.setStyle({ model: models.current.orig }, { hidden: true });
        callbacks.current.onAnalysisComplete(originalFile.name, null);
      }
    }

    if (models.current.mods.size > 0) {
      modifiedFiles.forEach((modFile, idx) => {
        const m = models.current.mods.get(modFile.name);
        if (m) {
          if (visibleFiles.has(modFile.name)) {
            styleModel(m, modFile.name, selectedLigandsMap[modFile.name] || [], idx + 1);
          } else {
            viewer.setStyle({ model: m }, { hidden: true });
            callbacks.current.onAnalysisComplete(modFile.name, null);
          }
        }
      });
    }

    if (shouldZoom.current) {
      viewer.zoomTo();
      shouldZoom.current = false;
    }
    
    viewer.setHoverable({}, true, 
      (atom: any) => {
        if (atom) {
          const resn = atom.resn || '';
          const resi = atom.resi || '';
          const chain = atom.chain || '';
          const elem = atom.elem || '';
          const name = atom.atom || '';
          setHoveredResidue(`${resn} ${resi} (Chain ${chain}) - ${name} (${elem})`);
          viewer.render(); // Ensure it updates if needed
        }
      },
      () => {
        setHoveredResidue(null);
        viewer.render();
      }
    );

    viewer.render();

  }, [originalFile, modifiedFiles, selectedLigandsMap, visibleFiles, showSurface, showInteractions, isAligned, origAlignChain, modAlignChain]);

  return (
    <div ref={viewerRef} className="w-full h-full relative bg-white">
      {(!originalFile && modifiedFiles.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none z-10 font-medium">
          Upload PDB or CIF files to view 3D structure
        </div>
      )}
      <div className="absolute bottom-4 right-4 text-xs text-gray-600 bg-white/90 px-3 py-2 rounded-md pointer-events-none z-10 border border-gray-200 shadow-sm">
        Left Click: Rotate | Right Click: Pan | Scroll: Zoom
      </div>
      <div className="absolute top-4 right-4 text-[10px] bg-white/90 p-2 rounded-md pointer-events-none z-10 border border-gray-200 shadow-sm space-y-1.5 text-gray-700 max-h-[80%] overflow-y-auto w-44">
        <div className="font-bold text-gray-900 mb-1 border-b border-gray-100 pb-1 text-xs">Legend</div>
        
        {originalFile && visibleFiles.has(originalFile.name) && (
          <>
            <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: ORIG_COLOR.hex }}></span> Original Receptor</div>
            <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: '#22c55e' }}></span> Original Ligand</div>
            {showInteractions && (
              <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: '#06b6d4' }}></span> Original Pocket</div>
            )}
          </>
        )}

        {modifiedFiles.map((f, idx) => {
          if (!visibleFiles.has(f.name)) return null;
          const color = MOD_COLORS[idx % MOD_COLORS.length];
          // Approximate ligand color based on colorscheme
          const ligandColorMap: Record<string, string> = {
            'magentaCarbon': '#d946ef',
            'redCarbon': '#ef4444',
            'orangeCarbon': '#f97316',
            'greenCarbon': '#22c55e',
            'purpleCarbon': '#a855f7',
            'cyanCarbon': '#06b6d4',
            'whiteCarbon': '#ffffff',
            'blueCarbon': '#2563eb',
            'yellowCarbon': '#eab308'
          };
          const pocketColorMap: Record<string, string> = {
            'yellowCarbon': '#eab308',
            'orangeCarbon': '#f97316',
            'cyanCarbon': '#06b6d4',
            'magentaCarbon': '#d946ef',
            'greenCarbon': '#22c55e'
          };

          return (
            <div key={f.name} className="pt-1 border-t border-gray-50">
              <div className="font-semibold text-[9px] truncate mb-0.5" title={f.name}>{f.name}</div>
              <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: color.hex }}></span> Receptor</div>
              <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: ligandColorMap[color.ligand] || '#ffffff' }}></span> Ligand</div>
              {showInteractions && (
                <div className="flex items-center"><span className="w-2.5 h-2.5 mr-1.5 rounded-sm border border-gray-300 shrink-0" style={{ backgroundColor: pocketColorMap[color.pocket] || '#ffffff' }}></span> Pocket</div>
              )}
            </div>
          );
        })}

        {showInteractions && (
          <div className="pt-1 border-t border-gray-100">
            <div className="flex items-center"><span className="w-2.5 h-0.5 mr-1.5" style={{ backgroundColor: '#2563eb' }}></span> Polar / H-Bond</div>
            <div className="flex items-center"><span className="w-2.5 h-0.5 mr-1.5" style={{ backgroundColor: '#ea580c' }}></span> Hydrophobic</div>
          </div>
        )}
      </div>

      {hoveredResidue && (
        <div className="absolute bottom-16 right-4 bg-white/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-gray-200 text-xs font-mono text-gray-800 z-10 pointer-events-none">
          {hoveredResidue}
        </div>
      )}
    </div>
  );
});
