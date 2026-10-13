const DB_NAME = "bono-db";
const DB_VERSION = 1;
const STORE = "notes";
const PAGE_LIMIT = 1150;
const CATEGORIES = {
  content: { label: "Content", mode: "note" },
  script: { label: "Script", mode: "script" },
  plans: { label: "Plans", mode: "note" },
  todo: { label: "To-Do", mode: "note" },
  more: { label: "More", mode: "note" }
};

const els = {
  shell: document.querySelector(".app-shell"),
  tabs: [...document.querySelectorAll(".tab")],
  coverPanel: document.querySelector("#coverPanel"),
  coverButton: document.querySelector("#coverButton"),
  flashbackText: document.querySelector("#flashbackText"),
  flashbackMeta: document.querySelector("#flashbackMeta"),
  keepAliveButton: document.querySelector("#keepAliveButton"),
  archiveButton: document.querySelector("#archiveButton"),
  pageCategory: document.querySelector("#pageCategory"),
  pageCounter: document.querySelector("#pageCounter"),
  pageDate: document.querySelector("#pageDate"),
  noteTitle: document.querySelector("#noteTitle"),
  noteBody: document.querySelector("#noteBody"),
  page: document.querySelector(".page"),
  spread: document.querySelector("#spread"),
  newPageButton: document.querySelector("#newPageButton"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  tools: [...document.querySelectorAll("[data-insert]")],
  pingButton: document.querySelector("#pingButton"),
  pingSheet: document.querySelector("#pingSheet"),
  closePingButton: document.querySelector("#closePingButton"),
  pingSnippet: document.querySelector("#pingSnippet"),
  pingOptions: [...document.querySelectorAll("[data-minutes]")],
  toast: document.querySelector("#toast"),
  chime: document.querySelector("#chime")
};

let db;
let notes = [];
let activeCategory = "content";
let activeIndex = 0;
let flashbackNote = null;
let saveTimer = 0;
let touchStartX = null;

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("category", "category");
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getAllNotes() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putNote(note) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").put(note);
    request.onsuccess = () => resolve(note);
    request.onerror = () => reject(request.error);
  });
}

function deleteNote(id) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function createNote(category = activeCategory) {
  return {
    id: uid(),
    category,
    title: "",
    body: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    archived: false,
    aliveAt: nowIso()
  };
}

function currentList() {
  return notes
    .filter((note) => note.category === activeCategory && !note.archived)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function currentNote() {
  const list = currentList();
  return list[activeIndex] || null;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function snippet(note, fallback = "This page is empty for now.") {
  const text = `${note?.title || ""} ${note?.body || ""}`.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 170) : fallback;
}

function renderTabs() {
  els.tabs.forEach((tab) => {
    const isActive = tab.dataset.category === activeCategory;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-current", isActive ? "page" : "false");
  });
  els.shell.dataset.mode = CATEGORIES[activeCategory].mode;
}

function renderPage() {
  const list = currentList();
  if (!list.length) {
    const fresh = createNote(activeCategory);
    notes.push(fresh);
    putNote(fresh);
    activeIndex = 0;
    return renderPage();
  }

  activeIndex = Math.min(Math.max(activeIndex, 0), list.length - 1);
  const note = list[activeIndex];
  els.pageCategory.textContent = CATEGORIES[activeCategory].label;
  els.noteTitle.value = note.title;
  els.noteBody.value = note.body;
  els.pageDate.textContent = formatDate(note.createdAt);
  els.pageCounter.textContent = `Page ${activeIndex + 1} of ${list.length}`;
  enforcePageLimit(false);
  renderTabs();
}

function renderFlashback() {
  const activeNotes = notes.filter((note) => !note.archived && (note.title || note.body));
  if (!activeNotes.length) {
    flashbackNote = null;
    els.flashbackText.textContent = "Your older pages will resurface here once Bo-No has something to remember.";
    els.flashbackMeta.textContent = "Start writing. Future-you will meet it here.";
    return;
  }

  const threeWeeks = Date.now() - 21 * 24 * 60 * 60 * 1000;
  const older = activeNotes.filter((note) => new Date(note.createdAt).getTime() <= threeWeeks);
  const pool = older.length ? older : activeNotes;
  flashbackNote = pool[Math.floor(Math.random() * pool.length)];
  els.flashbackText.textContent = snippet(flashbackNote);
  els.flashbackMeta.textContent = `${CATEGORIES[flashbackNote.category].label} - ${formatDate(flashbackNote.createdAt)}`;
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCurrent, 220);
}

async function saveCurrent() {
  const note = currentNote();
  if (!note) return;
  note.title = els.noteTitle.value.trimStart();
  note.body = els.noteBody.value;
  note.updatedAt = nowIso();
  await putNote(note);
  renderFlashback();
}

function enforcePageLimit(createOverflow = true) {
  if (els.noteBody.value.length <= PAGE_LIMIT) return;
  const overflow = els.noteBody.value.slice(PAGE_LIMIT).trimStart();
  els.noteBody.value = els.noteBody.value.slice(0, PAGE_LIMIT).trimEnd();
  if (!createOverflow || !overflow) return;

  saveCurrent();
  const note = createNote(activeCategory);
  note.title = els.noteTitle.value ? `${els.noteTitle.value} cont.` : "";
  note.body = overflow;
  notes.push(note);
  putNote(note).then(() => {
    activeIndex = currentList().findIndex((item) => item.id === note.id);
    turnPage("next");
    renderPage();
    showToast("Page break made. New spread is ready.");
  });
}

