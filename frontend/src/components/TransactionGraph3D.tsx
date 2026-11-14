import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import type { Alert, TransactionEdge } from '@tracelayer/aml-engine';

interface TransactionGraph3DProps {
  edges: TransactionEdge[];
  highlightedAlert?: Alert | null;
  flaggedAccounts?: Set<string>;
  replayStep?: number | null; // 1-based step for Chronological Hop-by-Hop Replay
  height?: number;
  title?: string;
  testId?: string;
}

interface Node3D {
  id: string;
  x: number;
  y: number;
  z: number;
  baseRadius: number;
  role: 'hub' | 'flagged' | 'related';
  txCount: number;
  volume: number;
  sx: number;
  sy: number;
  scale: number;
  pz: number;
}

export function TransactionGraph3D({
  edges,
  highlightedAlert = null,
  flaggedAccounts,
  replayStep = null,
  height = 360,
  title = '3D Transaction Graph',
  testId = 'graph-3d-canvas',
}: TransactionGraph3DProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoveredInfo, setHoveredInfo] = useState<{
    id: string;
    txCount: number;
    volume: number;
    x: number;
    y: number;
  } | null>(null);

  const cameraRef = useRef({
    rotX: 0.2,
    rotY: -0.22,
    targetRotX: 0.2,
    targetRotY: -0.22,
    zoom: 1.08,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    hoveredId: null as string | null,
  });

  const graphLayout = useMemo(() => {
    const alertAccs = new Set(highlightedAlert?.accounts ?? []);
    const alertTxs = new Set(highlightedAlert?.tx_ids ?? []);
    const flaggedSet = flaggedAccounts ?? new Set<string>();

    const visibleEdges = edges.slice(0, 95);
    const nodeIds = Array.from(
      new Set(visibleEdges.flatMap((e) => [e.sender, e.receiver]))
    ).sort();

    const stats = new Map<string, { txCount: number; volume: number }>();
    for (const e of visibleEdges) {
      const s = stats.get(e.sender) ?? { txCount: 0, volume: 0 };
      s.txCount += 1;
      s.volume += e.amount;
      stats.set(e.sender, s);

      const r = stats.get(e.receiver) ?? { txCount: 0, volume: 0 };
      r.txCount += 1;
      r.volume += e.amount;
      stats.set(e.receiver, r);
    }

    const hubId =
      (highlightedAlert?.evidence?.hub_account as string | undefined) ??
      highlightedAlert?.accounts?.[0] ??
      nodeIds[0];

    const nodes: Node3D[] = nodeIds.map((id, i) => {
      const st = stats.get(id) ?? { txCount: 0, volume: 0 };
      const isHub = id === hubId && alertAccs.has(id);
      const isFlagged = alertAccs.has(id) || flaggedSet.has(id);

      const phi = (i / Math.max(1, nodeIds.length)) * Math.PI * 2 * 2.4;
      const theta = ((i % 7) - 3) * 0.34;
      const rad = isHub ? 12 : isFlagged ? 88 : 158;

      return {
        id,
        x: rad * Math.cos(phi) * Math.cos(theta),
        y: rad * Math.sin(theta) * 0.85,
        z: rad * Math.sin(phi) * Math.cos(theta),
        baseRadius: isHub ? 18 : isFlagged ? 12 : 9,
        role: isHub ? 'hub' : isFlagged ? 'flagged' : 'related',
        txCount: st.txCount,
        volume: st.volume,
        sx: 0,
        sy: 0,
        scale: 1,
        pz: 0,
      };
    });

    const idxById = new Map(nodes.map((n, i) => [n.id, i]));

    // Determine chronological replay order for motif edges
    const motifOrderedIds = visibleEdges
      .filter((e) => alertTxs.has(e.tx_id))
      .sort((a, b) => a.tsMs - b.tsMs || a.tx_id.localeCompare(b.tx_id))
      .map((e) => e.tx_id);
    const motifOrderMap = new Map(motifOrderedIds.map((id, idx) => [id, idx + 1]));

    const projectedEdges = visibleEdges
      .map((e) => ({
        a: idxById.get(e.sender) ?? 0,
        b: idxById.get(e.receiver) ?? 0,
        tx_id: e.tx_id,
        amount: e.amount,
        isMotif: alertTxs.has(e.tx_id),
        motifStep: motifOrderMap.get(e.tx_id) ?? null,
      }))
      .filter((e) => e.a !== e.b);

    const pulses = projectedEdges.map((e, i) => ({
      edgeIdx: i,
      p: (i * 0.17) % 1,
      speed: e.isMotif ? 0.009 : 0.0045,
    }));

    return { nodes, projectedEdges, pulses };
  }, [edges, highlightedAlert, flaggedAccounts]);

  const propsRef = useRef({ graphLayout, replayStep });
  propsRef.current = { graphLayout, replayStep };

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let heightPx = 0;
    let rafId = 0;
    let time = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = stage.clientWidth;
      heightPx = stage.clientHeight;
      if (width === 0 || heightPx === 0) return;
      canvas.width = width * dpr;
      canvas.height = heightPx * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const project = (x: number, y: number, z: number) => {
      const cam = cameraRef.current;
      const cosY = Math.cos(cam.rotY);
      const sinY = Math.sin(cam.rotY);
      const cosX = Math.cos(cam.rotX);
      const sinX = Math.sin(cam.rotX);

      const x1 = x * cosY - z * sinY;
      const z1 = z * cosY + x * sinY;
      const y2 = y * cosX - z1 * sinX;
      const z2 = z1 * cosX + y * sinX;

      const fov = 460 * cam.zoom;
      const dist = 410 + z2;
      const scale = fov / Math.max(120, dist);

      return {
        x: width * 0.5 + x1 * scale,
        y: heightPx * 0.5 + y2 * scale,
        scale,
        z: z2,
      };
    };

    let lastDraw = 0;
    const drawFrame = (now: number) => {
      const cam = cameraRef.current;
      const frameBudget = cam.isDragging ? 16 : 33;
      if (prefersReduced || now - lastDraw >= frameBudget) {
        lastDraw = now;
        if (width > 0 && heightPx > 0) {
          const { graphLayout: gl, replayStep: step } = propsRef.current;

          if (!prefersReduced) {
            time += 0.028;
            if (!cam.isDragging) {
              cam.targetRotY += 0.0024;
            }
          }
          cam.rotX += (cam.targetRotX - cam.rotX) * 0.14;
          cam.rotY += (cam.targetRotY - cam.rotY) * 0.14;

        ctx.clearRect(0, 0, width, heightPx);

        // Subtle 3D grid floor
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.07)';
        ctx.lineWidth = 1;
        for (let g = -160; g <= 160; g += 80) {
          const p1 = project(g, 118, -160);
          const p2 = project(g, 118, 160);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();

          const p3 = project(-160, 118, g);
          const p4 = project(160, 118, g);
          ctx.beginPath();
          ctx.moveTo(p3.x, p3.y);
          ctx.lineTo(p4.x, p4.y);
          ctx.stroke();
        }

        // Project 3D nodes
        for (let i = 0; i < gl.nodes.length; i++) {
          const n = gl.nodes[i];
          const floatY = prefersReduced
            ? 0
            : Math.sin(time * 1.3 + i * 0.7) * (n.role === 'hub' ? 1.8 : 4);
          const p = project(n.x, n.y + floatY, n.z);
          n.sx = p.x;
          n.sy = p.y;
          n.scale = p.scale;
          n.pz = p.z;
        }

        // Draw directed edges
        for (const e of gl.projectedEdges) {
          const a = gl.nodes[e.a];
          const b = gl.nodes[e.b];
          if (!a || !b) continue;

          const isReplayActive =
            step !== null && e.motifStep !== null && e.motifStep === step;
          const isReplayPast =
            step !== null && e.motifStep !== null && e.motifStep <= step;
          const isHoveredEdge =
            cam.hoveredId !== null && (a.id === cam.hoveredId || b.id === cam.hoveredId);

          if (isReplayActive) {
            ctx.strokeStyle = 'rgba(74, 222, 128, 0.95)';
            ctx.lineWidth = 2.6;
          } else if (isReplayPast || (step === null && e.isMotif)) {
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.72)';
            ctx.lineWidth = 1.7;
          } else if (isHoveredEdge) {
            ctx.strokeStyle = 'rgba(192, 132, 252, 0.8)';
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = 'rgba(230, 220, 200, 0.14)';
            ctx.lineWidth = 0.85;
          }

          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();

          // Draw arrowhead for motif or hovered edges
          if (isReplayActive || isReplayPast || (step === null && e.isMotif)) {
            const angle = Math.atan2(b.sy - a.sy, b.sx - a.sx);
            const targetR = b.baseRadius * b.scale + 3;
            const ax = b.sx - Math.cos(angle) * targetR;
            const ay = b.sy - Math.sin(angle) * targetR;
            ctx.fillStyle = isReplayActive ? '#4ade80' : '#c084fc';
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - 7 * Math.cos(angle - 0.4), ay - 7 * Math.sin(angle - 0.4));
            ctx.lineTo(ax - 7 * Math.cos(angle + 0.4), ay - 7 * Math.sin(angle + 0.4));
            ctx.closePath();
            ctx.fill();
          }
        }

        // Draw animated pulses along motif/active edges
        if (!prefersReduced) {
          for (const pu of gl.pulses) {
            pu.p = (pu.p + pu.speed) % 1;
            const edge = gl.projectedEdges[pu.edgeIdx];
            if (!edge) continue;
            if (step !== null && (!edge.motifStep || edge.motifStep > step)) continue;

            const a = gl.nodes[edge.a];
            const b = gl.nodes[edge.b];
            if (!a || !b) continue;
            const px = a.sx + (b.sx - a.sx) * pu.p;
            const py = a.sy + (b.sy - a.sy) * pu.p;

            const isActiveStep = step !== null && edge.motifStep === step;
            ctx.fillStyle = isActiveStep
              ? 'rgba(74, 222, 128, 0.95)'
              : edge.isMotif
                ? 'rgba(216, 180, 254, 0.92)'
                : 'rgba(168, 85, 247, 0.35)';
            ctx.beginPath();
            ctx.arc(px, py, isActiveStep ? 3.5 : edge.isMotif ? 2.6 : 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Depth-sort nodes back to front
        const sortedNodes = [...gl.nodes].sort((a, b) => b.pz - a.pz);
        for (const n of sortedNodes) {
          const r = n.baseRadius * n.scale;
          const isHot = cam.hoveredId === n.id;

          if (n.role !== 'related') {
            const haloR = r * (n.role === 'hub' ? 2.3 : 1.85);
            const halo = ctx.createRadialGradient(n.sx, n.sy, r * 0.2, n.sx, n.sy, haloR);
            halo.addColorStop(
              0,
              n.role === 'hub' ? 'rgba(168, 85, 247, 0.52)' : 'rgba(139, 92, 246, 0.3)'
            );
            halo.addColorStop(1, 'rgba(139, 92, 246, 0)');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, haloR, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
          ctx.fillStyle =
            n.role === 'hub'
              ? '#8b5cf6'
              : n.role === 'flagged'
                ? 'rgba(109, 40, 217, 0.85)'
                : 'rgba(230, 220, 200, 0.88)';
          ctx.fill();

          ctx.lineWidth = isHot ? 2.4 : 1.2;
          ctx.strokeStyle = isHot
            ? '#4ade80'
            : n.role === 'related'
              ? '#f5efe2'
              : '#e9d5ff';
          ctx.stroke();
        }

        // Draw hub & hovered node labels on final pass with high-contrast backing
        for (const n of sortedNodes) {
          const r = n.baseRadius * n.scale;
          const isHot = cam.hoveredId === n.id;
          if (n.role === 'hub' || isHot) {
            ctx.font = '600 10.5px "JetBrains Mono", monospace';
            const textWidth = ctx.measureText(n.id).width;
            const lx = n.sx;
            const ly = n.sy - r - 11;
            ctx.fillStyle = 'rgba(11, 19, 15, 0.88)';
            ctx.fillRect(lx - textWidth / 2 - 5, ly - 10, textWidth + 10, 14);
            ctx.fillStyle = '#f3f5f4';
            ctx.textAlign = 'center';
            ctx.fillText(n.id, lx, ly + 1);
          }
        }
        }
      }

      if (!prefersReduced) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    rafId = requestAnimationFrame(drawFrame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [isFullscreen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    cameraRef.current.isDragging = true;
    cameraRef.current.lastX = e.clientX;
    cameraRef.current.lastY = e.clientY;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const cam = cameraRef.current;

    if (cam.isDragging) {
      const dx = e.clientX - cam.lastX;
      const dy = e.clientY - cam.lastY;
      cam.targetRotY += dx * 0.0065;
      cam.targetRotX = Math.max(-0.85, Math.min(0.85, cam.targetRotX + dy * 0.0065));
      cam.lastX = e.clientX;
      cam.lastY = e.clientY;
      return;
    }

    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let nearest: Node3D | null = null;
    let bestDist = 26;
    for (const n of graphLayout.nodes) {
      const d = Math.hypot(mx - n.sx, my - n.sy);
      if (d < bestDist) {
        bestDist = d;
        nearest = n;
      }
    }

    if (nearest) {
      cam.hoveredId = nearest.id;
      setHoveredInfo({
        id: nearest.id,
        txCount: nearest.txCount,
        volume: nearest.volume,
        x: Math.min(rect.width - 175, Math.max(12, nearest.sx + 16)),
        y: Math.min(rect.height - 84, Math.max(12, nearest.sy - 48)),
      });
    } else if (cam.hoveredId !== null) {
      cam.hoveredId = null;
      setHoveredInfo(null);
    }
  };

  const handleMouseUpOrLeave = () => {
    cameraRef.current.isDragging = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    cameraRef.current.zoom = Math.max(
      0.65,
      Math.min(1.85, cameraRef.current.zoom - e.deltaY * 0.0009)
    );
  };

  const handleResetView = () => {
    cameraRef.current.targetRotX = 0.2;
    cameraRef.current.targetRotY = -0.22;
    cameraRef.current.zoom = 1.08;
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-5 z-50 flex flex-col rounded-xl border border-white/15 bg-[#0c1510]/95 shadow-2xl backdrop-blur-xl'
          : 'flex flex-col rounded-xl border border-white/10 bg-[#15201a]/80 backdrop-blur-md'
      }
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[#f3f5f4]">{title}</h3>
          <span className="font-mono text-xs text-[#93a199] tabular-nums">
            {graphLayout.nodes.length} nodes · {graphLayout.projectedEdges.length} edges
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Reset 3D camera"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-[#f3f5f4] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset View
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            aria-label={isFullscreen ? 'Exit fullscreen graph' : 'Expand 3D graph'}
            className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-[#f3f5f4] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-500"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        style={{ height: isFullscreen ? 'calc(100vh - 110px)' : `${height}px` }}
        className="relative w-full cursor-grab select-none overflow-hidden active:cursor-grabbing"
      >
        <canvas ref={canvasRef} data-testid={testId} className="block h-full w-full" />

        <div className="pointer-events-none absolute bottom-3 left-4 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#0d1511]/80 px-3 py-2 text-[11px] text-[#93a199] backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
            <span>Flagged / Motif Account</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#e6dcc8]" />
            <span>1-Hop Context Account</span>
          </div>
          {replayStep !== null && (
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-3 bg-[#4ade80]" />
              <span>Active Replay Hop ({replayStep})</span>
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute right-3 bottom-3 text-[11px] text-[#68776e]">
          Drag to orbit · Scroll to zoom · Hover nodes
        </div>

        {hoveredInfo && (
          <div
            role="status"
            style={{ transform: `translate(${hoveredInfo.x}px, ${hoveredInfo.y}px)` }}
            className="pointer-events-none absolute top-0 left-0 z-10 min-w-[165px] rounded-lg border border-violet-500/50 bg-[#101814]/95 px-3 py-2 shadow-xl backdrop-blur-md"
          >
            <div className="font-mono text-xs font-semibold text-white">
              Account: {hoveredInfo.id}
            </div>
            <div className="mt-1 text-[11px] text-[#93a199] tabular-nums">
              Transactions: <span className="text-[#f3f5f4]">{hoveredInfo.txCount}</span>
            </div>
            <div className="text-[11px] text-[#93a199] tabular-nums">
              Volume:{' '}
              <span className="text-[#f3f5f4]">
                ${hoveredInfo.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
