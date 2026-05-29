/* ====================================================================
   Capitals Browser — app logic
   ==================================================================== */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const LS_SETTINGS = "capsBrowser.settings";
const LS_TODOS = "capsBrowser.todos";
const LS_WEATHER = "capsBrowser.weatherCache";
const LS_UPLOAD_PASS = "capsBrowser.uploadPass";

// Supabase — where your music lives so it persists across every device.
// This anon key is PUBLIC by design and safe to ship: a server-side
// policy lets it only READ (list + download) the caps-music bucket.
const SUPABASE = {
  url: "https://gcqmynjgmbufchapgcbd.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjcW15bmpnbWJ1ZmNoYXBnY2JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzExODcsImV4cCI6MjA5NDcwNzE4N30.FmtP48xwriyzzKEnMl9yb7-PQu3W0Sv5j8wKWrqTkQs",
  bucket: "caps-music",
};

const DEFAULTS = {
  brandName: "CAPITALS",
  logoDataUrl: null,
  clock24: false,
  show: { clock: true, weather: true, todo: true, music: true, quicklinks: true, accounts: true },
  tempUnit: "fahrenheit",
  weather: { mode: "auto", city: "" },
  bg: { animate: true, speed: "medium", intensity: 1.0 },
  music: { volume: 0.6, shuffle: false, autoplay: false },
  accounts: [{ id: "a1", label: "Account 1", index: 0, color: "#C8102E" }],
  activeAccountId: "a1",
  shortcuts: [
    { id: "s1", icon: "✉️", label: "Gmail", url: "https://mail.google.com/mail/u/{u}/" },
    { id: "s2", icon: "📁", label: "Drive", url: "https://drive.google.com/drive/u/{u}/" },
    { id: "s3", icon: "📅", label: "Calendar", url: "https://calendar.google.com/calendar/u/{u}/r" },
    { id: "s4", icon: "🖼️", label: "Photos", url: "https://photos.google.com/u/{u}/" },
    { id: "s5", icon: "▶️", label: "YouTube", url: "https://www.youtube.com" },
    { id: "s6", icon: "📍", label: "Maps", url: "https://www.google.com/maps" },
  ],
};

const CHIP_COLORS = ["#C8102E", "#0A2A5E", "#1463a0", "#A2AAAD", "#2e7d32", "#8e44ad"];

