import { useEffect, useState } from "react";
import { FiLoader } from "react-icons/fi";

import Header from "./components/Header";
import Home from "./components/Home";
import NotebookView, { NotebookProblem } from "./components/NotebookView";
import useRoute from "./hooks/useRoute";
import useTheme from "./hooks/useTheme";
import { getNotebook } from "./services/api";
import { Analytics } from "@vercel/analytics/react"
import { SpeedInsights } from "@vercel/speed-insights/react"

/** Loads one notebook from the server, then hands it to the three-panel view. */
function NotebookPage({ nid, theme, onHome }) {
  const [state, setState] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getNotebook(nid)
      .then((data) => alive && setState({ status: "ready", data }))
      .catch((err) => alive && setState({ status: err.isNotFound ? "missing" : "down" }));
    return () => {
      alive = false;
    };
  }, [nid, attempt]);

  if (state.status === "ready") return <NotebookView key={nid} nid={nid} data={state.data} theme={theme} onHome={onHome} />;
  if (state.status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#FAF8F5] text-[#78716C] dark:bg-[#141312]">
        <FiLoader className="animate-spin" size={20} />
      </div>
    );
  }
  return (
    <NotebookProblem
      kind={state.status}
      onHome={onHome}
      onRetry={() => {
        setState({ status: "loading" });
        setAttempt((a) => a + 1);
      }}
    />
  );
}

export default function App() {
  const { notebookId, open } = useRoute();
  const theme = useTheme();

  if (notebookId) return <NotebookPage nid={notebookId} theme={theme} onHome={() => open(null)} />;
  return (
    <div className="flex h-dvh flex-col bg-[#FAF8F5] text-[#1C1917] transition-colors duration-200 dark:bg-[#141312] dark:text-[#F5F2EB]">
      <Header theme={theme} />
      <Home onOpen={open} />
      <Analytics />
      <SpeedInsights />
    </div>
  );
}
