import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Loaded lazily so the markdown + syntax-highlighting code is not in the first bundle.
const PROSE = "prose prose-stone dark:prose-invert max-w-none text-[15px] leading-7 prose-headings:font-serif-editorial prose-headings:font-medium prose-headings:tracking-tight prose-headings:text-[#1C1917] dark:prose-headings:text-[#F5F2EB] prose-p:text-[#292524] dark:prose-p:text-[#E7E5E4] prose-p:leading-7 prose-li:text-[#292524] dark:prose-li:text-[#E7E5E4] prose-strong:font-semibold prose-strong:text-[#1C1917] dark:prose-strong:text-[#F5F2EB] prose-a:text-[#C85A32] prose-a:underline prose-a:decoration-[#C85A32]/40 prose-a:underline-offset-2 hover:prose-a:decoration-[#C85A32] dark:prose-a:text-[#D97757] dark:prose-a:decoration-[#D97757]/40 prose-blockquote:border-l-2 prose-blockquote:border-[#C85A32] prose-blockquote:text-[#57534E] dark:prose-blockquote:border-[#D97757] dark:prose-blockquote:text-[#A8A29E] prose-code:font-mono-code prose-code:text-[13px] prose-code:font-normal prose-code:text-[#9A3412] prose-code:bg-[#F3EFEA] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none dark:prose-code:text-[#FDBA74] dark:prose-code:bg-[#24221F] prose-pre:bg-[#F3EFEA] prose-pre:border prose-pre:border-[#E6E1D6] prose-pre:rounded-xl prose-pre:p-4 prose-pre:shadow-2xs dark:prose-pre:bg-[#1C1B19] dark:prose-pre:border-[#2A2826] prose-table:border prose-table:border-[#E6E1D6] dark:prose-table:border-[#2A2826] prose-th:bg-[#F3EFEA] prose-th:text-[#1C1917] prose-th:border prose-th:border-[#E6E1D6] prose-th:px-3 prose-th:py-2 dark:prose-th:bg-[#1C1B19] dark:prose-th:text-[#F5F2EB] dark:prose-th:border-[#2A2826] prose-td:border prose-td:border-[#E6E1D6] prose-td:px-3 prose-td:py-2 dark:prose-td:border-[#2A2826]";
const CITE = /\[S(\d+)\]/g;
const CHIP =
  "mx-0.5 inline-flex h-4.5 min-w-4.5 cursor-pointer items-center justify-center rounded-md bg-[#C85A32]/12 px-1 align-super text-[10px] font-semibold text-[#C85A32] no-underline transition hover:bg-[#C85A32]/25 dark:bg-[#D97757]/15 dark:text-[#D97757]";

/** Markdown where [S1]-style citations become buttons that open the cited passage. */
export default function Markdown({ children, sources = [], onCite }) {
  const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
  const text = children.replace(CITE, (match, n) => (byId[`S${n}`] ? `[${n}](cite:S${n})` : match));

  return (
    <div className={PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={(url) => (url.startsWith("cite:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children: label, node: _node, ...rest }) =>
            href?.startsWith("cite:") ? (
              <button
                type="button"
                className={CHIP}
                aria-label={`Open source ${label}`}
                onClick={() => onCite?.(byId[href.slice(5)])}
              >
                {label}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
                {label}
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
