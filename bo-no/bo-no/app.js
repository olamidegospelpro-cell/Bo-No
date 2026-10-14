const DB_NAME = "bono-db";
const DB_VERSION = 1;
const STORE = "notes";
const PAGE_LIMIT = 1150;
const MIN_FLASHBACK_AGE_DAYS = 2;
const RATING_INTERVAL_DAYS = {
  1: 30,
  2: 21,
  3: 14,
  4: 7,
  5: 3
};
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
  indexCount: document.querySelector("#indexCount"),
  viewAllButton: document.querySelector("#viewAllButton"),
  viewStarredButton: document.querySelector("#viewStarredButton"),
  viewArchiveButton: document.querySelector("#viewArchiveButton"),
  searchInput: document.querySelector("#searchInput"),
  starFilter: document.querySelector("#starFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  noteIndex: document.querySelector("#noteIndex"),
  pageCategory: document.querySelector("#pageCategory"),
  pageCounter: document.querySelector("#pageCounter"),
  pageDate: document.querySelector("#pageDate"),
  noteTitle: document.querySelector("#noteTitle"),
  noteBody: document.querySelector("#noteBody"),
  starButtons: [...document.querySelectorAll("#starRating button")],
  ratingLabel: document.querySelector("#ratingLabel"),
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
  toast: document.querySelector("#toast")
};

let db;
let notes = [];
let activeCategory = "content";
let activeIndex = 0;
let flashbackNote = null;
let saveTimer = 0;
let touchStartX = null;
let indexView = "all";
let sessionFlashbacks = new Set();

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const addDays = (value, days) => new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
const daysSince = (value) => (Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000);

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

function createNote(category = activeCategory) {
  const createdAt = nowIso();
  return normalizeNote({
    id: uid(),
    category,
    title: "",
    body: "",
    createdAt,
    updatedAt: createdAt,
    archived: false,
    aliveAt: createdAt
  });
}

function normalizeNote(note) {
  const createdAt = note.createdAt || nowIso();
  const updatedAt = note.updatedAt || createdAt;
  const rating = Number.isInteger(note.rating) && note.rating >= 1 && note.rating <= 5 ? note.rating : 0;
  const basis = note.lastResurfacedAt || note.aliveAt || updatedAt || createdAt;
  return {
    ...note,
    id: note.id || uid(),
    category: CATEGORIES[note.category] ? note.category : "content",
    title: note.title || "",
    body: note.body || "",
    createdAt,
    updatedAt,
    archived: Boolean(note.archived),
    aliveAt: note.aliveAt || updatedAt,
    rating,
    lastResurfacedAt: note.lastResurfacedAt || null,
    nextEligibleAt: note.nextEligibleAt || addDays(basis, revisitDays(rating)),
    reminder: note.reminder || null
  };
}

async function migrateNotes() {
  let changed = false;
  notes = notes.map((note) => {
    const normalized = normalizeNote(note);
    if (JSON.stringify(normalized) !== JSON.stringify(note)) changed = true;
    return normalized;
  });
  if (changed) {
    await Promise.all(notes.map((note) => putNote(note)));
  }
}

