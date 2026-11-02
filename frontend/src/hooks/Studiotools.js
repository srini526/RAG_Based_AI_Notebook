import { FiBookOpen, FiCheckSquare, FiClock, FiFileText, FiHelpCircle, FiLayers, FiShare2 } from "react-icons/fi";

// The seven things Studio can make. Tints come from the notebook palette.
export const TOOLS = [
  { id: "briefing", label: "Briefing document", short: "Briefing", description: "Key ideas and takeaways", icon: FiFileText, tint: "bg-orange-50 text-orange-800 hover:bg-orange-100 dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/15" },
  { id: "study_guide", label: "Study guide", short: "Study guide", description: "Organized notes for revision", icon: FiBookOpen, tint: "bg-sky-50 text-sky-800 hover:bg-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:hover:bg-sky-400/15" },
  { id: "faq", label: "FAQ", short: "FAQ", description: "Questions and answers", icon: FiHelpCircle, tint: "bg-purple-50 text-purple-800 hover:bg-purple-100 dark:bg-purple-400/10 dark:text-purple-200 dark:hover:bg-purple-400/15" },
  { id: "mindmap", label: "Mind map", short: "Mind map", description: "Concepts and connections", icon: FiShare2, tint: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/15" },
  { id: "timeline", label: "Timeline", short: "Timeline", description: "Events in sequence", icon: FiClock, tint: "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/15" },
  { id: "flashcards", label: "Flashcards", short: "Flashcards", description: "Quick review cards", icon: FiLayers, tint: "bg-blue-50 text-blue-800 hover:bg-blue-100 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/15" },
  { id: "quiz", label: "Quiz", short: "Quiz", description: "Check your knowledge", icon: FiCheckSquare, tint: "bg-rose-50 text-rose-800 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-200 dark:hover:bg-rose-400/15" },
];

export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export const ago = (ts) => {
  const minutes = Math.round((Date.now() / 1000 - ts) / 60);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};