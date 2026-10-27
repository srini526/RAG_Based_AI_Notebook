// A simple three-level mind map (centre -> branches -> leaves) drawn as SVG.
const ROW = 48;
const X = { root: 0, branch: 205, leaf: 430 };
const W = { root: 150, branch: 175, leaf: 200 };
const NODE_H = 34;

function layout(map) {
  let row = 0;
  const branches = map.branches.map((b) => {
    const start = row;
    const leaves = b.children.map((label) => ({ label, y: row++ * ROW + ROW / 2 }));
    if (leaves.length === 0) row += 1;
    const y = leaves.length ? (leaves[0].y + leaves[leaves.length - 1].y) / 2 : start * ROW + ROW / 2;
    return { label: b.label, y, leaves };
  });
  const height = Math.max(row, 1) * ROW;
  return { branches, height, rootY: height / 2 };
}

const curve = (x1, y1, x2, y2) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

function Node({ x, y, width, label, tone }) {
  const styles = {
    root: "bg-[#C85A32] text-white dark:bg-[#D97757] dark:text-[#141312] font-medium",
    branch: "bg-[#C85A32]/12 text-[#1C1917] dark:bg-[#D97757]/20 dark:text-[#F5F2EB] font-medium",
    leaf: "border border-[#E6E1D6] bg-[#FFFFFF] text-[#292524] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#E7E5E4]",
  }[tone];
  return (
    <foreignObject x={x} y={y - NODE_H / 2} width={width} height={NODE_H}>
      <div
        title={label}
        className={`flex h-full items-center justify-center overflow-hidden rounded-lg px-2 text-center text-[11px] leading-tight ${styles}`}
      >
        <span className="line-clamp-2">{label}</span>
      </div>
    </foreignObject>
  );
}

export default function MindMap({ map }) {
  const { branches, height, rootY } = layout(map);
  const width = X.leaf + W.leaf;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] p-3 dark:border-[#2A2826] dark:bg-[#1C1B19]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Mind map: ${map.title}`}
        className="min-w-[560px]"
      >
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
            <Node x={X.branch} y={b.y} width={W.branch} label={b.label} tone="branch" />
            {b.leaves.map((l, j) => (
              <Node key={j} x={X.leaf} y={l.y} width={W.leaf} label={l.label} tone="leaf" />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