function revisitDays(rating) {
  return RATING_INTERVAL_DAYS[rating] || 21;
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

function starText(rating) {
  return `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
}

function ratingLabel(rating) {
  return rating ? `${rating} star${rating === 1 ? "" : "s"} important` : "Unrated";
}

function renderTabs() {
  els.tabs.forEach((tab) => {
    const isActive = tab.dataset.category === activeCategory;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-current", isActive ? "page" : "false");
  });
  els.shell.dataset.mode = CATEGORIES[activeCategory].mode;
}

function renderRating(note) {
  const rating = note?.rating || 0;
  els.starButtons.forEach((button) => {
    const value = Number(button.dataset.rating);
    const isOn = value <= rating;
    button.classList.toggle("is-on", isOn);
    button.textContent = isOn ? "★" : "☆";
    button.setAttribute("aria-checked", String(value === rating));
  });
  els.ratingLabel.textContent = ratingLabel(rating);
  document.querySelector("#starRating").setAttribute("aria-label", `Note importance: ${ratingLabel(rating)}`);
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
  renderRating(note);
  enforcePageLimit(false);
  renderTabs();
  renderIndex();
}

function flashbackCandidates() {
  const now = Date.now();
  return notes.filter((note) =>
    !note.archived &&
    !sessionFlashbacks.has(note.id) &&
    (note.title || note.body) &&
    daysSince(note.createdAt) >= MIN_FLASHBACK_AGE_DAYS &&
    new Date(note.nextEligibleAt || addDays(note.createdAt, revisitDays(note.rating))).getTime() <= now
  );
}

function chooseFlashback() {
  const candidates = flashbackCandidates();
  if (!candidates.length) return null;
  const weighted = candidates.map((note) => {
    const ratingWeight = note.rating || 1;
    const overdueDays = Math.max(0, daysSince(note.nextEligibleAt || note.createdAt));
    const weight = ratingWeight * 3 + Math.min(overdueDays, 30);
    return { note, weight };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let pick = Math.random() * total;
  for (const item of weighted) {
    pick -= item.weight;
    if (pick <= 0) return item.note;
  }
  return weighted[weighted.length - 1].note;
}

async function renderFlashback() {
  const candidate = chooseFlashback();
  if (!candidate) {
    flashbackNote = null;
    const savedCount = notes.filter((note) => !note.archived && (note.title || note.body)).length;
    els.flashbackText.textContent = savedCount
      ? "No older page is due right now. Your book is still safe here."
      : "Your older pages will resurface here once BoJo has something to remember.";
    els.flashbackMeta.textContent = savedCount ? "Open the index below or keep writing." : "Start writing. Future-you will meet it here.";
    return;
  }

  flashbackNote = candidate;
  sessionFlashbacks.add(candidate.id);
  candidate.lastResurfacedAt = nowIso();
  candidate.nextEligibleAt = addDays(candidate.lastResurfacedAt, revisitDays(candidate.rating));
  await putNote(candidate);
  els.flashbackText.textContent = snippet(candidate);
  els.flashbackMeta.textContent = `${starText(candidate.rating || 0)} · ${CATEGORIES[candidate.category].label} · ${formatDate(candidate.createdAt)}`;
  renderIndex();
}

function filteredIndexNotes() {
  const query = els.searchInput.value.trim().toLowerCase();
  const starValue = els.starFilter.value;
  const categoryValue = els.categoryFilter.value;
  const sortValue = els.sortSelect.value;

  let list = notes.filter((note) => {
    if (indexView === "archive" && !note.archived) return false;
    if (indexView !== "archive" && note.archived) return false;
    if (indexView === "starred" && !note.rating) return false;
    if (starValue !== "any" && note.rating !== Number(starValue)) return false;
    if (categoryValue !== "all" && note.category !== categoryValue) return false;
    if (query && !`${note.title} ${note.body}`.toLowerCase().includes(query)) return false;
    return true;
  });

  list = [...list].sort((a, b) => {
    if (sortValue === "importance") return (b.rating || 0) - (a.rating || 0) || new Date(b.updatedAt) - new Date(a.updatedAt);
    if (sortValue === "created") return new Date(b.createdAt) - new Date(a.createdAt);
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  return list;
}

function renderIndex() {
  const list = filteredIndexNotes();
  els.indexCount.textContent = `${list.length} page${list.length === 1 ? "" : "s"}`;
  [els.viewAllButton, els.viewStarredButton, els.viewArchiveButton].forEach((button) => button.classList.remove("is-active"));
  if (indexView === "all") els.viewAllButton.classList.add("is-active");
  if (indexView === "starred") els.viewStarredButton.classList.add("is-active");
  if (indexView === "archive") els.viewArchiveButton.classList.add("is-active");

  els.noteIndex.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "index-item";
    empty.innerHTML = "<div><strong>No pages found</strong><small>Try another filter or keep writing.</small></div><span class=\"index-stars\">☆☆☆☆☆</span>";
    els.noteIndex.append(empty);
    return;
  }

  list.slice(0, 30).forEach((note) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "index-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(note.title || "Untitled thought")}</strong>
        <small>${CATEGORIES[note.category].label} · ${formatDate(note.updatedAt)} · ${escapeHtml(snippet(note, "Empty page"))}</small>
      </div>
      <span class="index-stars" aria-label="${ratingLabel(note.rating)}">${starText(note.rating || 0)}</span>
    `;
    item.addEventListener("click", () => openNote(note.id));
    els.noteIndex.append(item);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function openNote(id) {
  const note = notes.find((item) => item.id === id);
  if (!note) return;
  if (note.archived) {
    note.archived = false;
    note.updatedAt = nowIso();
    putNote(note);
    showToast("Restored from archive.");
  }
  activeCategory = note.category;
  activeIndex = currentList().findIndex((item) => item.id === note.id);
  els.coverPanel.classList.add("is-hidden");
  renderPage();
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
  renderIndex();
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

async function setRating(value) {
  const note = currentNote();
  if (!note) return;
  const nextRating = note.rating === value ? 0 : value;
  note.rating = nextRating;
  note.updatedAt = nowIso();
  note.nextEligibleAt = addDays(note.lastResurfacedAt || nowIso(), revisitDays(nextRating));
  await putNote(note);
  renderRating(note);
  renderIndex();
  showToast(nextRating ? `Marked ${nextRating} star${nextRating === 1 ? "" : "s"}.` : "Rating cleared.");
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
  if (note) {
    note.reminder = { minutes, scheduledAt: nowIso() };
    putNote(note);
  }
  closePingSheet();
  showToast(`Gentle ping set for ${minutes} min.`);

  window.setTimeout(() => {
    const target = notes.find((item) => item.id === noteId);
    if (target) openNote(target.id);
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
      els.categoryFilter.value = activeCategory;
      els.coverPanel.classList.add("is-hidden");
      renderPage();
    });
  });

  els.coverButton.addEventListener("click", () => {
    els.coverPanel.classList.toggle("is-hidden");
    renderIndex();
  });

  els.noteTitle.addEventListener("input", queueSave);
  els.noteBody.addEventListener("input", () => {
    enforcePageLimit();
    queueSave();
  });

  els.starButtons.forEach((button) => {
    button.addEventListener("click", () => setRating(Number(button.dataset.rating)));
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

  els.viewAllButton.addEventListener("click", () => {
    indexView = "all";
    renderIndex();
  });
  els.viewStarredButton.addEventListener("click", () => {
    indexView = "starred";
    renderIndex();
  });
  els.viewArchiveButton.addEventListener("click", () => {
    indexView = "archive";
    renderIndex();
  });
  [els.searchInput, els.starFilter, els.categoryFilter, els.sortSelect].forEach((control) => {
    control.addEventListener("input", renderIndex);
    control.addEventListener("change", renderIndex);
  });

  els.keepAliveButton.addEventListener("click", async () => {
    if (!flashbackNote) return showToast("No due memory right now.");
    flashbackNote.aliveAt = nowIso();
    flashbackNote.updatedAt = nowIso();
    flashbackNote.nextEligibleAt = addDays(nowIso(), revisitDays(flashbackNote.rating));
    await putNote(flashbackNote);
    openNote(flashbackNote.id);
    showToast("Kept alive and opened.");
  });

  els.archiveButton.addEventListener("click", async () => {
    if (!flashbackNote) return showToast("Nothing to archive yet.");
    flashbackNote.archived = true;
    flashbackNote.updatedAt = nowIso();
    await putNote(flashbackNote);
    await renderFlashback();
    renderPage();
    showToast("Archived from the cover.");
  });
}

async function seedIfEmpty() {
  if (notes.length) return;
  const starter = createNote("content");
  starter.title = "First BoJo page";
  starter.body = "This is your book journal. Swipe sideways, star what matters, tap Ping when a thought needs to return, and let older pages meet you on the cover.";
  starter.createdAt = new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString();
  starter.updatedAt = starter.createdAt;
  starter.nextEligibleAt = new Date(Date.now() - 60 * 1000).toISOString();
  notes.push(starter);
  await putNote(starter);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    showToast("Offline install is not supported in this browser.");
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    showToast("Offline shell could not be prepared yet.");
  }
}

async function init() {
  document.title = "BoJo — Book Journal";
  registerServiceWorker();
  db = await openDb();
  notes = await getAllNotes();
  await seedIfEmpty();
  notes = await getAllNotes();
  await migrateNotes();
  els.categoryFilter.value = "all";
  await renderFlashback();
  renderPage();
  wireEvents();
}

init().catch((error) => {
  console.error(error);
  showToast("BoJo had trouble opening local storage.");
});
