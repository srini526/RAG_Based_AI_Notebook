import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiCopy, FiKey, FiLoader, FiPlus, FiTrash2 } from "react-icons/fi";

import { createNotebook, deleteNotebook, getOwnerKey, listNotebooks, setOwnerKey } from "../services/api";

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
    <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-5 py-8 md:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif-editorial text-2xl font-medium text-[#1C1917] dark:text-[#F5F2EB]">Notebooks</h2>
          <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
            Add sources, ask questions with citations, and create study material. Everything is saved.
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-[#C85A32] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#B24C28] disabled:opacity-60 dark:bg-[#D97757] dark:text-[#141312] dark:hover:bg-[#E28769]"
        >
          {creating ? <FiLoader className="animate-spin" size={15} /> : <FiPlus size={16} />}
          New notebook
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {notebooks === null ? (
        <p className="flex items-center gap-2 text-sm text-[#78716C]">
          <FiLoader className="animate-spin" size={14} /> Loading…
        </p>
      ) : notebooks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#D6CFC2] px-6 py-12 text-center text-sm text-[#78716C] dark:border-[#35322F] dark:text-[#A8A29E]">
          No notebooks yet. Create one to get started.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((nb) => (
            <li
              key={nb.id}
              className="group relative rounded-2xl border border-[#E6E1D6] bg-[#FFFFFF] shadow-2xs transition hover:border-[#C85A32]/50 dark:border-[#2A2826] dark:bg-[#1C1B19] dark:hover:border-[#D97757]/50"
            >
              <button type="button" onClick={() => onOpen(nb.id)} className="block w-full cursor-pointer p-4 text-left">
                <span className="block truncate font-serif-editorial text-base font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                  {nb.title}
                </span>
                <span className="mt-1 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {nb.sources} {nb.sources === 1 ? "source" : "sources"} · {ago(nb.updated_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(nb)}
                aria-label={`Delete ${nb.title}`}
                className="absolute right-2 top-2 cursor-pointer rounded-lg p-1.5 text-[#A8A29E] opacity-0 transition hover:bg-red-500/10 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                <FiTrash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <DeviceKey />
    </main>
  );
}