function turnPage(direction) {
  els.page.classList.remove("is-turning-next", "is-turning-prev");
  els.page.classList.add(direction === "next" ? "is-turning-next" : "is-turning-prev");
  window.setTimeout(() => els.page.classList.remove("is-turning-next", "is-turning-prev"), 220);
}

function go(delta) {
  const list = currentList();
  const next = activeIndex + delta;
  if (next < 0 || next >= list.length) {
    showToast(delta > 0 ? "Last page in this section." : "First page in this section.");
    return;
  }
  saveCurrent();
  activeIndex = next;
  turnPage(delta > 0 ? "next" : "prev");
  renderPage();
}

function insertAtCursor(text) {
  const input = els.noteBody;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = `${before}${text}${after}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + text.length;
  enforcePageLimit();
  queueSave();
}

function showToast(message, linger = 2800) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), linger);
}

function openPingSheet() {
  const note = currentNote();
  els.pingSnippet.textContent = snippet(note, "This page will come back with a soft nudge.");
  els.pingSheet.classList.add("is-open");
  els.pingSheet.setAttribute("aria-hidden", "false");
}

function closePingSheet() {
  els.pingSheet.classList.remove("is-open");
  els.pingSheet.setAttribute("aria-hidden", "true");
}

function playChime() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(990, audioContext.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.42);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.45);
}

function setPing(minutes) {
  const note = currentNote();
  const noteId = note?.id;
  const noteSnippet = snippet(note, "Time to return to this page.");
  closePingSheet();
  showToast(`Gentle ping set for ${minutes} min.`);

  window.setTimeout(() => {
    const target = notes.find((item) => item.id === noteId);
    if (target) {
      activeCategory = target.category;
      activeIndex = currentList().findIndex((item) => item.id === target.id);
      renderPage();
    }
    try {
      playChime();
    } catch {
      // iOS may block audio until a fresh gesture; the card still appears.
    }
    showToast(`Gentle Ping: ${noteSnippet}`, 7200);
  }, minutes * 60 * 1000);
}

function wireEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      saveCurrent();
      activeCategory = tab.dataset.category;
      activeIndex = 0;
      els.coverPanel.classList.add("is-hidden");
      renderPage();
    });
  });

  els.coverButton.addEventListener("click", () => {
    els.coverPanel.classList.toggle("is-hidden");
  });

  els.noteTitle.addEventListener("input", queueSave);
  els.noteBody.addEventListener("input", () => {
    enforcePageLimit();
    queueSave();
  });

  els.newPageButton.addEventListener("click", async () => {
    await saveCurrent();
    const note = createNote(activeCategory);
    notes.push(note);
    await putNote(note);
    activeIndex = currentList().findIndex((item) => item.id === note.id);
    turnPage("next");
    renderPage();
  });

  els.prevPageButton.addEventListener("click", () => go(-1));
  els.nextPageButton.addEventListener("click", () => go(1));
  els.spread.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });

  els.spread.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0].screenX;
  }, { passive: true });

  els.spread.addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const diff = event.changedTouches[0].screenX - touchStartX;
    touchStartX = null;
    if (Math.abs(diff) < 48) return;
    go(diff < 0 ? 1 : -1);
  }, { passive: true });

  els.tools.forEach((button) => {
    button.addEventListener("click", () => insertAtCursor(button.dataset.insert.replace("\\n", "\n")));
  });

  els.pingButton.addEventListener("click", openPingSheet);
  els.closePingButton.addEventListener("click", closePingSheet);
  els.pingSheet.addEventListener("click", (event) => {
    if (event.target === els.pingSheet) closePingSheet();
  });
  els.pingOptions.forEach((button) => {
    button.addEventListener("click", () => setPing(Number(button.dataset.minutes)));
  });

  els.keepAliveButton.addEventListener("click", async () => {
    if (!flashbackNote) return showToast("Write a few pages first.");
    flashbackNote.aliveAt = nowIso();
    flashbackNote.updatedAt = nowIso();
    await putNote(flashbackNote);
    activeCategory = flashbackNote.category;
    activeIndex = currentList().findIndex((note) => note.id === flashbackNote.id);
    els.coverPanel.classList.add("is-hidden");
    renderPage();
    showToast("Kept alive and opened.");
  });

  els.archiveButton.addEventListener("click", async () => {
    if (!flashbackNote) return showToast("Nothing to archive yet.");
    flashbackNote.archived = true;
    flashbackNote.updatedAt = nowIso();
    await putNote(flashbackNote);
    renderFlashback();
    renderPage();
    showToast("Archived from the cover.");
  });
}

async function seedIfEmpty() {
  if (notes.length) return;
  const starter = createNote("content");
  starter.title = "First Bo-No page";
  starter.body = "This is your book-note. Swipe sideways, tap Ping when a thought needs to return, and let old pages meet you on the cover.";
  starter.createdAt = new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString();
  starter.updatedAt = starter.createdAt;
  notes.push(starter);
  await putNote(starter);
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
  db = await openDb();
  notes = await getAllNotes();
  await seedIfEmpty();
  notes = await getAllNotes();
  renderFlashback();
  renderPage();
  wireEvents();
}

init().catch((error) => {
  console.error(error);
  showToast("Bo-No had trouble opening local storage.");
});
