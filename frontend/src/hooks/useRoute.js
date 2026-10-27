import { useCallback, useEffect, useState } from "react";

// Tiny hash router: "#/n/<notebook id>" opens a notebook, anything else is the home screen.
const read = () => window.location.hash.match(/^#\/n\/([0-9a-f]{32})$/)?.[1] ?? null;

export default function useRoute() {
  const [notebookId, setNotebookId] = useState(read);
  useEffect(() => {
    const onChange = () => setNotebookId(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const open = useCallback((id) => {
    window.location.hash = id ? `#/n/${id}` : "#/";
  }, []);
  return { notebookId, open };
}