/* ---------- state ---------- */
const state = {
  settings: loadSettings(),
  todos: loadTodos(),
  music: { tracks: [], idx: -1, order: [], orderPos: -1, audio: new Audio(), sessionTracks: [] },
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!over || typeof over !== "object") return out;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && typeof base[k] === "object") {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}
function loadSettings() {
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  try { return deepMerge(base, JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}")); }
  catch { return base; }
}
function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
function loadTodos() {
  try { return JSON.parse(localStorage.getItem(LS_TODOS) || "[]"); } catch { return []; }
}
function saveTodos() { localStorage.setItem(LS_TODOS, JSON.stringify(state.todos)); }

/* ====================================================================
   Apply settings to the DOM
   ==================================================================== */
function applySettings() {
  const s = state.settings;

  $("#brandName").textContent = s.brandName || "CAPITALS";
  $("#brandLogo").src = s.logoDataUrl || "assets/logo.svg";

  toggleHidden(".hero__time", !s.show.clock);
  toggleHidden("#weatherCard", !s.show.weather);
  toggleHidden("#todoCard", !s.show.todo);
  toggleHidden("#musicCard", !s.show.music);
  toggleHidden("#quickLinks", !s.show.quicklinks);
  toggleHidden("#accountChips", !s.show.accounts);
  toggleHidden("#addAccountBtn", !s.show.accounts);

  document.body.dataset.bgSpeed = s.bg.speed;
  document.body.classList.toggle("bg-static", !s.bg.animate);
  document.documentElement.style.setProperty("--bg-intensity", String(s.bg.intensity));

  state.music.audio.volume = s.music.volume;
}
function toggleHidden(sel, hidden) {
  const el = $(sel);
  if (el) el.classList.toggle("is-hidden", hidden);
}

/* ====================================================================
   Clock + date
   ==================================================================== */
function tickClock() {
  const now = new Date();
  const clockEl = $("#clock");
  const s = state.settings;
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  if (s.clock24) {
    clockEl.textContent = `${String(h).padStart(2, "0")}:${m}:${sec}`;
  } else {
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    clockEl.innerHTML = `${h}:${m}:${sec}<span class="ampm">${ampm}</span>`;
  }
  $("#date").textContent = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

/* ====================================================================
   Weather (Open-Meteo, no API key)
   ==================================================================== */
const WMO = {
  0: ["Clear sky", "☀️", "🌙"],
  1: ["Mainly clear", "🌤️", "🌙"],
  2: ["Partly cloudy", "⛅", "☁️"],
  3: ["Overcast", "☁️", "☁️"],
  45: ["Fog", "🌫️", "🌫️"], 48: ["Rime fog", "🌫️", "🌫️"],
  51: ["Light drizzle", "🌦️", "🌦️"], 53: ["Drizzle", "🌦️", "🌦️"], 55: ["Dense drizzle", "🌧️", "🌧️"],
  56: ["Freezing drizzle", "🌨️", "🌨️"], 57: ["Freezing drizzle", "🌨️", "🌨️"],
  61: ["Light rain", "🌦️", "🌦️"], 63: ["Rain", "🌧️", "🌧️"], 65: ["Heavy rain", "🌧️", "🌧️"],
  66: ["Freezing rain", "🌨️", "🌨️"], 67: ["Freezing rain", "🌨️", "🌨️"],
  71: ["Light snow", "🌨️", "🌨️"], 73: ["Snow", "❄️", "❄️"], 75: ["Heavy snow", "❄️", "❄️"],
  77: ["Snow grains", "❄️", "❄️"],
  80: ["Rain showers", "🌦️", "🌦️"], 81: ["Rain showers", "🌧️", "🌧️"], 82: ["Violent showers", "⛈️", "⛈️"],
  85: ["Snow showers", "🌨️", "🌨️"], 86: ["Snow showers", "❄️", "❄️"],
  95: ["Thunderstorm", "⛈️", "⛈️"], 96: ["Thunderstorm, hail", "⛈️", "⛈️"], 99: ["Thunderstorm, hail", "⛈️", "⛈️"],
};

let weatherTimer = null;

async function geocode(city) {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const j = await r.json();
    return (j.results && j.results[0]) || null;
  } catch { return null; }
}
function tryGeolocation() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 }
    );
  });
}
async function resolveLocation() {
  const w = state.settings.weather;
  if (w.mode === "manual" && w.city.trim()) {
    const g = await geocode(w.city.trim());
    if (g) return { lat: g.latitude, lon: g.longitude, name: `${g.name}${g.admin1 ? ", " + g.admin1 : ""}` };
  }
  const geo = await tryGeolocation();
  if (geo) return { lat: geo.lat, lon: geo.lon, name: "Current location" };
  return { lat: 38.9072, lon: -77.0369, name: "Washington, DC" };
}

