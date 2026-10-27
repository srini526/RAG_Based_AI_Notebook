import { useEffect, useRef } from "react";
import { FiBookOpen, FiFileText, FiGlobe, FiUploadCloud, FiYoutube } from "react-icons/fi";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";

function EmptyState({ hasReady, starters, onPick }) {
  return (
    <div className="mx-auto my-auto flex max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E6E1D6] bg-[#F3EFEA] text-[#C85A32] shadow-2xs dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#D97757]">
        {hasReady ? <FiBookOpen size={24} /> : <FiUploadCloud size={24} />}
      </div>

      <h2 className="font-serif-editorial mb-2.5 text-2xl font-medium tracking-tight text-[#1C1917] dark:text-[#F5F2EB] sm:text-3xl">
        {hasReady ? "Ask anything about your library" : "Start by adding study material"}
      </h2>

      <p className="max-w-md text-sm leading-relaxed text-[#57534E] dark:text-[#A8A29E]">
        {hasReady
          ? "Every response is grounded in your uploaded materials and cites the exact page, slide, section, or timestamp."
          : "Upload PDFs, Word or PowerPoint files, notes, audio or video, or paste a YouTube or web link in the sidebar to begin."}
      </p>

      {hasReady && starters.length > 0 && (
        <div className="mt-6 flex w-full flex-col items-center gap-2.5">
          {starters.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="w-full max-w-md cursor-pointer rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] px-4 py-2.5 text-left text-sm text-[#292524] transition hover:border-[#C85A32]/60 dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#E7E5E4] dark:hover:border-[#D97757]/60"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {!hasReady && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E1D6] bg-[#F3EFEA]/70 px-3 py-1 dark:border-[#2A2826] dark:bg-[#1C1B19]">
            <FiFileText size={12} className="text-[#C85A32] dark:text-[#D97757]" />
            PDF, DOCX &amp; Slides
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E1D6] bg-[#F3EFEA]/70 px-3 py-1 dark:border-[#2A2826] dark:bg-[#1C1B19]">
            <FiYoutube size={12} className="text-[#C85A32] dark:text-[#D97757]" />
            YouTube &amp; Media
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E6E1D6] bg-[#F3EFEA]/70 px-3 py-1 dark:border-[#2A2826] dark:bg-[#1C1B19]">
            <FiGlobe size={12} className="text-[#C85A32] dark:text-[#D97757]" />
            Web Articles
          </span>
        </div>
      )}
    </div>
  );
}

export default function ChatWindow({
  messages,
  loading,
  hasReady,
  starters,
  onPick,
  onRegenerate,
  onCite,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <main className="flex-1 overflow-y-auto bg-[#FAF8F5] transition-colors duration-200 dark:bg-[#141312]">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8 md:py-10">
        <p role="status" className="sr-only">
          {loading ? "Generating a response…" : ""}
        </p>

        {messages.length === 0 && !loading && (
          <EmptyState hasReady={hasReady} starters={starters} onPick={onPick} />
        )}

        <div className="space-y-6 sm:space-y-8">
          {messages.map((msg, index) => (
            <ChatMessage
              key={index}
              sender={msg.sender}
              message={msg.message}
              sources={msg.sources}
              steps={msg.steps}
              meta={msg.meta}
              error={msg.error}
              stopped={msg.stopped}
              streaming={loading && index === messages.length - 1}
              onRegenerate={!loading && index === messages.length - 1 ? onRegenerate : undefined}
              onCite={onCite}
            />
          ))}

          {loading &&
            messages[messages.length - 1]?.message === "" &&
            !messages[messages.length - 1]?.steps?.length && <TypingIndicator />}
        </div>

        <div ref={bottomRef} className="h-2" />
      </div>
    </main>
  );
}
