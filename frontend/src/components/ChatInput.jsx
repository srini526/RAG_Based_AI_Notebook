import { useState, useRef, useEffect } from "react";
import { FiCheck, FiChevronDown } from "react-icons/fi";
import { FiArrowUp, FiSquare, FiX } from "react-icons/fi";

const MODES = [
  { id: "normal", label: "Standard answers" },
  { id: "simple", label: "Explain simply" },
  { id: "exam", label: "Exam notes" },
  { id: "deep", label: "Deep dive" },
];

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-[#E6E1D6] bg-[#F3EFEA]/70 px-2.5 py-1 text-xs text-[#57534E] transition dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#A8A29E]";

export default function ChatInput({
  onSend,
  onStop,
  loading,
  disabled,
  mode,
  setMode,
  scopeCount = 0,
  onClearScope,
}) {
  const [question, setQuestion] = useState("");
  const [modeOpen, setModeOpen] = useState(false);
const modeRef = useRef(null);

useEffect(() => {
  const handleClickOutside = (event) => {
    if (modeRef.current && !modeRef.current.contains(event.target)) {
      setModeOpen(false);
    }
  };

  const handleEscape = (event) => {
    if (event.key === "Escape") setModeOpen(false);
  };

  document.addEventListener("mousedown", handleClickOutside);
  document.addEventListener("keydown", handleEscape);

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleEscape);
  };
}, []);

  const blocked = loading || disabled;

  const handleSubmit = () => {
    if (!question.trim() || blocked) return;
    onSend(question);
    setQuestion("");
  };

  return (
    <div className="border-t border-[#E6E1D6] bg-[#FAF8F5]/90 px-4 py-3.5 backdrop-blur-md transition-colors duration-200 dark:border-[#2A2826] dark:bg-[#141312]/90 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">

<div className="relative ml-auto" ref={modeRef}>
  <button
    type="button"
    aria-label="Choose answer style"
    aria-expanded={modeOpen}
    onClick={() => setModeOpen((open) => !open)}
    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#35312D] bg-[#211F1D] px-3.5 py-2 text-xs font-medium text-[#E7DFD5] shadow-sm transition hover:border-[#625044] hover:bg-[#292522] focus:outline-none focus:ring-2 focus:ring-[#D97757]/30 dark:border-[#35312D] dark:bg-[#211F1D] dark:text-[#E7DFD5]"
  >
    {MODES.find((m) => m.id === mode)?.label ?? "Standard answers"}
    <FiChevronDown
      size={14}
      className={`transition-transform duration-200 ${modeOpen ? "rotate-180" : ""}`}
    />
  </button>

  {modeOpen && (
    <div className="absolute bottom-full right-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-[#39332E] bg-[#211F1D] p-1.5 shadow-2xl shadow-black/30">
      <p className="px-3 pb-2 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#96897D]">
        Answer style
      </p>

      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => {
            setMode(m.id);
            setModeOpen(false);
          }}
          className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
            mode === m.id
              ? "bg-[#3A2A23] text-[#F0A080]"
              : "text-[#DDD5CC] hover:bg-[#302B27] hover:text-white"
          }`}
        >
          <span>{m.label}</span>
          {mode === m.id && <FiCheck size={15} />}
        </button>
      ))}
    </div>
  )}
</div>


          {scopeCount > 0 && (
            <button type="button" onClick={onClearScope} className={`${CHIP} cursor-pointer`}>
              Only {scopeCount} selected {scopeCount === 1 ? "source" : "sources"}
              <FiX size={12} aria-label="Search all sources again" />
            </button>
          )}
        </div>

        <div
          className={`flex items-center gap-2 rounded-2xl border bg-[#FFFFFF] p-1.5 pl-4 shadow-xs transition-all duration-150 dark:bg-[#1C1B19] ${
            disabled
              ? "border-[#E6E1D6] opacity-75 dark:border-[#2A2826]"
              : "border-[#D6CFC2] focus-within:border-[#C85A32] focus-within:ring-3 focus-within:ring-[#C85A32]/12 dark:border-[#322F2B] dark:focus-within:border-[#D97757] dark:focus-within:ring-[#D97757]/15"
          }`}
        >
          <input
            type="text"
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleSubmit()}
            placeholder={
              disabled
                ? "Add a source to start asking…"
                : "Ask about your sources…"
            }
            aria-label="Your question"
            disabled={blocked}
            className="flex-1 bg-transparent py-2 text-sm text-[#1C1917] outline-none placeholder:text-[#A8A29E] disabled:cursor-not-allowed dark:text-[#F5F2EB] dark:placeholder:text-[#78716C]"
          />

          {loading ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[#1C1917] text-[#FAF8F5] transition hover:bg-[#292524] dark:bg-[#F5F2EB] dark:text-[#141312]"
            >
              <FiSquare size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={blocked || !question.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C85A32] text-white transition-all duration-150 hover:bg-[#B24C28] active:scale-95 disabled:cursor-not-allowed disabled:bg-[#EAE4DC] disabled:text-[#A8A29E] dark:bg-[#D97757] dark:text-[#141312] dark:hover:bg-[#E28769] dark:disabled:bg-[#262421] dark:disabled:text-[#57534E] cursor-pointer"
            >
              <FiArrowUp size={18} className="stroke-[2.2]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
