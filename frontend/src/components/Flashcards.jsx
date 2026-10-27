import { useState } from "react";
import { FiChevronLeft, FiChevronRight, FiRotateCw } from "react-icons/fi";

export default function Flashcards({ cards }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index];
  const go = (step) => {
    setFlipped(false);
    setIndex((i) => (i + step + cards.length) % cards.length);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Show the question" : "Show the answer"}
        className="flex min-h-48 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-[#E6E1D6] bg-[#FFFFFF] p-6 text-center shadow-xs transition hover:border-[#C85A32]/50 dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#D97757]/50"
      >
        <span className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[#C85A32] dark:text-[#D97757]">
          {flipped ? "Answer" : "Question"}
        </span>
        <span
          className={`whitespace-pre-wrap text-[#1C1917] dark:text-[#F5F2EB] ${
            flipped ? "text-sm leading-relaxed" : "font-serif-editorial text-lg"
          }`}
        >
          {flipped ? card.back : card.front}
        </span>
        <FiRotateCw className="mt-4 text-[#A8A29E]" size={14} />
      </button>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous card"
          className="cursor-pointer rounded-lg border border-[#E6E1D6] p-2 text-[#57534E] hover:text-[#C85A32] dark:border-[#2A2826] dark:text-[#A8A29E]"
        >
          <FiChevronLeft size={16} />
        </button>
        <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">
          {index + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next card"
          className="cursor-pointer rounded-lg border border-[#E6E1D6] p-2 text-[#57534E] hover:text-[#C85A32] dark:border-[#2A2826] dark:text-[#A8A29E]"
        >
          <FiChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
