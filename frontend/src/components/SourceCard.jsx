import {
  FiClock,
  FiExternalLink,
  FiFileText,
  FiFilm,
  FiGlobe,
  FiMapPin,
  FiMonitor,
  FiMusic,
  FiYoutube,
} from "react-icons/fi";

const KIND = {
  pdf: { icon: FiFileText, label: "PDF" },
  docx: { icon: FiFileText, label: "Word" },
  text: { icon: FiFileText, label: "Text" },
  pptx: { icon: FiMonitor, label: "Slides" },
  audio: { icon: FiMusic, label: "Audio" },
  video: { icon: FiFilm, label: "Video" },
  youtube: { icon: FiYoutube, label: "YouTube" },
  web: { icon: FiGlobe, label: "Web" },
};

export default function SourceCard({ source, onOpen }) {
  const { icon: Icon, label } = KIND[source.kind] || KIND.text;
  const isTimed =
    source.kind === "youtube" || source.kind === "video" || source.kind === "audio";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(source)}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.(source)}
      aria-label={`Show passage from ${source.title}`}
      className="group flex cursor-pointer flex-col justify-between rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] p-3.5 shadow-2xs transition-all duration-150 hover:border-[#D6CFC2] hover:shadow-xs dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#3A3734]">
      <div>
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-[#C85A32]/12 px-1.5 py-0.5 font-mono-code text-[11px] font-medium text-[#C85A32] dark:bg-[#D97757]/15 dark:text-[#D97757]">
              [{source.id}]
            </span>

            <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
              <Icon className="shrink-0 text-[#78716C] dark:text-[#A8A29E]" size={13} />
              <span className="truncate" title={source.title}>
                {source.title}
              </span>
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {source.external ? (
              <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                Web
              </span>
            ) : (
              <span className="rounded-md bg-[#F3EFEA] px-1.5 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#262421] dark:text-[#A8A29E]">
                {label}
              </span>
            )}

            {source.url && (
              <a
                onClick={(e) => e.stopPropagation()}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open source"
                className="rounded-md p-1 text-[#78716C] transition hover:bg-[#F3EFEA] hover:text-[#C85A32] dark:text-[#A8A29E] dark:hover:bg-[#262421] dark:hover:text-[#D97757]"
              >
                <FiExternalLink size={13} />
              </a>
            )}
          </div>
        </div>

        {source.locator && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-[#57534E] dark:text-[#A8A29E]">
            {isTimed ? (
              <FiClock size={11} className="text-[#C85A32] dark:text-[#D97757]" />
            ) : (
              <FiMapPin size={11} className="text-[#C85A32] dark:text-[#D97757]" />
            )}
            <span>{source.locator}</span>
          </p>
        )}

        {source.snippet && (
          <p className="mt-2 line-clamp-2 border-l-2 border-[#E6E1D6] pl-2.5 font-serif-editorial text-xs italic leading-relaxed text-[#57534E] dark:border-[#322F2B] dark:text-[#A8A29E]">
            “{source.snippet}”
          </p>
        )}
      </div>
    </div>
  );
}
