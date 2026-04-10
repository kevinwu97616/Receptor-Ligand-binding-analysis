import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Viewer3D, FileData, AnalysisResult, LigandInfo, Viewer3DHandle } from './components/Viewer3D';
import { Upload, Eye, EyeOff, Activity, Settings2, FileText, Zap, Layers, ChevronDown, ChevronUp, Trash2, CheckCircle2, Camera, RotateCcw, BookmarkPlus, Bookmark } from 'lucide-react';
import { MOD_COLORS, ORIG_COLOR } from './constants';

export interface RankDetails {
  rmsd: number | null;
  energy: number;
  interactionScore: number;
  totalScore: number;
}

export default function App() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [originalFile, setOriginalFile] = useState<FileData | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<FileData[]>([]);
  const viewer3DRef = useRef<Viewer3DHandle>(null);
  
  const [detectedLigandsMap, setDetectedLigandsMap] = useState<Record<string, LigandInfo[]>>({});
  const [selectedLigandsMap, setSelectedLigandsMap] = useState<Record<string, LigandInfo[]>>({});
  const [analysisMap, setAnalysisMap] = useState<Record<string, AnalysisResult | null>>({});
  const [rankDetailsMap, setRankDetailsMap] = useState<Record<string, RankDetails>>({});

  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(new Set());
  const [showSurface, setShowSurface] = useState<boolean>(false);
  const [showInteractions, setShowInteractions] = useState<boolean>(false);
  const [isAligned, setIsAligned] = useState<boolean>(false);

  const [selectedForReport, setSelectedForReport] = useState<Set<string>>(new Set());

  const toggleReportSelection = (fileName: string) => {
    setSelectedForReport(prev => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  const toggleVisibility = (fileName: string) => {
    setVisibleFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  const [origAlignChain, setOrigAlignChain] = useState<string>('');
  const [modAlignChain, setModAlignChain] = useState<string>('');
  const [savedViews, setSavedViews] = useState<(any | null)[]>([null, null, null, null]);

  const handleSaveView = (index: number) => {
    if (viewer3DRef.current) {
      const view = viewer3DRef.current.getView();
      setSavedViews(prev => {
        const next = [...prev];
        next[index] = view;
        return next;
      });
    }
  };

  const handleRestoreView = (index: number) => {
    if (viewer3DRef.current && savedViews[index]) {
      viewer3DRef.current.setView(savedViews[index]);
    }
  };

  const takeSnapshot = () => {
    if (viewer3DRef.current) {
      const dataUrl = viewer3DRef.current.getSnapshot();
      if (dataUrl) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `ProLigand_Snapshot_${new Date().getTime()}.png`;
        link.click();
      }
    }
  };

  React.useEffect(() => {
    if (!originalFile) return;
    const ligands = detectedLigandsMap[originalFile.name] || [];
    const chains = ligands.filter(l => l.type === 'chain');
    if (chains.length > 0 && !origAlignChain) {
      setOrigAlignChain(chains[0].chain || '');
    }
  }, [detectedLigandsMap, originalFile, origAlignChain]);

  React.useEffect(() => {
    if (modifiedFiles.length === 0) return;
    const lastMod = modifiedFiles[modifiedFiles.length - 1];
    const ligands = detectedLigandsMap[lastMod.name] || [];
    const chains = ligands.filter(l => l.type === 'chain');
    if (chains.length > 0 && !modAlignChain) {
      setModAlignChain(chains[0].chain || '');
    }
  }, [detectedLigandsMap, modifiedFiles, modAlignChain]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleExpand = (fileName: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(f => f.name !== fileName));
    if (originalFile?.name === fileName) setOriginalFile(null);
    setModifiedFiles(prev => prev.filter(f => f.name !== fileName));
    setVisibleFiles(prev => {
      const next = new Set(prev);
      next.delete(fileName);
      return next;
    });
    setDetectedLigandsMap(prev => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setSelectedLigandsMap(prev => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setAnalysisMap(prev => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
    setSelectedForReport(prev => {
      const next = new Set(prev);
      next.delete(fileName);
      return next;
    });
  };

  const clearAllFiles = () => {
    setFiles([]);
    setOriginalFile(null);
    setModifiedFiles([]);
    setVisibleFiles(new Set());
    setDetectedLigandsMap({});
    setSelectedLigandsMap({});
    setAnalysisMap({});
    setExpandedFiles(new Set());
  };

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files || []) as File[];
    if (uploadedFiles.length === 0) return;

    const newFilesPromises = uploadedFiles.map(file => {
      return new Promise<FileData>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          let energy: string | undefined;
          const energyMatch = content.match(/REMARK\s+Model\s+\d+\s+energy=\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/i);
          if (energyMatch && energyMatch[1]) {
            const parsedVal = parseFloat(energyMatch[1]);
            if (!isNaN(parsedVal)) {
              energy = parsedVal > 0 ? `-${parsedVal}` : parsedVal.toString();
            } else {
              energy = energyMatch[1];
            }
          }
          resolve({
            name: file.name,
            content,
            type: file.type || 'text/plain',
            energy,
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(newFilesPromises).then(newFiles => {
      setFiles(prev => {
        const combined = [...prev, ...newFiles];
        // Auto-select if empty
        if (!originalFile && combined.length > 0) {
          setOriginalFile(combined[0]);
          setModifiedFiles(combined.slice(1));
        }
        
        // Auto-select for report
        setSelectedForReport(prevReport => {
          const next = new Set(prevReport);
          newFiles.forEach(f => next.add(f.name));
          return next;
        });

        // Add to visible files
        setVisibleFiles(prevVisible => {
          const next = new Set(prevVisible);
          newFiles.forEach(f => next.add(f.name));
          return next;
        });

        return combined;
      });
    });
  };

  const handleLigandsDetected = useCallback((fileName: string, ligands: LigandInfo[]) => {
    setDetectedLigandsMap(prev => {
      if (prev[fileName]?.length === ligands.length && prev[fileName]?.every((l, i) => l.label === ligands[i].label)) return prev;
      return { ...prev, [fileName]: ligands };
    });

    setSelectedLigandsMap(prev => {
      if (prev[fileName] && prev[fileName].length > 0) {
        // Keep previously selected if they still exist
        const stillExisting = prev[fileName].filter(p => ligands.some(l => l.label === p.label));
        if (stillExisting.length > 0) return { ...prev, [fileName]: stillExisting };
      }
      
      if (ligands.length === 0) return { ...prev, [fileName]: [] };

      // Default selection:
      // 1. All HETATMs (type === 'residue')
      // 2. Chains with < 100 residues (type === 'chain' && count < 100)
      const defaultSel = ligands.filter(l => 
        l.type === 'residue' || (l.type === 'chain' && l.count < 100)
      );

      // If nothing matches the heuristic, fallback to the previous logic
      if (defaultSel.length === 0) {
        const hetatms = ligands.filter(l => l.type === 'residue').sort((a, b) => b.count - a.count);
        const chains = ligands.filter(l => l.type === 'chain').sort((a, b) => a.count - b.count);
        if (hetatms.length > 0) return { ...prev, [fileName]: [hetatms[0]] };
        if (chains.length > 0) return { ...prev, [fileName]: [chains[0]] };
        return { ...prev, [fileName]: [ligands[0]] };
      }

      return { ...prev, [fileName]: defaultSel };
    });
  }, []);

  const handleAnalysisComplete = useCallback((fileName: string, result: AnalysisResult | null) => {
    setAnalysisMap(prev => ({ ...prev, [fileName]: result }));
  }, []);

  const analyzeAndRank = () => {
    if (!originalFile || modifiedFiles.length === 0) return;
    const origAnalysis = analysisMap[originalFile.name];
    if (!origAnalysis || !origAnalysis.centroid) {
      alert("Please ensure the reference structure (ORIG) is loaded and its ligand is selected.");
      return;
    }

    const origResSet = new Set(origAnalysis.interactingResidues.map(r => `${r.chain}${r.resn}${r.resi}`));
    const newRankDetails: Record<string, RankDetails> = {};
    
    const scoredFiles = modifiedFiles.map(file => {
      const modAnalysis = analysisMap[file.name];
      if (!modAnalysis || !modAnalysis.centroid) return { file, score: -1000 };
      
      // 1. RMSD Calculation (fallback to centroid distance if atoms don't match)
      let rmsd: number | null = null;
      if (origAnalysis.ligandAtoms && modAnalysis.ligandAtoms) {
        const map2 = new Map(modAnalysis.ligandAtoms.map(a => [a.name, a]));
        let sumSq = 0;
        let count = 0;
        for (const a1 of origAnalysis.ligandAtoms) {
          const a2 = map2.get(a1.name);
          if (a2) {
            const dx = a1.x - a2.x;
            const dy = a1.y - a2.y;
            const dz = a1.z - a2.z;
            sumSq += dx*dx + dy*dy + dz*dz;
            count++;
          }
        }
        if (count > 0) {
          rmsd = Math.sqrt(sumSq / count);
        }
      }
      
      const dx = modAnalysis.centroid.x - origAnalysis.centroid.x;
      const dy = modAnalysis.centroid.y - origAnalysis.centroid.y;
      const dz = modAnalysis.centroid.z - origAnalysis.centroid.z;
      const centroidDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      const effectiveRmsd = rmsd !== null ? rmsd : centroidDist;

      // 2. Interaction Score Calculation
      let interactionScore = 0;
      modAnalysis.interactingResidues.forEach(r => {
        if (r.types.has('polar')) interactionScore += 2;
        if (r.types.has('hydrophobic')) interactionScore += 1;
      });

      // 3. Energy Calculation
      const energyVal = file.energy ? parseFloat(file.energy) : 0;
      const energyNum = isNaN(energyVal) ? 0 : energyVal;

      // Composite Score Formula
      // - RMSD: lower is better. Max 50 points for 0A, 0 points for >10A.
      const rmsdScore = Math.max(0, 10 - effectiveRmsd) * 5; 
      
      // - Energy: lower is better (more negative). We'll use -energy as the score component.
      // E.g., energy -200 -> +200 points. If energy is positive, it penalizes.
      // To balance weights, let's normalize or just add it directly if they are in similar ranges.
      // We'll multiply by a weight factor, say 0.5.
      const energyScore = -energyNum * 0.5;

      // - Interaction: higher is better. 
      // E.g., 10 polar + 5 hydrophobic = 25 points. Multiply by 2.
      const intScoreWeighted = interactionScore * 2;

      // Penalty for completely different pocket
      const penalty = centroidDist > 15 ? -500 : 0;
      
      const totalScore = rmsdScore + energyScore + intScoreWeighted + penalty;
      
      newRankDetails[file.name] = {
        rmsd: effectiveRmsd,
        energy: energyNum,
        interactionScore,
        totalScore
      };
      
      return { file, score: totalScore };
    });

    setRankDetailsMap(newRankDetails);
    const sorted = [...scoredFiles].sort((a, b) => b.score - a.score).map(s => s.file);
    setModifiedFiles(sorted);
    setFiles(prev => {
      const otherFiles = prev.filter(f => !modifiedFiles.find(mf => mf.name === f.name) && f.name !== originalFile.name);
      return [originalFile, ...otherFiles, ...sorted];
    });
  };

  const resetSettings = () => {
    setShowSurface(false);
    setShowInteractions(false);
    setIsAligned(false);
    setOrigAlignChain('');
    setModAlignChain('');
  };

  const handleResetView = () => {
    if (viewer3DRef.current) {
      viewer3DRef.current.resetView();
    }
  };

  const generateReport = async () => {
    if (files.length === 0) return;

    // Save current state to restore later
    const prevShowInteractions = showInteractions;
    const prevVisibleFiles = new Set(visibleFiles);
    setShowInteractions(true);
    
    // Give time for interactions to render
    await new Promise(r => setTimeout(r, 300));

    let htmlReport = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ProLigand Analysis Report</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap');
          body { font-family: 'Inter', -apple-system, sans-serif; line-height: 1.4; color: #374151; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f9fafb; }
          .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); padding: 20px; margin-bottom: 20px; border: 1px solid #f3f4f6; page-break-inside: avoid; }
          h1 { color: #111827; font-size: 1.75rem; font-weight: 800; letter-spacing: -0.025em; margin-bottom: 4px; }
          h2 { color: #111827; font-size: 1.25rem; font-weight: 700; margin-top: 0; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
          h2::before { content: ""; width: 4px; height: 20px; background: #6366f1; border-radius: 2px; }
          .section-title { font-weight: 700; text-transform: uppercase; font-size: 0.75rem; color: #9ca3af; letter-spacing: 0.1em; margin-bottom: 8px; margin-top: 16px; display: flex; align-items: center; }
          .section-title::after { content: ""; flex: 1; height: 1px; background: #f3f4f6; margin-left: 12px; }
          .snapshot-container { background: #000; border-radius: 8px; overflow: hidden; margin: 12px 0; border: 1px solid #e5e7eb; box-shadow: inset 0 2px 4px 0 rgba(0,0,0,0.06); }
          .snapshot { width: 100%; display: block; max-height: 300px; object-fit: contain; }
          .residue-tag { display: inline-flex; align-items: center; padding: 2px 6px; background: #f3f4f6; border-radius: 4px; margin: 2px; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; border: 1px solid #e5e7eb; font-weight: 600; color: #4b5563; }
          .polar { border-left: 3px solid #3b82f6; background: #eff6ff; color: #1e40af; }
          .hydrophobic { border-left: 3px solid #f97316; background: #fff7ed; color: #9a3412; }
          .meta { font-size: 0.875rem; color: #6b7280; margin-bottom: 20px; display: flex; gap: 20px; }
          .badge { padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
          .badge-conserved { background: #dcfce7; color: #166534; }
          .badge-gained { background: #fce7f3; color: #9d174d; }
          .badge-lost { background: #f3f4f6; color: #4b5563; text-decoration: line-through; opacity: 0.7; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 8px; border: 1px solid #f3f4f6; border-radius: 8px; overflow: hidden; }
          th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 0.875rem; }
          th { background: #f9fafb; font-size: 0.7rem; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.05em; }
          tr:last-child td { border-bottom: none; }
          .conclusion { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin-top: 16px; position: relative; overflow: hidden; }
          .conclusion::before { content: ""; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: #94a3b8; }
          .conclusion-title { font-weight: 800; color: #475569; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.05em; }
          .conclusion-text { font-size: 0.875rem; color: #334155; line-height: 1.5; }
          .summary-box { background: #111827; color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px; position: relative; overflow: hidden; }
          .summary-box::after { content: ""; position: absolute; top: -50%; right: -10%; width: 200px; height: 200px; background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%); }
          .summary-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 12px; letter-spacing: 0.1em; }
          .summary-stats { display: flex; gap: 24px; }
          .stat-item { display: flex; flex-direction: column; gap: 2px; }
          .stat-value { font-size: 1.5rem; font-weight: 800; color: #818cf8; }
          .stat-label { font-size: 0.8rem; opacity: 0.6; font-weight: 500; }
          .comparison-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 16px; }
          .comp-card { background: #f9fafb; padding: 12px; border-radius: 8px; border: 1px solid #f3f4f6; }
          .comp-val { font-size: 1.25rem; font-weight: 800; margin-bottom: 2px; }
          .comp-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; color: #9ca3af; }
        </style>
      </head>
      <body>
        <h1>ProLigand Analysis Report</h1>
        <div class="meta">
          <span>📅 ${new Date().toLocaleDateString()}</span>
          <span>⏰ ${new Date().toLocaleTimeString()}</span>
        </div>
        
        <div class="summary-box">
          <div class="summary-title">Executive Summary</div>
          <div class="summary-stats">
            <div class="stat-item">
              <span class="stat-value">${files.length}</span>
              <span class="stat-label">Structures Loaded</span>
            </div>
            <div class="stat-item">
              <span class="stat-value">${selectedForReport.size}</span>
              <span class="stat-label">Layers Analyzed</span>
            </div>
          </div>
        </div>
    `;

    // Original Section
    if (originalFile && selectedForReport.has(originalFile.name)) {
      const origAnalysis = analysisMap[originalFile.name];
      
      // Isolate visibility for snapshot
      setVisibleFiles(new Set([originalFile.name]));
      await new Promise(r => setTimeout(r, 500));
      
      viewer3DRef.current?.zoomToLigand(0);
      await new Promise(r => setTimeout(r, 800));
      const snapshot = viewer3DRef.current?.getSnapshot() || '';

      htmlReport += `
        <div class="card">
          <h2>Reference Structure: ${originalFile.name}</h2>
          <div class="section-title">Binding Site Visualization</div>
          <div class="snapshot-container">
            <img src="${snapshot}" class="snapshot" />
          </div>
          <div class="section-title">Ligand Information</div>
          <p style="font-size: 0.9375rem;"><strong>Detected Ligand:</strong> <span style="color: #6366f1; font-weight: 700;">${origAnalysis?.ligandName || "N/A"}</span></p>
          ${originalFile.energy !== undefined ? `<p style="font-size: 0.9375rem;"><strong>Energy:</strong> <span style="color: #d97706; font-weight: 700;">${originalFile.energy}</span></p>` : ''}
          <div class="section-title">Interaction Profile (${origAnalysis?.interactingResidues.length || 0} residues)</div>
          <div style="margin-top: 12px;">
            ${origAnalysis?.interactingResidues.map(r => `
              <span class="residue-tag ${Array.from(r.types).join(' ')}">
                L(${Array.from(r.ligands || []).join(', ')}) ↔ R(${r.chain}:${r.resn}${r.resi})
              </span>
            `).join('') || "No interactions detected."}
          </div>
        </div>
      `;
    }

    // Modified Sections
    const reportModifiedFiles = modifiedFiles.filter(f => selectedForReport.has(f.name));
    if (reportModifiedFiles.length > 0) {
      for (let i = 0; i < modifiedFiles.length; i++) {
        const modFile = modifiedFiles[i];
        if (!selectedForReport.has(modFile.name)) continue;
        
        const modAnalysis = analysisMap[modFile.name];
        
        // Isolate visibility for snapshot
        setVisibleFiles(new Set([modFile.name]));
        await new Promise(r => setTimeout(r, 500));
        
        viewer3DRef.current?.zoomToLigand(i + 1);
        await new Promise(r => setTimeout(r, 800));
        const snapshot = viewer3DRef.current?.getSnapshot() || '';

        let comparisonSection = '';
        let conclusionText = '';
        
        if (originalFile) {
          const origAnalysis = analysisMap[originalFile.name];
          if (origAnalysis && modAnalysis && origAnalysis.centroid && modAnalysis.centroid) {
            const dx = modAnalysis.centroid.x - origAnalysis.centroid.x;
            const dy = modAnalysis.centroid.y - origAnalysis.centroid.y;
            const dz = modAnalysis.centroid.z - origAnalysis.centroid.z;
            const centroidDist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            const origResMap = new Map(origAnalysis.interactingResidues.map(r => [`${r.chain}${r.resn}${r.resi}`, r]));
            const modResMap = new Map(modAnalysis.interactingResidues.map(r => [`${r.chain}${r.resn}${r.resi}`, r]));
            
            const conserved = modAnalysis.interactingResidues.filter(r => origResMap.has(`${r.chain}${r.resn}${r.resi}`));
            const gained = modAnalysis.interactingResidues.filter(r => !origResMap.has(`${r.chain}${r.resn}${r.resi}`));
            const lost = origAnalysis.interactingResidues.filter(r => !modResMap.has(`${r.chain}${r.resn}${r.resi}`));
            
            const conservedCount = conserved.length;
            const gainedCount = gained.length;
            const lostCount = lost.length;
            const totalOrig = origAnalysis.interactingResidues.length;
            const conservationRate = ((conservedCount / totalOrig) * 100).toFixed(1);

            const rankDetails = rankDetailsMap[modFile.name];
            
            comparisonSection = `
              <div class="section-title">Comparative Analysis & Ranking (vs. Reference)</div>
              <div class="comparison-grid">
                ${rankDetails ? `
                <div class="comp-card" style="background: #ecfdf5; border-color: #a7f3d0;">
                  <div class="comp-val" style="color: #059669;">${rankDetails.totalScore.toFixed(1)}</div>
                  <div class="comp-label">Composite Rank Score</div>
                </div>
                <div class="comp-card">
                  <div class="comp-val" style="color: #4f46e5;">${rankDetails.rmsd !== null ? rankDetails.rmsd.toFixed(2) : centroidDist.toFixed(2)} Å</div>
                  <div class="comp-label">${rankDetails.rmsd !== null ? 'Ligand RMSD' : 'Centroid Distance'}</div>
                </div>
                <div class="comp-card">
                  <div class="comp-val" style="color: #d97706;">${rankDetails.energy}</div>
                  <div class="comp-label">Energy</div>
                </div>
                <div class="comp-card">
                  <div class="comp-val" style="color: #db2777;">${rankDetails.interactionScore}</div>
                  <div class="comp-label">Interaction Score</div>
                </div>
                ` : `
                <div class="comp-card">
                  <div class="comp-val" style="color: #4f46e5;">${centroidDist.toFixed(2)} Å</div>
                  <div class="comp-label">Centroid Distance</div>
                </div>
                `}
                <div class="comp-card">
                  <div class="comp-val" style="color: #059669;">${conservedCount}</div>
                  <div class="comp-label">Conserved</div>
                </div>
                <div class="comp-card">
                  <div class="comp-val" style="color: #db2777;">${gainedCount}</div>
                  <div class="comp-label">Gained</div>
                </div>
              </div>

              <table>
                <thead>
                  <tr><th>Category</th><th>Residues</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span class="badge badge-conserved">Conserved</span></td>
                    <td>${conserved.map(r => `<span class="residue-tag">L(${Array.from(r.ligands || []).join(', ')}) ↔ R(${r.chain}:${r.resn}${r.resi})</span>`).join(' ')}</td>
                  </tr>
                  <tr>
                    <td><span class="badge badge-gained">Gained</span></td>
                    <td>${gained.map(r => `<span class="residue-tag">L(${Array.from(r.ligands || []).join(', ')}) ↔ R(${r.chain}:${r.resn}${r.resi})</span>`).join(' ')}</td>
                  </tr>
                  <tr>
                    <td><span class="badge badge-lost">Lost</span></td>
                    <td>${lost.map(r => `<span class="residue-tag">L(${Array.from(r.ligands || []).join(', ')}) ↔ R(${r.chain}:${r.resn}${r.resi})</span>`).join(' ')}</td>
                  </tr>
                </tbody>
              </table>
            `;

            const isSpatiallySimilar = centroidDist < 3.0;
            const spatialText = isSpatiallySimilar 
              ? `The ligand is <strong>spatially consistent</strong> with the reference (Distance: ${centroidDist.toFixed(2)} Å).`
              : `The ligand shows <strong>significant spatial displacement</strong> from the reference (Distance: ${centroidDist.toFixed(2)} Å).`;

            if (parseFloat(conservationRate) > 85 && isSpatiallySimilar) {
              conclusionText = `${spatialText} It exhibits <strong>exceptional stability</strong> with a <strong>${conservationRate}% conservation rate</strong> of the original binding pocket.`;
            } else if (parseFloat(conservationRate) > 60) {
              conclusionText = `${spatialText} It maintains the <strong>core binding architecture</strong> (<strong>${conservationRate}% conservation</strong>). ${gainedCount > lostCount ? 'The newly identified interactions may provide additional stabilization.' : 'The observed loss of interactions might suggest a reduction in binding affinity.'}`;
            } else if (parseFloat(conservationRate) > 30) {
              conclusionText = `${spatialText} The binding pocket shows <strong>moderate reorganization</strong> (<strong>${conservationRate}% conservation</strong>). Significant shifts in the interaction network are observed.`;
            } else {
              conclusionText = `${spatialText} The binding mode has <strong>significantly diverged</strong> from the reference (<strong>${conservationRate}% conservation</strong>). This suggests a major shift in the binding orientation or sub-pocket occupancy.`;
            }
          }
        }

        htmlReport += `
          <div class="card">
            <h2>Modified Variant: ${modFile.name}</h2>
            <div class="section-title">Binding Site Visualization</div>
            <div class="snapshot-container">
              <img src="${snapshot}" class="snapshot" />
            </div>
            <div class="section-title">Ligand Information</div>
            <p style="font-size: 0.9375rem;"><strong>Detected Ligand:</strong> <span style="color: #6366f1; font-weight: 700;">${modAnalysis?.ligandName || "N/A"}</span></p>
            ${modFile.energy !== undefined ? `<p style="font-size: 0.9375rem;"><strong>Energy:</strong> <span style="color: #d97706; font-weight: 700;">${modFile.energy}</span></p>` : ''}
            ${comparisonSection}
            <div class="conclusion">
              <div class="conclusion-title">Analysis Conclusion</div>
              <div class="conclusion-text">${conclusionText || "Insufficient data for comparative conclusion."}</div>
            </div>
          </div>
        `;
      }
    }

    htmlReport += `</body></html>`;

    // Restore state
    setShowInteractions(prevShowInteractions);
    setVisibleFiles(prevVisibleFiles);

    const blob = new Blob([htmlReport], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ProLigand_Analysis_Report_${new Date().getTime()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Calculate differences in pocket residues
  const pocketDiff = useMemo(() => {
    if (!originalFile || modifiedFiles.length === 0) return null;
    const origAnalysis = analysisMap[originalFile.name];
    // Use the first modified file for the summary UI diff
    const modAnalysis = analysisMap[modifiedFiles[0].name];
    if (!origAnalysis || !modAnalysis) return null;
    
    const origKeys = new Set(origAnalysis.interactingResidues.map(r => `${r.chain}${r.resn}${r.resi}`));
    const modKeys = new Set(modAnalysis.interactingResidues.map(r => `${r.chain}${r.resn}${r.resi}`));
    
    const gained = modAnalysis.interactingResidues.filter(r => !origKeys.has(`${r.chain}${r.resn}${r.resi}`));
    const lost = origAnalysis.interactingResidues.filter(r => !modKeys.has(`${r.chain}${r.resn}${r.resi}`));
    const common = origAnalysis.interactingResidues.filter(r => modKeys.has(`${r.chain}${r.resn}${r.resi}`));

    return { gained, lost, common };
  }, [analysisMap, originalFile, modifiedFiles]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-50 text-gray-900 font-sans flex flex-col lg:flex-row">
      {(() => {
        const origAnalysis = originalFile ? analysisMap[originalFile.name] : null;
        const modAnalysis = modifiedFiles.length > 0 ? analysisMap[modifiedFiles[0].name] : null;
        return (
          <>
      {/* Left Sidebar: Controls & Analysis */}
      <div className="w-full lg:w-96 bg-white border-r border-gray-200 flex flex-col shadow-xl z-20 h-full">
        <header className="px-6 py-5 border-b border-gray-100 flex items-center shrink-0">
          <div className="bg-indigo-600 p-2 rounded-lg mr-3 shadow-sm">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-gray-900">ProLigand Analyzer</h1>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">Structure Comparison</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          
          {/* Batch Upload Section */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center">
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Batch Upload
            </h2>
            <div className="relative">
              <input type="file" multiple accept=".pdb,.cif" onChange={handleBatchUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="flex items-center justify-center px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <Upload className="w-4 h-4 text-gray-500 mr-2" />
                <span className="text-xs text-gray-600 font-medium">Upload multiple PDB/CIF files...</span>
              </div>
            </div>
            {files.length > 0 && (
              <div className="flex items-center justify-between mt-1.5">
                <div className="text-[10px] text-gray-500 font-medium">
                  {files.length} file(s) loaded in pool
                </div>
                <button onClick={clearAllFiles} className="text-[9px] font-bold text-red-500 hover:text-red-600 uppercase tracking-wider">
                  Clear All
                </button>
              </div>
            )}
          </div>

          {/* View Settings */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center">
              <Settings2 className="w-3.5 h-3.5 mr-1.5" />
              Visualization & Actions
            </h2>
            <div className="bg-gray-50/50 border border-gray-200 p-2.5 rounded-xl space-y-3">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900">Show Receptor Surface</span>
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={showSurface} onChange={() => setShowSurface(!showSurface)} />
                  <div className={`block w-8 h-4.5 rounded-full transition-colors ${showSurface ? 'bg-indigo-500' : 'bg-gray-300'}`}></div>
                  <div className={`dot absolute left-0.5 top-0.5 bg-white w-3.5 h-3.5 rounded-full transition-transform ${showSurface ? 'transform translate-x-3.5' : ''}`}></div>
                </div>
              </label>

              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900">Show Interactions</span>
                <div className="relative">
                  <input type="checkbox" className="sr-only" checked={showInteractions} onChange={() => setShowInteractions(!showInteractions)} />
                  <div className={`block w-8 h-4.5 rounded-full transition-colors ${showInteractions ? 'bg-indigo-500' : 'bg-gray-300'}`}></div>
                  <div className={`dot absolute left-0.5 top-0.5 bg-white w-3.5 h-3.5 rounded-full transition-transform ${showInteractions ? 'transform translate-x-3.5' : ''}`}></div>
                </div>
              </label>

              <div className="space-y-2 pt-2 border-t border-gray-200">
                <h3 className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Alignment Settings</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-medium text-gray-400 mb-0.5 uppercase">Original Chain</label>
                    <select 
                      value={origAlignChain}
                      onChange={(e) => setOrigAlignChain(e.target.value)}
                      className="w-full px-1.5 py-0.5 text-[10px] border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                      {(originalFile ? detectedLigandsMap[originalFile.name] || [] : []).filter(l => l.type === 'chain').map(c => (
                        <option key={c.chain} value={c.chain}>{c.chain}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-medium text-gray-400 mb-0.5 uppercase">Modified Chain</label>
                    <select 
                      value={modAlignChain}
                      onChange={(e) => setModAlignChain(e.target.value)}
                      className="w-full px-1.5 py-0.5 text-[10px] border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    >
                      {(modifiedFiles.length > 0 ? detectedLigandsMap[modifiedFiles[modifiedFiles.length - 1].name] || [] : []).filter(l => l.type === 'chain').map(c => (
                        <option key={c.chain} value={c.chain}>{c.chain}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button 
                  onClick={() => setIsAligned(!isAligned)}
                  disabled={!originalFile || modifiedFiles.length === 0 || !origAlignChain || !modAlignChain}
                  className={`w-full py-1.5 px-3 ${isAligned ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center shadow-sm`}
                >
                  <Activity className="w-3.5 h-3.5 mr-1.5" />
                  {isAligned ? 'Aligned' : 'Align Structures'}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={resetSettings}
                    className="py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors flex items-center justify-center border border-gray-200"
                  >
                    Reset
                  </button>
                  <button 
                    onClick={analyzeAndRank}
                    disabled={!originalFile || modifiedFiles.length === 0}
                    className="py-1.5 px-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center shadow-sm"
                  >
                    <Zap className="w-3.5 h-3.5 mr-1" />
                    Rank
                  </button>
                </div>
                <button 
                  onClick={generateReport}
                  disabled={selectedForReport.size === 0}
                  className="w-full py-1.5 px-3 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center shadow-md"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Generate Report ({selectedForReport.size})
                </button>
              </div>
            </div>
          </div>

          {/* Layer Manager Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5" />
                Layer Manager
              </h2>
              <div className="flex items-center gap-2">
                {files.length > 0 && (
                  <button 
                    onClick={() => {
                      const allSelected = files.every(f => selectedForReport.has(f.name));
                      if (allSelected) setSelectedForReport(new Set());
                      else setSelectedForReport(new Set(files.map(f => f.name)));
                    }}
                    className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 uppercase tracking-tight"
                  >
                    {files.every(f => selectedForReport.has(f.name)) ? 'Deselect' : 'Select All'}
                  </button>
                )}
                {modifiedFiles.length > 0 && (
                  <button 
                    onClick={() => {
                      const allVisible = modifiedFiles.every(f => visibleFiles.has(f.name));
                      if (allVisible) {
                        setVisibleFiles(prev => {
                          const next = new Set(prev);
                          modifiedFiles.forEach(f => next.delete(f.name));
                          return next;
                        });
                      } else {
                        setVisibleFiles(prev => {
                          const next = new Set(prev);
                          modifiedFiles.forEach(f => next.add(f.name));
                          return next;
                        });
                      }
                    }}
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border transition-all ${modifiedFiles.every(f => visibleFiles.has(f.name)) ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}
                  >
                    {modifiedFiles.every(f => visibleFiles.has(f.name)) ? 'Hide MODs' : 'Show MODs'}
                  </button>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              {files.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                  <Layers className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-[10px] text-gray-400 font-medium">No files loaded yet</p>
                </div>
              ) : (
                    files.map((file) => {
                      const isOriginal = originalFile?.name === file.name;
                      const modIdx = modifiedFiles.findIndex(f => f.name === file.name);
                      const isModified = modIdx !== -1;
                      const isVisible = visibleFiles.has(file.name);
                      const isExpanded = expandedFiles.has(file.name);
                      const isSelectedForReport = selectedForReport.has(file.name);
                      
                      let roleColorClass = "text-gray-400 bg-gray-50 border-gray-100";
                      let eyeColorClass = "text-gray-300 hover:text-gray-500";
                      let bgColor = "bg-white";
                      let borderColor = "border-gray-100";
                      let accentColor = "bg-gray-400";

                      if (isOriginal) { 
                        roleColorClass = "bg-blue-600 text-white border-blue-600";
                        if (isVisible) eyeColorClass = "text-blue-600";
                        bgColor = "bg-blue-50/40";
                        borderColor = "border-blue-200";
                        accentColor = "bg-blue-500";
                      }
                      else if (isModified) { 
                        const color = MOD_COLORS[modIdx % MOD_COLORS.length];
                        roleColorClass = `${color.bg} ${color.text} ${color.border}`;
                        if (isVisible) eyeColorClass = color.text;
                        bgColor = color.bg.replace('bg-', 'bg-opacity-10 bg-');
                        borderColor = color.border;
                        accentColor = color.bg.replace('bg-', 'bg-');
                      }

                      return (
                        <div key={file.name} className={`group border rounded-xl transition-all duration-200 shadow-sm hover:shadow-md ${bgColor} ${borderColor}`}>
                          <div className="p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center space-x-2 min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelectedForReport}
                                    onChange={() => toggleReportSelection(file.name)}
                                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer transition-transform hover:scale-110"
                                  />
                                  <button 
                                    onClick={() => toggleVisibility(file.name)}
                                    className={`p-1 rounded-lg transition-all ${isVisible ? 'bg-white shadow-sm' : 'hover:bg-gray-100'} ${eyeColorClass}`}
                                  >
                                    {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs font-bold break-all text-gray-800 block leading-tight" title={file.name}>{file.name}</span>
                                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                    {isOriginal && <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest">Reference</span>}
                                    {isModified && <span className="text-[8px] font-black text-indigo-600 uppercase tracking-widest">Variant</span>}
                                    {file.energy !== undefined && (
                                      <span className="text-[8px] font-bold text-amber-700 bg-amber-100/80 px-1 rounded-sm border border-amber-200/50">
                                        Energy: {file.energy}
                                      </span>
                                    )}
                                    {rankDetailsMap[file.name] && (
                                      <span className="text-[8px] font-bold text-emerald-700 bg-emerald-100/80 px-1 rounded-sm border border-emerald-200/50" title={`RMSD: ${rankDetailsMap[file.name].rmsd?.toFixed(2) || 'N/A'}, Energy: ${rankDetailsMap[file.name].energy}, Interactions: ${rankDetailsMap[file.name].interactionScore}`}>
                                        Score: {rankDetailsMap[file.name].totalScore.toFixed(1)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center bg-gray-100/80 rounded-lg p-0.5 border border-gray-200 shadow-inner">
                                <button 
                                  onClick={() => {
                                    if (isOriginal) {
                                      setOriginalFile(null);
                                      setModifiedFiles([]);
                                    } else {
                                      setOriginalFile(file);
                                      setModifiedFiles(files.filter(f => f.name !== file.name));
                                    }
                                  }}
                                  className={`px-2 py-0.5 text-[9px] font-black rounded-md transition-all ${isOriginal ? 'bg-blue-600 text-white shadow-sm scale-105' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                  ORIG
                                </button>
                                <button 
                                  onClick={() => {
                                    if (isModified) {
                                      setModifiedFiles(prev => prev.filter(f => f.name !== file.name));
                                    } else {
                                      setModifiedFiles(prev => [...prev, file]);
                                      if (originalFile?.name === file.name) setOriginalFile(null);
                                    }
                                  }}
                                  className={`px-2 py-0.5 text-[9px] font-black rounded-md transition-all ${isModified ? 'bg-indigo-600 text-white shadow-sm scale-105' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                  MOD
                                </button>
                              </div>

                              <button onClick={() => removeFile(file.name)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                              <button 
                                onClick={() => toggleExpand(file.name)}
                                className="flex-1 flex items-center justify-between py-1 px-2 bg-white/60 rounded-lg border border-gray-200/50 hover:bg-white transition-all text-left"
                              >
                                <div className="flex items-center">
                                  <div className={`w-1 h-1 rounded-full ${accentColor} mr-1.5 shadow-sm animate-pulse`}></div>
                                  <span className="text-[9px] font-bold text-gray-600 uppercase tracking-tight">Ligands</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-medium text-gray-400">
                                    {(selectedLigandsMap[file.name] || []).length}
                                  </span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
                                </div>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="mt-2 pt-2 border-t border-gray-200/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                {detectedLigandsMap[file.name]?.length > 0 ? (
                                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-inner">
                                    <select 
                                      multiple
                                      value={(selectedLigandsMap[file.name] || []).map(l => l.label)}
                                      onChange={(e) => {
                                        const selectedOptions = Array.from(e.currentTarget.selectedOptions).map(opt => (opt as HTMLOptionElement).value);
                                        const ligands = detectedLigandsMap[file.name] || [];
                                        setSelectedLigandsMap(prev => ({ ...prev, [file.name]: ligands.filter(l => selectedOptions.includes(l.label)) }));
                                      }}
                                      className="w-full px-1.5 py-0.5 text-[10px] border-none focus:ring-0 bg-transparent min-h-[60px] custom-scrollbar font-medium text-gray-700"
                                    >
                                      <optgroup label="Small Molecules" className="font-bold text-indigo-600 bg-indigo-50/30">
                                        {detectedLigandsMap[file.name].filter(l => l.type === 'residue').map(lig => (
                                          <option key={lig.label} value={lig.label} className="py-0.5 px-1.5 hover:bg-indigo-50 cursor-pointer">
                                            {lig.label}
                                          </option>
                                        ))}
                                      </optgroup>
                                      <optgroup label="Peptide Chains" className="font-bold text-emerald-600 bg-emerald-50/30">
                                        {detectedLigandsMap[file.name].filter(l => l.type === 'chain').map(lig => (
                                          <option key={lig.label} value={lig.label} className="py-0.5 px-1.5 hover:bg-emerald-50 cursor-pointer">
                                            Chain {lig.label}
                                          </option>
                                        ))}
                                      </optgroup>
                                    </select>
                                    <div className="px-1.5 py-0.5 bg-gray-50 border-t border-gray-100 text-[8px] text-gray-400 text-center italic">
                                      Ctrl/Cmd to multi-select
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-[9px] text-amber-600 bg-amber-50 rounded-lg p-1.5 border border-amber-100 text-center font-medium italic">
                                    No ligands detected
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
              )}
            </div>
          </div>

          {/* Intelligent Analysis Panel */}
          {(origAnalysis || modAnalysis) && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center">
                <Zap className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
                Interaction Analysis
              </h2>
              
              <div className="space-y-4">
                {pocketDiff ? (
                  <>
                    {pocketDiff.gained.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-pink-600 mb-2 flex items-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-pink-500 mr-1.5"></span>
                          New Interactions (Modified)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {pocketDiff.gained.map(r => (
                            <span key={`${r.chain}${r.resn}${r.resi}`} className="px-2 py-1 bg-pink-50 text-pink-700 text-[10px] rounded border border-pink-100 font-mono" title={Array.from(r.types).join(', ')}>
                              L({Array.from(r.ligands || []).join(',')}) ↔ R({r.chain}:{r.resn}{r.resi})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {pocketDiff.lost.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-blue-600 mb-2 flex items-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5"></span>
                          Lost Interactions (Original)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {pocketDiff.lost.map(r => (
                            <span key={`${r.chain}${r.resn}${r.resi}`} className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] rounded border border-blue-100 font-mono line-through opacity-70" title={Array.from(r.types).join(', ')}>
                              L({Array.from(r.ligands || []).join(',')}) ↔ R({r.chain}:{r.resn}{r.resi})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {pocketDiff.common.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold text-gray-600 mb-2 flex items-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mr-1.5"></span>
                          Conserved Interactions
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {pocketDiff.common.map(r => (
                            <span key={`${r.chain}${r.resn}${r.resi}`} className="px-2 py-1 bg-gray-100 text-gray-700 text-[10px] rounded border border-gray-200 font-mono" title={Array.from(r.types).join(', ')}>
                              L({Array.from(r.ligands || []).join(',')}) ↔ R({r.chain}:{r.resn}{r.resi})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    {origAnalysis && (
                      <div>
                        <h3 className="text-xs font-bold text-blue-600 mb-2">Original Interactions</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {origAnalysis.interactingResidues.map(r => (
                            <span key={`${r.chain}${r.resn}${r.resi}`} className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] rounded border border-blue-100 font-mono" title={Array.from(r.types).join(', ')}>
                              L({Array.from(r.ligands || []).join(',')}) ↔ R({r.chain}:{r.resn}{r.resi})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {modAnalysis && (
                      <div>
                        <h3 className="text-xs font-bold text-pink-600 mb-2">Modified Interactions</h3>
                        <div className="flex flex-wrap gap-1.5">
                          {modAnalysis.interactingResidues.map(r => (
                            <span key={`${r.chain}${r.resn}${r.resi}`} className="px-2 py-1 bg-pink-50 text-pink-700 text-[10px] rounded border border-pink-100 font-mono" title={Array.from(r.types).join(', ')}>
                              L({Array.from(r.ligands || []).join(',')}) ↔ R({r.chain}:{r.resn}{r.resi})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Area: 3D Viewer */}
      <div className="flex-1 relative bg-white">
        <Viewer3D 
          ref={viewer3DRef}
          originalFile={originalFile}
          modifiedFiles={modifiedFiles}
          selectedLigandsMap={selectedLigandsMap}
          visibleFiles={visibleFiles}
          showSurface={showSurface}
          showInteractions={showInteractions}
          isAligned={isAligned}
          origAlignChain={origAlignChain}
          modAlignChain={modAlignChain}
          onLigandsDetected={handleLigandsDetected}
          onAnalysisComplete={handleAnalysisComplete}
        />
        
        {/* Floating Action Toolbar */}
        <div className="absolute bottom-6 left-6 flex flex-col items-center bg-white/80 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-1.5 z-30 space-y-1">
          <button 
            onClick={handleResetView}
            className="p-2.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all group relative flex items-center justify-center"
            title="Reset View"
          >
            <RotateCcw className="w-5 h-5" />
            <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900/90 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-bold uppercase tracking-widest shadow-lg">
              Reset View
            </span>
          </button>

          <div className="w-8 h-px bg-gray-200/50 mx-auto" />

          {/* Saved View Slots */}
          <div className="flex flex-col space-y-1">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className="flex items-center space-x-1 group/slot">
                <button 
                  onClick={() => handleSaveView(idx)}
                  className={`p-1.5 rounded-lg transition-all flex items-center justify-center ${savedViews[idx] ? 'text-indigo-400 hover:text-indigo-600' : 'text-gray-400 hover:text-gray-600'} hover:bg-gray-100`}
                  title={`Save to Slot ${idx + 1}`}
                >
                  <BookmarkPlus className="w-4 h-4" />
                </button>
                {savedViews[idx] && (
                  <button 
                    onClick={() => handleRestoreView(idx)}
                    className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-all flex items-center justify-center"
                    title={`Restore Slot ${idx + 1}`}
                  >
                    <Bookmark className="w-4 h-4 fill-indigo-600" />
                  </button>
                )}
                <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900/90 text-white text-[10px] rounded-lg opacity-0 group-hover/slot:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-bold uppercase tracking-widest shadow-lg">
                  Slot {idx + 1} {savedViews[idx] ? '(Saved)' : '(Empty)'}
                </span>
              </div>
            ))}
          </div>
          
          <div className="w-8 h-px bg-gray-200/50 mx-auto" />
          
          <button 
            onClick={takeSnapshot}
            className="p-2.5 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all group relative flex items-center justify-center"
            title="Take Snapshot"
          >
            <Camera className="w-5 h-5" />
            <span className="absolute left-full ml-3 px-2 py-1 bg-gray-900/90 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-bold uppercase tracking-widest shadow-lg">
              Save PNG
            </span>
          </button>
        </div>
      </div>
          </>
        );
      })()}
    </div>
  );
}
