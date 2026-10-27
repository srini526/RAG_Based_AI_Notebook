import { FiBookOpen } from "react-icons/fi";

export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-3.5 sm:gap-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E6E1D6] bg-[#F3EFEA] text-[#C85A32] shadow-2xs dark:border-[#2A2826] dark:bg-[#1C1B19] dark:text-[#D97757]">
        <FiBookOpen size={15} />
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-[#E6E1D6] bg-[#F3EFEA] px-4 py-3 dark:border-[#2A2826] dark:bg-[#1C1B19]">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#C85A32] dark:bg-[#D97757]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#C85A32] [animation-delay:0.18s] dark:bg-[#D97757]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#C85A32] [animation-delay:0.36s] dark:bg-[#D97757]" />
        </div>
      </div>
    </div>
  );
}