async function loadWeather() {
  const unit = state.settings.tempUnit;
  const sym = unit === "celsius" ? "°C" : "°F";
  try {
    const loc = await resolveLocation();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&current=temperature_2m,apparent_temperature,weather_code,is_day`
      + `&daily=temperature_2m_max,temperature_2m_min`
      + `&temperature_unit=${unit}&wind_speed_unit=mph&timezone=auto`;
    const r = await fetch(url);
    const j = await r.json();
    const cur = j.current;
    const isDay = cur.is_day === 1;
    const [label, dayIcon, nightIcon] = WMO[cur.weather_code] || ["—", "🌡️", "🌡️"];
    const data = {
      temp: Math.round(cur.temperature_2m),
      feels: Math.round(cur.apparent_temperature),
      icon: isDay ? dayIcon : nightIcon,
      label,
      hi: Math.round(j.daily.temperature_2m_max[0]),
      lo: Math.round(j.daily.temperature_2m_min[0]),
      name: loc.name,
      sym,
    };
    renderWeather(data);
    localStorage.setItem(LS_WEATHER, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    renderWeatherError();
  }
}
function renderWeather(d) {
  $("#weatherIcon").textContent = d.icon;
  $("#weatherTemp").textContent = `${d.temp}${d.sym}`;
  $("#weatherCond").textContent = d.label;
  $("#weatherPlace").textContent = d.name;
  $("#weatherHilo").textContent = `H ${d.hi}${d.sym} · L ${d.lo}${d.sym} · feels ${d.feels}${d.sym}`;
}
function renderWeatherError() {
  if ($("#weatherCond").textContent === "—") {
    $("#weatherCond").textContent = "Unavailable";
    $("#weatherPlace").textContent = "Check your connection";
  }
}
function showCachedWeather() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_WEATHER) || "null");
    if (c && c.data) renderWeather(c.data);
  } catch {}
}
function startWeather() {
  showCachedWeather();
  loadWeather();
  if (weatherTimer) clearInterval(weatherTimer);
  weatherTimer = setInterval(loadWeather, 15 * 60 * 1000);
}

/* ====================================================================
   To-do list
   ==================================================================== */
function uid() { return Math.random().toString(36).slice(2, 9); }

function renderTodos() {
  const list = $("#todoList");
  list.innerHTML = "";
  const remaining = state.todos.filter((t) => !t.done).length;
  $("#todoCount").textContent = String(remaining);
  $("#todoEmpty").style.display = state.todos.length ? "none" : "block";

  for (const t of state.todos) {
    const li = document.createElement("li");
    li.className = "todo__item" + (t.done ? " done" : "");
    li.dataset.id = t.id;

    const check = document.createElement("button");
    check.className = "todo__check";
    check.type = "button";
    check.textContent = "✓";
    check.title = "Toggle complete";
    check.addEventListener("click", () => toggleTodo(t.id));

    const text = document.createElement("span");
    text.className = "todo__text";
    text.textContent = t.text;
    text.title = "Click to edit";
    text.addEventListener("click", () => beginEdit(text, t.id));

    const del = document.createElement("button");
    del.className = "todo__del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("click", () => deleteTodo(t.id));

    li.append(check, text, del);
    list.appendChild(li);
  }
}
function addTodo(textRaw) {
  const text = textRaw.trim();
  if (!text) return;
  state.todos.unshift({ id: uid(), text, done: false });
  saveTodos();
  renderTodos();
}
function toggleTodo(id) {
  const t = state.todos.find((x) => x.id === id);
  if (t) { t.done = !t.done; saveTodos(); renderTodos(); }
}
function deleteTodo(id) {
  state.todos = state.todos.filter((x) => x.id !== id);
  saveTodos();
  renderTodos();
}
function beginEdit(span, id) {
  span.setAttribute("contenteditable", "true");
  span.focus();
  const range = document.createRange();
  range.selectNodeContents(span);
  const selSel = window.getSelection();
  selSel.removeAllRanges();
  selSel.addRange(range);

  const finish = () => {
    span.removeAttribute("contenteditable");
    const t = state.todos.find((x) => x.id === id);
    const val = span.textContent.trim();
    if (t) {
      if (val) { t.text = val; } else { span.textContent = t.text; }
      saveTodos();
      renderTodos();
    }
  };
  span.addEventListener("blur", finish, { once: true });
  span.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); span.blur(); }
    if (e.key === "Escape") { span.textContent = (state.todos.find((x) => x.id === id) || {}).text || ""; span.blur(); }
  });
}

/* ====================================================================
   Search (Google or direct URL)
   ==================================================================== */
function looksLikeUrl(q) {
  if (/\s/.test(q)) return false;
  if (/^https?:\/\//i.test(q)) return true;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(q)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(q);
}
function normalizeUrl(q) {
  return /^https?:\/\//i.test(q) ? q : "https://" + q;
}
function initSearch() {
  const form = $("#searchForm");
  const input = $("#searchInput");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const url = looksLikeUrl(q) ? normalizeUrl(q) : "https://www.google.com/search?q=" + encodeURIComponent(q);
    window.open(url, "_blank", "noopener");
  });
}

/* ====================================================================
   Google accounts + quick links
   ==================================================================== */
function activeAccount() {
  const s = state.settings;
  return s.accounts.find((a) => a.id === s.activeAccountId) || s.accounts[0] || { index: 0, label: "Account" };
}
function renderAccounts() {
  const wrap = $("#accountChips");
  wrap.innerHTML = "";
  const active = activeAccount();
  for (const a of state.settings.accounts) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (a.id === active.id ? " is-active" : "");
    chip.style.background = a.color || "#C8102E";
    chip.textContent = (a.label || "?").trim().charAt(0).toUpperCase() || "?";
    chip.title = `${a.label} — click to make active (Google slot /u/${a.index}/)`;
    chip.addEventListener("click", () => {
      state.settings.activeAccountId = a.id;
      saveSettings();
      renderAccounts();
      renderQuickLinks();
    });
    wrap.appendChild(chip);
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeUrl(u) {
  u = (u || "").trim();
  if (/^javascript:/i.test(u)) return "#";
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (!u || u === "#") return "#";
  return "https://" + u;
}
function renderQuickLinks() {
  const nav = $("#quickLinks");
  nav.innerHTML = "";
  const n = activeAccount().index || 0;
  for (const sc of state.settings.shortcuts) {
    const a = document.createElement("a");
    a.href = safeUrl((sc.url || "").replaceAll("{u}", String(n)));
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML = `${sc.icon ? `<span class="ql-ico">${escapeHtml(sc.icon)}</span>` : ""}${escapeHtml(sc.label || "Link")}`;
    nav.appendChild(a);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ql-edit";
  edit.title = "Add or edit shortcuts";
  edit.innerHTML = `<span class="ql-ico">✎</span>Edit`;
  edit.addEventListener("click", () => openSettings("shortcuts"));
  nav.appendChild(edit);
}
function initAccounts() {
  $("#addAccountBtn").addEventListener("click", () => {
    window.open("https://accounts.google.com/AddSession", "_blank", "noopener");
  });
}

/* ====================================================================
   Music player
   ==================================================================== */
function fmtTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function titleFromName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}
async function loadSupabaseTracks() {
  if (!SUPABASE.url || !SUPABASE.anonKey) return [];
  try {
    const r = await fetch(`${SUPABASE.url}/storage/v1/object/list/${SUPABASE.bucket}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${SUPABASE.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: "", limit: 1000, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) return [];
    const items = await r.json();
    if (!Array.isArray(items)) return [];
    return items
      // folders have id === null; keep real audio files only
      .filter((o) => o && o.name && o.id && /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(o.name))
      .map((o) => ({
        title: titleFromName(o.name),
        src: `${SUPABASE.url}/storage/v1/object/public/${SUPABASE.bucket}/${encodeURIComponent(o.name)}`,
      }));
  } catch {
    return [];
  }
}
async function loadPlaylist() {
  // 1) Supabase bucket — your music, synced across every device.
  let tracks = await loadSupabaseTracks();
  // 2) live folder listing from the local PowerShell server (local use only)
  if (!tracks.length) {
    try {
      const r = await fetch("/api/music", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j)) tracks = j.map((t) => ({ title: t.title || titleFromName(t.src || ""), src: t.src }));
      }
    } catch {}
  }
  // 3) static manifest fallback
  if (!tracks.length) {
    try {
      const r = await fetch("music/tracks.json", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j)) tracks = j.map((t) => ({ title: t.title || titleFromName(t.src || ""), src: t.src }));
      }
    } catch {}
  }
  // 4) plus anything added from Settings this session
  tracks = tracks.concat(state.music.sessionTracks);
  setTracks(tracks);
}
function setTracks(tracks) {
  state.music.tracks = tracks;
  buildOrder();
  renderMusicList();
  const has = tracks.length > 0;
  $("#musicEmpty").style.display = has ? "none" : "block";
  $("#musicList").style.display = has ? "block" : "none";
  if (has && state.settings.music.autoplay && state.music.idx < 0) playIndex(state.music.order[0] ?? 0);
}
function buildOrder() {
  const n = state.music.tracks.length;
  let order = Array.from({ length: n }, (_, i) => i);
  if (state.settings.music.shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  state.music.order = order;
  state.music.orderPos = order.indexOf(state.music.idx);
}
function renderMusicList() {
  const ul = $("#musicList");
  ul.innerHTML = "";
  state.music.tracks.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = "music__track" + (i === state.music.idx ? " is-playing" : "");
    li.textContent = " " + t.title;
    li.title = t.title;
    li.addEventListener("click", () => playIndex(i));
    ul.appendChild(li);
  });
}
function playIndex(i) {
  const m = state.music;
  if (i < 0 || i >= m.tracks.length) return;
  m.idx = i;
  m.orderPos = m.order.indexOf(i);
  m.audio.src = m.tracks[i].src;
  m.audio.play().catch(() => {});
  $("#musicTitle").textContent = m.tracks[i].title;
  updatePlayBtn();
  renderMusicList();
}
function updatePlayBtn() {
  $("#musicPlay").textContent = state.music.audio.paused ? "▶" : "⏸";
}
function togglePlay() {
  const m = state.music;
  if (!m.tracks.length) return;
  if (m.idx < 0) { playIndex(m.order[0] ?? 0); return; }
  if (m.audio.paused) m.audio.play().catch(() => {});
  else m.audio.pause();
  updatePlayBtn();
}
function step(dir) {
  const m = state.music;
  if (!m.tracks.length) return;
  let pos = (m.orderPos < 0 ? 0 : m.orderPos) + dir;
  if (pos < 0) pos = m.order.length - 1;
  if (pos >= m.order.length) pos = 0;
  playIndex(m.order[pos]);
}
function initMusic() {
  const m = state.music;
  const audio = m.audio;
  audio.volume = state.settings.music.volume;

  $("#musicPlay").addEventListener("click", togglePlay);
  $("#musicNext").addEventListener("click", () => step(1));
  $("#musicPrev").addEventListener("click", () => step(-1));

  const shuffleBtn = $("#musicShuffle");
  shuffleBtn.classList.toggle("is-on", state.settings.music.shuffle);
  shuffleBtn.addEventListener("click", () => {
    state.settings.music.shuffle = !state.settings.music.shuffle;
    shuffleBtn.classList.toggle("is-on", state.settings.music.shuffle);
    const sb = $("#setMusicShuffle"); if (sb) sb.checked = state.settings.music.shuffle;
    saveSettings();
    buildOrder();
  });

  const vol = $("#musicVol");
  vol.value = String(Math.round(state.settings.music.volume * 100));
  vol.addEventListener("input", () => {
    const v = Number(vol.value) / 100;
    audio.volume = v;
    state.settings.music.volume = v;
    saveSettings();
  });

  const seek = $("#musicSeek");
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) {
      seek.value = String((audio.currentTime / audio.duration) * 100);
      $("#musicCur").textContent = fmtTime(audio.currentTime);
    }
  });
  audio.addEventListener("loadedmetadata", () => { $("#musicDur").textContent = fmtTime(audio.duration); });
  audio.addEventListener("ended", () => step(1));
  audio.addEventListener("play", updatePlayBtn);
  audio.addEventListener("pause", updatePlayBtn);
  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (Number(seek.value) / 100) * audio.duration;
  });

  $("#musicRefresh").addEventListener("click", loadPlaylist);
  $("#musicAdd").addEventListener("click", () => $("#musicUpFiles").click());
  $("#musicUpFiles").addEventListener("change", (e) => {
    if (e.target.files.length) uploadFilesToCloud(e.target.files);
    e.target.value = "";
  });
  loadPlaylist();
}
function addSessionFiles(fileList) {
  for (const f of fileList) {
    state.music.sessionTracks.push({ title: titleFromName(f.name), src: URL.createObjectURL(f) });
  }
  loadPlaylist();
}

