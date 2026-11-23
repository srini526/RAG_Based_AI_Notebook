import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { FiCheck, FiCopy } from "react-icons/fi";

// Loaded lazily so the markdown and syntax highlighting stay out of the first bundle.
const PROSE = [
  "prose prose-stone dark:prose-invert max-w-none text-[15px] leading-7",
  "prose-headings:font-serif-editorial prose-headings:font-medium prose-headings:tracking-tight",
  "prose-headings:text-[#1C1917] dark:prose-headings:text-[#F5F2EB] prose-h2:mb-3 prose-h2:mt-8 prose-h3:mb-2 prose-h3:mt-5",
  "prose-p:my-3 prose-p:leading-7 prose-p:text-[#292524] dark:prose-p:text-[#E7E5E4]",
  "prose-li:my-1 prose-li:text-[#292524] dark:prose-li:text-[#E7E5E4] prose-strong:font-semibold",
  "prose-a:text-[#C85A32] prose-a:decoration-[#C85A32]/40 prose-a:underline-offset-2 dark:prose-a:text-[#D97757]",
  "prose-blockquote:border-l-2 prose-blockquote:border-[#C85A32] prose-blockquote:text-[#57534E] dark:prose-blockquote:border-[#D97757]",
  "prose-code:font-mono-code prose-code:text-[13px] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-[#F3EFEA] [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5",
  "dark:[&_:not(pre)>code]:bg-[#24221F]",
  "prose-table:my-0 prose-th:bg-[#F3EFEA] prose-th:px-3 prose-th:py-2 dark:prose-th:bg-[#24221F]",
  "prose-td:px-3 prose-td:py-2",
].join(" ");
const CITE = /\[S[0-9]+\]|【S[0-9]+】/g;
const CHIP =
  "mx-0.5 inline-flex h-4.5 min-w-4.5 cursor-pointer items-center justify-center rounded-md bg-[#C85A32]/12 px-1 align-super text-[10px] font-semibold text-[#C85A32] no-underline transition hover:bg-[#C85A32]/25 dark:bg-[#D97757]/15 dark:text-[#D97757]";

function citeMarkdown({ byId }) {
  return (tree) => {
    function visit(node) {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") {
          visit(child);
          return child;
        }
        const parts = [];
        let start = 0;
        for (const match of child.value.matchAll(CITE)) {
          const id = match[0].slice(1, -1);
          const number = id.slice(1);
          if (match.index > start) parts.push({ type: "text", value: child.value.slice(start, match.index) });
          if (Object.hasOwn(byId, id)) {
            parts.push({ type: "link", url: `cite:${id}`, children: [{ type: "text", value: number }] });
          }
          start = match.index + match[0].length;
        }
        if (start === 0) return child;
        if (start < child.value.length) parts.push({ type: "text", value: child.value.slice(start) });
        return parts;
      });
    }
    if (Object.keys(byId).length) visit(tree);
  };
}

function CodeBlock({ children }) {
  const pre = useRef(null);
  const reset = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => () => window.clearTimeout(reset.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pre.current.textContent.replace(/\n$/, ""));
      setCopied(true);
      window.clearTimeout(reset.current);
      reset.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable.
    }
  };

  return (
    <div className="my-5 overflow-hidden rounded-xl border border-[#E6E1D6] bg-[#F8F5F0] dark:border-[#35322F] dark:bg-[#22201E]">
      <div className="flex justify-end border-b border-[#E6E1D6] px-2 py-1 dark:border-[#35322F]">
        <button type="button" onClick={copy}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-[#57534E] hover:bg-[#EAE4DC] dark:text-[#D6D3D1] dark:hover:bg-[#35322F]">
          {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre ref={pre} className="!m-0 !bg-transparent !p-4 !text-[#292524] dark:!text-[#E7E5E4]">{children}</pre>
    </div>
  );
}

/** Markdown with clickable citations in prose and literal text inside code blocks. */
export default function Markdown({ children, sources = [], onCite }) {
  const byId = Object.fromEntries(sources.map((source) => [source.id, source]));
  const isCitation = (url) => Boolean(url?.startsWith("cite:") && Object.hasOwn(byId, url.slice(5)));

  return (
    <div className={PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [citeMarkdown, { byId }]]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={(url) => (isCitation(url) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children: label, node: _node, ...rest }) =>
            isCitation(href) ? (
              <button type="button" className={CHIP} aria-label={`Open source ${label}`}
                onClick={() => onCite?.(byId[href.slice(5)])}>
                {label}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>{label}</a>
            ),
          pre: CodeBlock,
          table: ({ node: _node, ...props }) => (
            <div role="region" aria-label="Data table" tabIndex={0}
              className="my-5 overflow-x-auto overscroll-x-contain rounded-xl border border-[#E6E1D6] dark:border-[#35322F]">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}