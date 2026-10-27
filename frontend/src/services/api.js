export const API_BASE = (
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "")
).replace(/\/$/, "");

const KEY = "rag_owner_key";

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
  get isNotFound() {
    return this.code === "not_found" && this.status === 404;
  }
}

async function toApiError(res) {
  const data = await res.json().catch(() => ({}));
  const e = data.error || {};
  return new ApiError(e.message || `Request failed (${res.status})`, e.code, res.status);
}

// ------------------------------------------------------------------ device key
// No login: this browser's random key proves which notebooks are yours. Keep it to keep them.
const newKey = () => crypto.randomUUID().replaceAll("-", "");

export function getOwnerKey() {
  let key = localStorage.getItem(KEY);
  if (!key) {
    key = newKey();
    localStorage.setItem(KEY, key);
  }
  return key;
}

/** Use a key from another device. Returns false if it doesn't look like a key. */
export function setOwnerKey(key) {
  const clean = key.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) return false;
  localStorage.setItem(KEY, clean);
  return true;
}

function headers(nid, extra = {}) {
  return { "X-Owner-Key": getOwnerKey(), ...(nid ? { "X-Notebook-Id": nid } : {}), ...extra };
}

async function request(path, { nid, method = "GET", json } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: headers(nid, json ? { "Content-Type": "application/json" } : {}),
      body: json ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError("Couldn't reach the server.");
  }
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

// ---------------------------------------------------------------- notebooks
export const getConfig = () => request("/api/config");
export const listNotebooks = () => request("/api/notebooks").then((d) => d.notebooks);
export const createNotebook = (title) =>
  request("/api/notebooks", { method: "POST", json: { title } }).then((d) => d.notebook);
export const renameNotebook = (id, title) =>
  request(`/api/notebooks/${id}`, { method: "PATCH", json: { title } });
export const deleteNotebook = (id) => request(`/api/notebooks/${id}`, { method: "DELETE" });
export const getNotebook = (nid) => request("/api/notebook", { nid });

// ------------------------------------------------------------------ sources
export const listLibrary = (nid) => request("/api/library", { nid }).then((d) => d.documents);
export const addUrl = (nid, url) => request("/api/library/url", { nid, method: "POST", json: { url } });
export const deleteDoc = (nid, id) => request(`/api/library/${id}`, { nid, method: "DELETE" });
export const clearLibrary = (nid) => request("/api/library", { nid, method: "DELETE" });
export const clearChat = (nid) => request("/api/chat", { nid, method: "DELETE" });
export const deleteOutput = (nid, id) => request(`/api/outputs/${id}`, { nid, method: "DELETE" });

/** Upload with progress (fetch cannot report upload progress, so this uses XHR). */
export function uploadFile(nid, file, onProgress) {
  const form = new FormData();
  form.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/library/file`);
    Object.entries(headers(nid)).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError("Couldn't reach the server."));
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the generic message
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data.document);
      const e = data.error || {};
      return reject(new ApiError(e.message || "Upload failed.", e.code, xhr.status));
    };
    xhr.send(form);
  });
}

// ------------------------------------------------------------------ streams
/**
 * POST and read a Server-Sent Events stream.
 * Events: step, token, reset, quiz, flashcards, mindmap, questions, done (sources, meta, output), error.
 * A stream that ends without `done` is reported as an error so the UI never hangs.
 */
export async function streamPost(path, nid, body, handlers = {}) {
  const { onToken, onStep, onReset, onData, onQuestions, onDone, onError, signal } = handlers;
  let finished = false;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: headers(nid, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await toApiError(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();

      for (const event of events) {
        if (!event.startsWith("data:")) continue;
        const json = JSON.parse(event.slice(5).trim());
        if (json.error) throw new ApiError(json.error, "stream_error");
        if (json.step) onStep?.(json.step);
        if (json.reset) onReset?.();
        if (json.token) onToken?.(json.token);
        for (const key of ["quiz", "flashcards", "mindmap"]) {
          if (json[key]) onData?.(key, json[key]);
        }
        if (json.questions) onQuestions?.(json.questions);
        if (json.done) {
          finished = true;
          onDone?.(json.sources || [], json.meta || {}, json.output || null);
        }
      }
    }
    if (!finished) {
      throw new ApiError("The connection was interrupted. Please try again.", "stream_interrupted");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    onError?.(err instanceof ApiError ? err : new ApiError("Couldn't reach the server."));
  }
}

export const streamChat = (nid, body, handlers) => streamPost("/api/chat/stream", nid, body, handlers);
export const streamGenerate = (nid, body, handlers) => streamPost("/api/generate", nid, body, handlers);