/* ---------- upload to your Supabase library (saves to every device) ----------
   The browser never holds the admin key. It POSTs the file + your passphrase
   to the upload-music Edge Function, which checks the passphrase server-side
   and does the privileged write. */
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
function getUploadPass() { return (localStorage.getItem(LS_UPLOAD_PASS) || "").trim(); }
function setUploadPass(v) {
  v = (v || "").trim();
  if (v) localStorage.setItem(LS_UPLOAD_PASS, v);
  else localStorage.removeItem(LS_UPLOAD_PASS);
  const f = $("#setUploadPass"); if (f) f.value = v;
}
function setMusicStatus(msg, kind) {
  const el = $("#musicStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}
async function uploadOneTrack(file, pass) {
  const r = await fetch(`${SUPABASE.url}/functions/v1/upload-music`, {
    method: "POST",
    headers: {
      "x-upload-pass": pass,
      "x-file-name": encodeURIComponent(file.name),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401) { const e = new Error("Wrong passphrase"); e.code = 401; throw e; }
  if (!r.ok || !data.ok) throw new Error(data.error || `Upload failed (${r.status})`);
  return data;
}
async function uploadFilesToCloud(fileList) {
  const files = Array.from(fileList).filter((f) => AUDIO_RE.test(f.name));
  if (!files.length) { setMusicStatus("Pick audio files (mp3, m4a, wav, flac…).", "error"); return; }
  let pass = getUploadPass();
  if (!pass) {
    pass = (prompt("Enter your music upload passphrase (saved on this device after the first time):") || "").trim();
    if (!pass) { setMusicStatus("Upload cancelled — no passphrase entered.", "error"); return; }
  }
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setMusicStatus(`Uploading ${f.name}… (${i + 1}/${files.length})`);
    try {
      await uploadOneTrack(f, pass);
      ok++;
    } catch (e) {
      if (e.code === 401) {
        setUploadPass("");
        setMusicStatus("Wrong passphrase — cleared. Set it again in Settings ▸ Music.", "error");
        return;
      }
      setMusicStatus(`Couldn’t add ${f.name}: ${e.message}`, "error");
    }
  }
  if (ok) {
    setUploadPass(pass); // remember the passphrase that worked
    setMusicStatus(`Added ${ok} song${ok > 1 ? "s" : ""} to your library ✓`, "ok");
    await loadPlaylist();
    setTimeout(() => { const el = $("#musicStatus"); if (el && el.classList.contains("is-ok")) setMusicStatus(""); }, 4000);
  }
}

/* ====================================================================
   Settings panel
   ==================================================================== */
function openSettings(section) {
  populateSettings();
  $("#settingsPanel").classList.add("open");
  $("#settingsPanel").setAttribute("aria-hidden", "false");
  $("#settingsOverlay").hidden = false;
  if (section === "shortcuts") {
    setTimeout(() => $("#setShortcutsGroup").scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
}
function closeSettings() {
  $("#settingsPanel").classList.remove("open");
  $("#settingsPanel").setAttribute("aria-hidden", "true");
  $("#settingsOverlay").hidden = true;
}
function setSeg(selector, attr, value) {
  $$(selector + " .seg__btn").forEach((b) => b.classList.toggle("is-active", b.dataset[attr] === String(value)));
}
function populateSettings() {
  const s = state.settings;
  $("#setBrandName").value = s.brandName;
  $("#setShowClock").checked = s.show.clock;
  $("#setShowWeather").checked = s.show.weather;
  $("#setShowTodo").checked = s.show.todo;
  $("#setShowMusic").checked = s.show.music;
  $("#setShowQuick").checked = s.show.quicklinks;
  $("#setShowAccounts").checked = s.show.accounts;
  $("#setClock24").checked = s.clock24;

  setSeg("#settingsPanel", "unit", s.tempUnit);
  setSeg("#settingsPanel", "wmode", s.weather.mode);
  $("#setCity").value = s.weather.city;
  $("#setCityRow").style.display = s.weather.mode === "manual" ? "" : "none";

  $("#setBgAnimate").checked = s.bg.animate;
  setSeg("#settingsPanel", "speed", s.bg.speed);
  $("#setBgIntensity").value = String(Math.round(s.bg.intensity * 100));

  $("#setMusicShuffle").checked = s.music.shuffle;
  $("#setMusicAutoplay").checked = s.music.autoplay;
  $("#setUploadPass").value = getUploadPass();

  renderAccountEditor();
  renderShortcutEditor();
}
function mkSmallBtn(text, title, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sc-btn";
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", fn);
  return b;
}
function moveShortcut(i, dir) {
  const list = state.settings.shortcuts;
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveSettings(); renderQuickLinks(); renderShortcutEditor();
}
function renderShortcutEditor() {
  const wrap = $("#setShortcutList");
  wrap.innerHTML = "";
  state.settings.shortcuts.forEach((sc, i) => {
    const row = document.createElement("div");
    row.className = "set-sc-row";

    const icon = document.createElement("input");
    icon.type = "text"; icon.className = "sc-icon"; icon.value = sc.icon || ""; icon.maxLength = 4;
    icon.title = "Icon (emoji)"; icon.placeholder = "🔗";
    icon.addEventListener("input", () => { sc.icon = icon.value; saveSettings(); renderQuickLinks(); });

    const label = document.createElement("input");
    label.type = "text"; label.className = "sc-label"; label.value = sc.label || ""; label.placeholder = "Label";
    label.addEventListener("input", () => { sc.label = label.value; saveSettings(); renderQuickLinks(); });

    const url = document.createElement("input");
    url.type = "text"; url.className = "sc-url"; url.value = sc.url || ""; url.placeholder = "https://…  (use {u} for account #)";
    url.addEventListener("input", () => { sc.url = url.value; saveSettings(); renderQuickLinks(); });

    const up = mkSmallBtn("↑", "Move up", () => moveShortcut(i, -1));
    const down = mkSmallBtn("↓", "Move down", () => moveShortcut(i, 1));
    const del = mkSmallBtn("✕", "Remove", () => {
      state.settings.shortcuts.splice(i, 1);
      saveSettings(); renderQuickLinks(); renderShortcutEditor();
    });
    del.classList.add("sc-del");

    row.append(icon, label, url, up, down, del);
    wrap.appendChild(row);
  });
}
function renderAccountEditor() {
  const wrap = $("#setAccountList");
  wrap.innerHTML = "";
  state.settings.accounts.forEach((a) => {
    const row = document.createElement("div");
    row.className = "set-acct-row";

    const label = document.createElement("input");
    label.type = "text";
    label.value = a.label;
    label.placeholder = "Label (e.g. Work)";
    label.addEventListener("input", () => { a.label = label.value; saveSettings(); renderAccounts(); });

    const index = document.createElement("input");
    index.type = "number";
    index.min = "0";
    index.className = "acct-index";
    index.value = String(a.index);
    index.title = "Google profile slot (/u/N/)";
    index.addEventListener("input", () => { a.index = Math.max(0, Number(index.value) || 0); saveSettings(); renderQuickLinks(); });

    const del = document.createElement("button");
    del.className = "acct-del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", () => {
      state.settings.accounts = state.settings.accounts.filter((x) => x.id !== a.id);
      if (state.settings.activeAccountId === a.id)
        state.settings.activeAccountId = (state.settings.accounts[0] || {}).id || null;
      saveSettings();
      renderAccounts(); renderQuickLinks(); renderAccountEditor();
    });

    row.append(label, index, del);
    wrap.appendChild(row);
  });
}
function initSettings() {
  $("#settingsBtn").addEventListener("click", () => openSettings());
  $("#settingsClose").addEventListener("click", closeSettings);
  $("#settingsOverlay").addEventListener("click", closeSettings);

  $("#setBrandName").addEventListener("input", (e) => {
    state.settings.brandName = e.target.value || "CAPITALS";
    applySettings(); saveSettings();
  });

  // logo
  $("#setLogoUpload").addEventListener("click", () => $("#setLogoFile").click());
  $("#setLogoFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { state.settings.logoDataUrl = reader.result; applySettings(); saveSettings(); };
    reader.readAsDataURL(file);
  });
  $("#setLogoReset").addEventListener("click", () => {
    state.settings.logoDataUrl = null; applySettings(); saveSettings();
  });

  // shortcuts bar
  $("#setAddShortcut").addEventListener("click", () => {
    state.settings.shortcuts.push({ id: uid(), icon: "🔗", label: "New link", url: "https://" });
    saveSettings(); renderQuickLinks(); renderShortcutEditor();
  });

  // widget toggles
  const toggleMap = {
    setShowClock: "clock", setShowWeather: "weather", setShowTodo: "todo",
    setShowMusic: "music", setShowQuick: "quicklinks", setShowAccounts: "accounts",
  };
  for (const [id, key] of Object.entries(toggleMap)) {
    $("#" + id).addEventListener("change", (e) => {
      state.settings.show[key] = e.target.checked;
      applySettings(); saveSettings();
    });
  }
  $("#setClock24").addEventListener("change", (e) => {
    state.settings.clock24 = e.target.checked; saveSettings(); tickClock();
  });

  // weather units / mode / city
  $$("#settingsPanel .seg__btn[data-unit]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.tempUnit = b.dataset.unit; setSeg("#settingsPanel", "unit", b.dataset.unit);
      saveSettings(); loadWeather();
    }));
  $$("#settingsPanel .seg__btn[data-wmode]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.weather.mode = b.dataset.wmode; setSeg("#settingsPanel", "wmode", b.dataset.wmode);
      $("#setCityRow").style.display = b.dataset.wmode === "manual" ? "" : "none";
      saveSettings(); loadWeather();
    }));
  $("#setCity").addEventListener("change", (e) => {
    state.settings.weather.city = e.target.value; saveSettings();
    if (state.settings.weather.mode === "manual") loadWeather();
  });

  // background
  $("#setBgAnimate").addEventListener("change", (e) => {
    state.settings.bg.animate = e.target.checked; applySettings(); saveSettings();
  });
  $$("#settingsPanel .seg__btn[data-speed]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.bg.speed = b.dataset.speed; setSeg("#settingsPanel", "speed", b.dataset.speed);
      applySettings(); saveSettings();
    }));
  $("#setBgIntensity").addEventListener("input", (e) => {
    state.settings.bg.intensity = Number(e.target.value) / 100; applySettings(); saveSettings();
  });

  // accounts
  $("#setAddAccount").addEventListener("click", () => {
    const used = state.settings.accounts.map((a) => a.index);
    let idx = 0; while (used.includes(idx)) idx++;
    state.settings.accounts.push({
      id: uid(), label: "Account " + (state.settings.accounts.length + 1),
      index: idx, color: CHIP_COLORS[state.settings.accounts.length % CHIP_COLORS.length],
    });
    saveSettings(); renderAccounts(); renderQuickLinks(); renderAccountEditor();
  });

  // music settings
  $("#setMusicShuffle").addEventListener("change", (e) => {
    state.settings.music.shuffle = e.target.checked;
    $("#musicShuffle").classList.toggle("is-on", e.target.checked);
    saveSettings(); buildOrder();
  });
  $("#setMusicAutoplay").addEventListener("change", (e) => {
    state.settings.music.autoplay = e.target.checked; saveSettings();
  });
  $("#setMusicAdd").addEventListener("click", () => $("#setMusicFiles").click());
  $("#setMusicFiles").addEventListener("change", (e) => { if (e.target.files.length) addSessionFiles(e.target.files); });
  $("#setUploadPass").addEventListener("change", (e) => setUploadPass(e.target.value));
  $("#setUploadCloud").addEventListener("click", () => $("#setUploadFiles").click());
  $("#setUploadFiles").addEventListener("change", (e) => { if (e.target.files.length) uploadFilesToCloud(e.target.files); e.target.value = ""; });

  // reset
  $("#setReset").addEventListener("click", () => {
    if (!confirm("Reset all settings, to-dos and preferences to default?")) return;
    localStorage.removeItem(LS_SETTINGS);
    localStorage.removeItem(LS_TODOS);
    localStorage.removeItem(LS_WEATHER);
    location.reload();
  });
}

/* ====================================================================
   Boot
   ==================================================================== */
function init() {
  applySettings();

  tickClock();
  setInterval(tickClock, 1000);

  renderTodos();
  $("#todoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    addTodo($("#todoInput").value);
    $("#todoInput").value = "";
  });

  initSearch();
  initAccounts();
  renderAccounts();
  renderQuickLinks();
  initMusic();
  initSettings();

  startWeather();
  $("#weatherRefresh").addEventListener("click", loadWeather);

  // ?focus=search shortcut
  if (new URLSearchParams(location.search).get("focus") === "search") {
    setTimeout(() => $("#searchInput").focus(), 50);
  }

  // PWA service worker
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
}

init();
