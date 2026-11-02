import { useCallback, useEffect, useState } from "react";
import { FiBookOpen, FiCheck, FiCopy, FiKey, FiLoader, FiPlus, FiTrash2 } from "react-icons/fi";

import { createNotebook, deleteNotebook, getOwnerKey, listNotebooks, setOwnerKey } from "../services/api.js";

const TINTS = [
  "bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300",
  "bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  "bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300",
  "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
];

const ago = (ts) => {
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  return days < 1 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

function DeviceKey() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restore, setRestore] = useState("");
  const [bad, setBad] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getOwnerKey());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };
  const apply = () => {
    if (setOwnerKey(restore)) window.location.reload();
    else setBad(true);
  };

  return (
    <div className="mt-10 text-xs text-[#78716C] dark:text-[#A8A29E]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-pointer items-center gap-1.5 font-medium hover:text-[#C85A32] dark:hover:text-[#D97757]"
      >
        <FiKey size={12} />
        Device key & other devices
      </button>
      {open && (
        <div className="mt-3 max-w-lg space-y-3 rounded-xl border border-[#E6E1D6] bg-[#FFFFFF] p-4 dark:border-[#2A2826] dark:bg-[#1C1B19]">
          <p className="leading-relaxed">
            There is no login. Your notebooks belong to this browser&apos;s secret key. Keep a copy: clearing browser
            data without it means losing access. Paste it on another device to open the same notebooks. Anyone who has
            the key can open them, so keep it private.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-[#F3EFEA] px-2.5 py-1.5 font-mono-code dark:bg-[#262421]">
              {getOwnerKey()}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy device key"
              className="cursor-pointer rounded-lg border border-[#E6E1D6] p-2 hover:text-[#C85A32] dark:border-[#2A2826]"
            >
              {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={restore}
              onChange={(e) => {
                setRestore(e.target.value);
                setBad(false);
              }}
              placeholder="Paste a key from another device"
              aria-label="Device key to use"
              className="min-w-0 flex-1 rounded-lg border border-[#E6E1D6] bg-transparent px-2.5 py-1.5 outline-none focus:border-[#C85A32] dark:border-[#2A2826]"
            />
            <button
              type="button"
              onClick={apply}
              disabled={!restore.trim()}
              className="cursor-pointer rounded-lg bg-[#1C1917] px-3 py-1.5 font-medium text-[#FAF8F5] disabled:opacity-50 dark:bg-[#F5F2EB] dark:text-[#141312]"
            >
              Use
            </button>
          </div>
          {bad && <p className="text-red-600 dark:text-red-400">That doesn&apos;t look like a device key.</p>}
        </div>
      )}
    </div>
  );
}

export default function Home({ onOpen }) {
  const [notebooks, setNotebooks] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotebooks(await listNotebooks());
      setError("");
    } catch (err) {
      setError(err.status === undefined ? "Can't reach the server. It may be waking up – try again in a few seconds." : err.message);
      setNotebooks((n) => n ?? []);
    }
  }, []);

  useEffect(() => {
    // initial load of the notebook list
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const nb = await createNotebook("Untitled notebook");
      onOpen(nb.id);
    } catch (err) {
      setError(err.message);
      setCreating(false);
    }
  };

  const remove = async (nb) => {
    if (!window.confirm(`Delete "${nb.title}" and everything in it?`)) return;
    try {
      await deleteNotebook(nb.id);
      setNotebooks((list) => list.filter((n) => n.id !== nb.id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 pb-10 pt-4 sm:px-8 sm:pt-8">
      <h2 className="font-serif-editorial text-3xl font-medium tracking-tight text-[#1C1917] sm:text-4xl dark:text-[#F5F2EB]">
        Your notebooks
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#78716C] dark:text-[#A8A29E]">
        Add sources, ask questions with citations, and create study material. Everything is saved.
      </p>

      {error && (
        <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {notebooks === null ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-[#78716C]">
          <FiLoader className="animate-spin" size={14} /> Loading…
        </p>
      ) : (
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <li>
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="flex h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[#D6CFC2] text-[#57534E] transition hover:border-[#C85A32] hover:bg-[#C85A32]/5 hover:text-[#C85A32] disabled:opacity-60 dark:border-[#35322F] dark:text-[#A8A29E] dark:hover:border-[#D97757] dark:hover:text-[#D97757]"
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-[#C85A32] text-white dark:bg-[#D97757] dark:text-[#141312]">
                {creating ? <FiLoader className="animate-spin" size={20} /> : <FiPlus size={22} />}
              </span>
              <span className="text-sm font-medium">New notebook</span>
            </button>
          </li>

          {notebooks.map((nb, i) => (
            <li
              key={nb.id}
              className="group relative h-44 rounded-3xl border border-[#E6E1D6] bg-[#FFFFFF] transition hover:-translate-y-0.5 hover:border-[#C85A32]/50 hover:shadow-md dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#D97757]/50"
            >
              <button type="button" onClick={() => onOpen(nb.id)} className="flex h-full w-full cursor-pointer flex-col justify-between p-5 text-left">
                <span className={`flex size-10 items-center justify-center rounded-xl ${TINTS[i % TINTS.length]}`}>
                  <FiBookOpen size={18} />
                </span>
                <span>
                  <span className="line-clamp-2 block font-serif-editorial text-lg font-medium leading-snug text-[#1C1917] dark:text-[#F5F2EB]">
                    {nb.title}
                  </span>
                  <span className="mt-1 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    {ago(nb.updated_at)} · {nb.sources} {nb.sources === 1 ? "source" : "sources"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(nb)}
                aria-label={`Delete ${nb.title}`}
                className="absolute right-3 top-3 cursor-pointer rounded-full p-2 text-[#A8A29E] transition hover:bg-red-500/10 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:hover:text-red-400"
              >
                <FiTrash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {notebooks?.length === 0 && (
        <p className="mt-6 text-sm text-[#78716C] dark:text-[#A8A29E]">No notebooks yet. Create your first one to get started.</p>
      )}

      <DeviceKey />
    </main>
  );
}