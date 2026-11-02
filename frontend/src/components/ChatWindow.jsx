import { useEffect, useRef } from "react";
import { FiBookOpen, FiUploadCloud } from "react-icons/fi";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";

function EmptyState({ hasReady, starters, onPick }) {
  return (
    <div className="mx-auto my-auto flex w-full max-w-xl flex-col items-center px-4 py-10 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-[#C85A32]/12 text-[#C85A32] dark:bg-[#D97757]/15 dark:text-[#D97757]">
        {hasReady ? <FiBookOpen size={24} /> : <FiUploadCloud size={24} />}
      </span>

      <h3 className="font-serif-editorial text-2xl font-medium tracking-tight text-[#1C1917] sm:text-3xl dark:text-[#F5F2EB]">
        {hasReady ? "Ask anything about your sources" : "Add a source to get started"}
      </h3>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-[#57534E] dark:text-[#A8A29E]">
        {hasReady
          ? "Every answer is grounded in what you added and cites the exact page, slide, section or timestamp."
          : "Upload PDFs, notes, slides, audio or video, or paste a YouTube or website link, then chat with them here."}
      </p>

      {hasReady && starters.length > 0 && (
        <div className="mt-7 flex w-full flex-col gap-2">
          {starters.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="w-full cursor-pointer rounded-2xl border border-[#E6E1D6] bg-[#FFFFFF] px-4 py-3 text-left text-sm text-[#292524] transition hover:border-[#C85A32]/60 hover:bg-[#FAF8F5] dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#E7E5E4] dark:hover:border-[#D97757]/60"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatWindow({ messages, loading, hasReady, starters, onPick, onRegenerate, onCite, outputIds = [], onOpenOutput }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // follow the stream only while the reader is at the bottom

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // A new message (the user just sent one) always jumps to the bottom.
  useEffect(() => {
    stickRef.current = true;
  }, [messages.length]);

  // Streamed tokens only follow if the reader hasn't scrolled up. Instant, not smooth: no jitter.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-4 sm:px-6">
        <p role="status" className="sr-only">
          {loading ? "Generating a response…" : ""}
        </p>

        {messages.length === 0 && !loading && <EmptyState hasReady={hasReady} starters={starters} onPick={onPick} />}

        <div className="space-y-7">
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
              outputExists={Boolean(msg.meta?.studio && outputIds.includes(msg.meta.studio.id))}
              onOpenOutput={onOpenOutput}
            />
          ))}

          {loading &&
            messages[messages.length - 1]?.message === "" &&
            !messages[messages.length - 1]?.steps?.length && <TypingIndicator />}
        </div>

        <div className="h-3" />
      </div>
    </div>
  );
}