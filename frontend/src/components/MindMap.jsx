import { useCallback, useEffect, useRef, useState } from "react";
import { FiMaximize, FiMinus, FiPlus } from "react-icons/fi";

import { ICON_BTN } from "../hooks/Ui.js";

// A three-level mind map (centre -> branches -> leaves) drawn as SVG.
// Drag to pan, buttons to zoom, click a branch to fold or unfold it.
const ROW = 48;
const X = { root: 0, branch: 205, leaf: 430 };
const W = { root: 150, branch: 175, leaf: 200 };
const NODE_H = 34;
const WIDTH = X.leaf + W.leaf;

function layout(map, folded) {
  let row = 0;
  const branches = map.branches.map((b, i) => {
    const start = row;
    const shown = folded.has(i) ? [] : b.children;
    const leaves = shown.map((label) => ({ label, y: row++ * ROW + ROW / 2 }));
    if (leaves.length === 0) row += 1;
    const y = leaves.length ? (leaves[0].y + leaves[leaves.length - 1].y) / 2 : start * ROW + ROW / 2;
    return { label: b.label, y, leaves, count: b.children.length };
  });
  const height = Math.max(row, 1) * ROW;
  return { branches, height, rootY: height / 2 };
}

const curve = (x1, y1, x2, y2) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

const TONE = {
  root: "bg-[#C85A32] text-white font-medium shadow-sm dark:bg-[#D97757] dark:text-[#141312]",
  branch:
    "bg-[#C85A32]/12 text-[#1C1917] font-medium hover:bg-[#C85A32]/20 dark:bg-[#D97757]/20 dark:text-[#F5F2EB] dark:hover:bg-[#D97757]/30",
  leaf: "border border-[#E6E1D6] bg-[#FFFFFF] text-[#292524] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#E7E5E4]",
};

function Node({ x, y, width, label, tone, badge, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <foreignObject x={x} y={y - NODE_H / 2} width={width} height={NODE_H}>
      <Tag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        onPointerDown={onClick ? (e) => e.stopPropagation() : undefined}
        title={label}
        className={`flex h-full w-full items-center justify-center gap-1.5 overflow-hidden rounded-full px-3 text-center text-[11px] leading-tight ${
          onClick ? "cursor-pointer" : ""
        } ${TONE[tone]}`}
      >
        <span className="line-clamp-2">{label}</span>
        {badge && <span className="shrink-0 rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/15">{badge}</span>}
      </Tag>
    </foreignObject>
  );
}

export default function MindMap({ map, tall = false }) {
  const [folded, setFolded] = useState(() => new Set());
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const box = useRef(null);
  const drag = useRef(null);

  const { branches, height, rootY } = layout(map, folded);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !el.clientWidth) return;
    const k = Math.min(1.2, (el.clientWidth - 32) / WIDTH, (el.clientHeight - 32) / height);
    setView({ k, x: (el.clientWidth - WIDTH * k) / 2, y: Math.max(16, (el.clientHeight - height * k) / 2) });
  }, [height]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fit();
  }, [fit, tall]);

  const zoom = (f) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.3, v.k * f)) }));
  const toggle = (i) =>
    setFolded((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const down = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#E6E1D6] bg-[#FAF8F5] dark:border-[#2A2826] dark:bg-[#141312]">
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={`${tall ? "h-[68vh]" : "h-[420px]"} cursor-grab touch-none active:cursor-grabbing`}
      >
        <svg width="100%" height="100%" role="img" aria-label={`Mind map: ${map.title}`}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <g fill="none" strokeWidth="1.5" className="stroke-[#D6CFC2] dark:stroke-[#3A3734]">
              {branches.map((b, i) => (
                <g key={i}>
                  <path d={curve(X.root + W.root, rootY, X.branch, b.y)} />
                  {b.leaves.map((l, j) => (
                    <path key={j} d={curve(X.branch + W.branch, b.y, X.leaf, l.y)} />
                  ))}
                </g>
              ))}
            </g>
            <Node x={X.root} y={rootY} width={W.root} label={map.title} tone="root" />
            {branches.map((b, i) => (
              <g key={i}>
                <Node
                  x={X.branch}
                  y={b.y}
                  width={W.branch}
                  label={b.label}
                  tone="branch"
                  badge={b.count ? (folded.has(i) ? `+${b.count}` : "−") : undefined}
                  onClick={b.count ? () => toggle(i) : undefined}
                />
                {b.leaves.map((l, j) => (
                  <Node key={j} x={X.leaf} y={l.y} width={W.leaf} label={l.label} tone="leaf" />
                ))}
              </g>
            ))}
          </g>
        </svg>
      </div>

      <div className="absolute bottom-3 right-3 flex flex-col rounded-full border border-[#E6E1D6] bg-[#FFFFFF] p-0.5 shadow-sm dark:border-[#2A2826] dark:bg-[#1C1B19]">
        <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in" className={ICON_BTN}>
          <FiPlus size={15} />
        </button>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out" className={ICON_BTN}>
          <FiMinus size={15} />
        </button>
        <button type="button" onClick={fit} aria-label="Fit to view" title="Fit to view" className={ICON_BTN}>
          <FiMaximize size={14} />
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-4 text-[10px] text-[#A8A29E]">Drag to move · click a branch to fold it</p>
    </div>
  );
}