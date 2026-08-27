// The playlist is a derived view of the same data: the games flagged in field 7.
const LIST = document.body.dataset.list || "canon";
const DATA = LIST === "playlist" ? window.GAMES.filter(g => g[6]) : window.GAMES;
const CONSOLE_ORDER = ["Arcade","Atari 2600","MSX","NES","Game Boy","Genesis","SNES","DOS","PS1","N64","GBA","GameCube","PS2","DS","Wii","PS3","3DS","Wii U","PS4","Switch (NSO)","Switch 2","PS5","PC (Steam)","PC (Other)"];

const STORAGE_KEY = "games-list-progress-v1";
const keyOf = g => g[0] + "|" + g[1];
let checked = new Set();
let minRating = 0;
let query = "";
let view = "year";
let saveTimer = null;
let sections = []; // {indices, countEl, secEl}

const list = document.getElementById("list");

function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;"); }

function makeRow(i, showYearInMethod){
  const g = DATA[i];
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.i = i;
  row.setAttribute("role","checkbox");
  row.setAttribute("aria-checked","false");
  row.setAttribute("tabindex","0");
  const method = showYearInMethod ? (g[0] + " · " + g[3]) : g[3];
  row.innerHTML =
    "<div class='box'>&#10003;</div>" +
    "<div class='titles'><span class='title'>" + esc(g[1]) + "</span>" +
    "<div class='method'>" + esc(method) + "</div></div>" +
      "<div class='time'>" + esc(g[5]) + "</div>" +
    "<div class='rating r" + g[2] + "'>" + g[2] + "</div>";
  row.addEventListener("click", () => toggle(i, row));
  row.addEventListener("keydown", e => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(i, row); }
  });
  return row;
}

function makeSection(label, indices, showYearInMethod, yearLabels){
  const sec = document.createElement("section");
  sec.className = "decade";
  const head = document.createElement("div");
  head.className = "dhead";
  const countEl = document.createElement("span");
  countEl.className = "dcount";
  head.innerHTML = "<h2>" + esc(label) + "</h2>";
  head.appendChild(countEl);
  sec.appendChild(head);

  let lastYear = null;
  for (const i of indices) {
    if (yearLabels && DATA[i][0] !== lastYear) {
      lastYear = DATA[i][0];
      const yl = document.createElement("div");
      yl.className = "yearlabel";
      yl.textContent = lastYear;
      sec.appendChild(yl);
    }
    sec.appendChild(makeRow(i, showYearInMethod));
  }
  list.appendChild(sec);
  sections.push({indices, countEl, secEl: sec});
}

function render(){
  list.innerHTML = "";
  sections = [];
  if (view === "year") {
    const groups = {};
    DATA.forEach((g,i) => {
      const d = Math.floor(g[0]/10)*10;
      (groups[d] = groups[d] || []).push(i);
    });
    for (const d of Object.keys(groups).sort((a,b)=>a-b)) {
      makeSection(d + "s", groups[d], false, true);
    }
  } else {
    const groups = {};
    DATA.forEach((g,i) => {
      (groups[g[4]] = groups[g[4]] || []).push(i);
    });
    for (const c of CONSOLE_ORDER) {
      if (groups[c]) makeSection(c, groups[c], true, false);
    }
  }
  applyChecked();
  applyFilter();
}

function toggle(i, row){
  const k = keyOf(DATA[i]);
  if (checked.has(k)) checked.delete(k); else checked.add(k);
  row.classList.toggle("done", checked.has(k));
  row.setAttribute("aria-checked", checked.has(k) ? "true" : "false");
  updateCounts();
  scheduleSave();
}

function updateCounts(){
  const done = DATA.filter(g => checked.has(keyOf(g))).length;
  document.getElementById("nDone").textContent = done;
  document.getElementById("mainFill").style.width = (done / DATA.length * 100) + "%";
  for (const s of sections) {
    const dd = s.indices.filter(i => checked.has(keyOf(DATA[i]))).length;
    s.countEl.textContent = dd + "/" + s.indices.length;
  }
}

function applyChecked(){
  document.querySelectorAll(".row").forEach(row => {
    const on = checked.has(keyOf(DATA[row.dataset.i]));
    row.classList.toggle("done", on);
    row.setAttribute("aria-checked", on ? "true" : "false");
  });
  updateCounts();
}

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
async function save(){
  const payload = JSON.stringify([...checked]);
  try {
    if (window.storage) await window.storage.set(STORAGE_KEY, payload);
    else localStorage.setItem(STORAGE_KEY, payload);
  } catch(e){ console.error("Save failed", e); }
}
async function load(){
  try {
    let raw = null;
    if (window.storage) {
      const res = await window.storage.get(STORAGE_KEY);
      raw = res && res.value;
    } else {
      raw = localStorage.getItem(STORAGE_KEY);
    }
    if (raw) checked = new Set(JSON.parse(raw));
  } catch(e){ /* first run, or storage blocked */ }
  applyChecked();
}
// both lists share one store, so keep an open tab of the other page in sync
window.addEventListener("storage", e => {
  if (e.key !== STORAGE_KEY || e.newValue == null) return;
  try { checked = new Set(JSON.parse(e.newValue)); applyChecked(); } catch(err){}
});

function matches(g){
  return g[2] >= minRating && (!query || g[1].toLowerCase().includes(query));
}

function applyFilter(){
  let visible = 0;
  document.querySelectorAll(".row").forEach(row => {
    const show = matches(DATA[row.dataset.i]);
    row.style.display = show ? "" : "none";
    if (show) visible++;
  });
  document.querySelectorAll(".yearlabel").forEach(yl => {
    let el = yl.nextElementSibling, any = false;
    while (el && el.classList.contains("row")) {
      if (el.style.display !== "none") { any = true; break; }
      el = el.nextElementSibling;
    }
    yl.style.display = any ? "" : "none";
  });
  for (const s of sections) {
    s.secEl.style.display = s.indices.some(i => matches(DATA[i])) ? "" : "none";
  }
  document.getElementById("empty").style.display = visible ? "none" : "block";
}

document.getElementById("search").addEventListener("input", e => {
  query = e.target.value.trim().toLowerCase();
  applyFilter();
});
document.querySelectorAll(".chip[data-min]").forEach(btn => {
  btn.addEventListener("click", () => {
    minRating = +btn.dataset.min;
    document.querySelectorAll(".chip[data-min]").forEach(b =>
      b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    applyFilter();
  });
});
document.querySelectorAll(".chip[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (view === btn.dataset.view) return;
    view = btn.dataset.view;
    document.querySelectorAll(".chip[data-view]").forEach(b =>
      b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    render();
  });
});

function copyList(done){
  const lines = DATA
    .filter(g => checked.has(keyOf(g)) === done)
    .map(g => g[1] + " (" + g[0] + ")");
  const text = lines.join("\n");
  const finish = () => showToast(lines.length + " titles copied");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
  } else {
    fallbackCopy(text, finish);
  }
}
function fallbackCopy(text, cb){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); cb(); } catch(e){ showToast("Copy failed"); }
  document.body.removeChild(ta);
}
let toastTimer = null;
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
document.getElementById("copyRemaining").addEventListener("click", () => copyList(false));
document.getElementById("copyDone").addEventListener("click", () => copyList(true));

document.getElementById("nTotal").textContent = DATA.length;
render();
load();
