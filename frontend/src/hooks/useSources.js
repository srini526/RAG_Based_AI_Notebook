import { useCallback, useEffect, useRef, useState } from "react";
import { addUrl, clearLibrary, deleteDoc, getConfig, listLibrary, uploadFile } from "../services/api";
import { SAMPLE_NAME, SAMPLE_TEXT } from "../sample";

const DEFAULT_CONFIG = { allowed_extensions: [], max_upload_mb: 100, max_docs: 10 };

/** The sources of one notebook: list, upload, link, remove, polling while items process. */
export default function useSources(nid, initialDocs) {
  const [docs, setDocs] = useState(initialDocs);
  const [uploads, setUploads] = useState([]); // in-flight uploads
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState("");
  const [serverDown, setServerDown] = useState(false);
  const [selected, setSelected] = useState([]); // source ids the user wants to ask about
  const nextUploadId = useRef(0);

  const handleError = useCallback((err) => {
    if (err.status === undefined) setServerDown(true);
    else setError(err.message);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listLibrary(nid));
      setServerDown(false);
    } catch (err) {
      handleError(err);
    }
  }, [nid, handleError]);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => {});
  }, []);

  // Poll while anything is still being processed.
  const busy = docs.some((d) => d.status === "queued" || d.status === "processing");
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const addFiles = useCallback(
    async (fileList) => {
      for (const file of Array.from(fileList || [])) {
        const id = nextUploadId.current++;
        setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
        try {
          const doc = await uploadFile(nid, file, (progress) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress } : x)))
          );
          setDocs((d) => [...d, doc]);
        } catch (err) {
          handleError(err);
        } finally {
          setUploads((u) => u.filter((x) => x.id !== id));
        }
      }
    },
    [nid, handleError]
  );

  const addLink = useCallback(
    async (url) => {
      try {
        const { document } = await addUrl(nid, url);
        setDocs((d) => [...d, document]);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [nid, handleError]
  );

  const remove = useCallback(
    async (id) => {
      try {
        await deleteDoc(nid, id);
        setDocs((d) => d.filter((x) => x.id !== id));
      } catch (err) {
        handleError(err);
      }
    },
    [nid, handleError]
  );

  const clear = useCallback(async () => {
    try {
      await clearLibrary(nid);
      setDocs([]);
    } catch (err) {
      handleError(err);
    }
  }, [nid, handleError]);

  const toggleSelected = useCallback(
    (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    []
  );

  const addSample = useCallback(
    () => addFiles([new File([SAMPLE_TEXT], SAMPLE_NAME, { type: "text/markdown" })]),
    [addFiles]
  );

  // Only ready sources that still exist can be selected.
  const selectedIds = selected.filter((id) => docs.some((d) => d.id === id && d.status === "ready"));

  return {
    docs,
    uploads,
    config,
    error,
    clearError: () => setError(""),
    serverDown,
    retry: refresh,
    addFiles,
    addLink,
    addSample,
    remove,
    clear,
    selectedIds,
    toggleSelected,
    clearSelection: () => setSelected([]),
    hasReady: docs.some((d) => d.status === "ready"),
  };
}
