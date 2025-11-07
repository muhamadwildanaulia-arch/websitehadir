// app.js — versi final, robust, mobile-friendly
// - fetch no-cache dari GOOGLE_SCRIPT_URL (Sheet 'guru' & 'kehadiran')
// - isi dropdown guru, anti-duplikat 1x/hari (local + server)
// - geofence (SCHOOL_LAT / SCHOOL_LON, limit 100m), terlambat setelah 07:30
// - pratinjau foto lokal (tidak dikirim ke server)
// - doughnut chart ringan & responsif (Chart.js v3+)
// - fallback clickable list jika select tidak ada
// - safe against timing / double-submit

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

// koordinat sekolah (diterima dari user)
const SCHOOL_LAT = -6.7010469;
const SCHOOL_LON = 107.0521643;
const RADIUS_LIMIT_M = 100;

let teachers = [];
let attendanceRecords = [];
let dailyChart = null;
let lastCounts = null;
let submitting = false;
let lastLat = null, lastLon = null;

/* ----------------- Utilities ----------------- */
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function todayISO() { return new Date().toISOString().split('T')[0]; }
function normalizeDate(v) {
  if (!v) return "";
  if (typeof v === "string" && v.includes("T")) {
    const d = new Date(v);
    d.setHours(d.getHours() + 7); // adjust if sheet uses UTC
    return d.toISOString().split("T")[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return !isNaN(d) ? d.toISOString().split("T")[0] : String(v).trim();
}
function normalizeName(s = "") { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function escapeHtml(s = "") { return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"','&quot;'); }
async function fetchJsonNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  const full = `${url}${sep}_ts=${Date.now()}`;
  const res = await fetch(full, { cache: "no-store", headers: { "cache-control": "no-cache", pragma: "no-cache" }});
  return res.json();
}

/* ----------------- Small avatar helper ----------------- */
const AVATAR_COLORS = ["#1D4ED8","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#22C55E","#E11D48"];
function hashCode(s) { let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }
function initials(name = "") { const p = name.trim().split(/\s+/); return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase() || "?"; }
function avatarHtml(name = "") { const c = AVATAR_COLORS[hashCode(name) % AVATAR_COLORS.length]; return `<span class="avatar" style="background:${c}">${initials(name)}</span><span>${escapeHtml(name)}</span>`; }

/* ----------------- Analog clock (ke aesthetic) ----------------- */
function drawAnalogClock() {
  const canvas = document.getElementById("analogClock");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const radius = canvas.height / 2;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate(radius, radius);

  function drawFace() {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.95, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = "#1e3a8a"; ctx.lineWidth = radius * 0.05; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, radius * 0.05, 0, 2*Math.PI); ctx.fillStyle = "#1e3a8a"; ctx.fill();
  }
  function drawNumbers() {
    ctx.font = radius * 0.15 + "px Arial";
    ctx.textBaseline = "middle"; ctx.textAlign = "center";
    for (let num = 1; num <= 12; num++) {
      const ang = (num * Math.PI) / 6;
      ctx.rotate(ang); ctx.translate(0, -radius * 0.85); ctx.rotate(-ang);
      ctx.fillText(num.toString(), 0, 0);
      ctx.rotate(ang); ctx.translate(0, radius * 0.85); ctx.rotate(-ang);
    }
  }
  function drawHand(pos, length, width, color) {
    ctx.beginPath(); ctx.lineWidth = width; ctx.lineCap = "round"; ctx.strokeStyle = color;
    ctx.moveTo(0,0); ctx.rotate(pos); ctx.lineTo(0, -length); ctx.stroke(); ctx.rotate(-pos);
  }
  function drawTime() {
    const now = new Date();
    const hour = now.getHours() % 12;
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const hourPos = ((hour * Math.PI) / 6) + ((minute * Math.PI) / (6 * 60)) + ((second * Math.PI) / (360 * 60));
    const minutePos = ((minute * Math.PI) / 30) + ((second * Math.PI) / (30 * 60));
    const secondPos = (second * Math.PI) / 30;
    drawHand(hourPos, radius * 0.5, radius * 0.07, "#1e3a8a");
    drawHand(minutePos, radius * 0.8, radius * 0.05, "#2563eb");
    drawHand(secondPos, radius * 0.9, radius * 0.02, "#ef4444");
  }
  function drawClock() {
    ctx.clearRect(-radius, -radius, canvas.width, canvas.height);
    drawFace(); drawNumbers(); drawTime();
  }
  drawClock();
  if (window._analogClockInterval) clearInterval(window._analogClockInterval);
  window._analogClockInterval = setInterval(drawClock, 1000);
}

/* ----------------- Load teachers (robust) ----------------- */
async function loadTeachers() {
  try {
    const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + "?sheet=guru");
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else if (raw && Array.isArray(raw.values)) rows = raw.values;
    else rows = [];

    if (!rows.length) {
      teachers = [];
      updateTeacherDropdown();
      return;
    }

    const first = rows[0];
    const dataRows = (Array.isArray(first) && first.some(c => /nama|nip|jabatan|status/i.test(String(c)))) ? rows.slice(1) : rows;
    teachers = dataRows.map(r => {
      if (Array.isArray(r)) {
        return { nama_guru: (r[0] ?? "").toString().trim(), nip: (r[1] ?? "").toString().trim(), jabatan: (r[2] ?? "").toString().trim(), status: (r[3] ?? "").toString().trim() };
      } else if (typeof r === "object" && r !== null) {
        return { nama_guru: (r.nama_guru ?? r[0] ?? "").toString().trim(), nip: (r.nip ?? r[1] ?? "").toString().trim(), jabatan: (r.jabatan ?? r[2] ?? ""), status: (r.status ?? r[3] ?? "") };
      } else {
        return { nama_guru: String(r ?? ""), nip: "", jabatan: "", status: "" };
      }
    }).filter(t => t.nama_guru);

    updateTeacherDropdown();
    document.dispatchEvent(new Event('teachers-updated'));
  } catch (e) {
    console.error("loadTeachers error", e);
    teachers = [];
    updateTeacherDropdown();
  }
}

/* ----------------- Update teacher dropdown ----------------- */
function updateTeacherDropdown() {
  const sel = document.getElementById("nama-guru-kehadiran");
  if (!sel) return;
  const prev = sel.value || "";
  sel.innerHTML = "";
  const ph = document.createElement("option"); ph.value = ""; ph.textContent = "-- Pilih Guru --"; sel.appendChild(ph);

  if (!teachers.length) {
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Belum ada data guru"; empty.disabled = true; sel.appendChild(empty);
    attachAlreadyCheckedWarning(sel);
    return;
  }

  teachers.forEach(t => {
    const o = document.createElement("option"); o.value = t.nama_guru; o.textContent = t.nama_guru; sel.appendChild(o);
  });

  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  attachAlreadyCheckedWarning(sel);
}

/* ----------------- Load attendance (robust) ----------------- */
async function loadAttendance() {
  try {
    const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + "?sheet=kehadiran");
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else if (raw && Array.isArray(raw.values)) rows = raw.values;
    else rows = [];

    if (rows.length >= 2) {
      const dataRows = rows.slice(1);
      attendanceRecords = dataRows.map(r => {
        if (Array.isArray(r)) return { nama_guru: r[0] ?? "", status: r[1] ?? "", jam: r[2] ?? "", tanggal: normalizeDate(r[3] ?? ""), lokasi: r[4] ?? "", foto_url: r[5] ?? "" };
        if (typeof r === "object" && r !== null) return { nama_guru: r.nama_guru ?? r[0] ?? "", status: r.status ?? r[1] ?? "", jam: r.jam ?? r[2] ?? "", tanggal: normalizeDate(r.tanggal ?? r[3] ?? ""), lokasi: r.lokasi ?? r[4] ?? "", foto_url: r.foto_url ?? r[5] ?? "" };
        return { nama_guru: String(r), status: "", jam: "", tanggal: "", lokasi: "" };
      });
    } else {
      attendanceRecords = [];
    }

    updateAttendanceToday();
    updateChartDebounced();
  } catch (e) {
    console.error("loadAttendance error", e);
    attendanceRecords = [];
    updateAttendanceToday();
  }
}

/* ----------------- Save attendance (POST to Apps Script) ----------------- */
async function saveAttendance(payload) {
  try {
    await fetch(GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify({ type: "attendance", data: payload }) });
  } catch (e) {
    console.error("saveAttendance error", e);
  }
}

/* ----------------- Attendance UI ----------------- */
function isTodayDateStr(d) {
  if (!d) return false;
  const t = new Date();
  const x = new Date(d);
  return x.getDate() === t.getDate() && x.getMonth() === t.getMonth() && x.getFullYear() === t.getFullYear();
}

function updateAttendanceToday() {
  const tbody = document.getElementById("attendance-list");
  if (!tbody) return;
  const todayData = attendanceRecords.filter(r => isTodayDateStr(r.tanggal));
  if (!todayData.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:.8rem;text-align:center">Belum ada kehadiran hari ini</td></tr>`;
    updateDuplicateAndBanners();
    return;
  }
  tbody.innerHTML = todayData.map(r => `
    <tr>
      <td style="padding:.6rem;border:1px solid #eef2f7">${avatarHtml(r.nama_guru)}</td>
      <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.status)}</td>
      <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.jam)}</td>
      <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.lokasi || "")}</td>
      <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.tanggal)}</td>
    </tr>`).join("");
  updateDuplicateAndBanners();
}

/* ----------------- Anti-dupe & banners ----------------- */
function hasSubmittedTodayServerSide(name) {
  if (!name) return false;
  const who = normalizeName(name), t = todayISO();
  return attendanceRecords.some(r => normalizeDate(r.tanggal) === t && normalizeName(r.nama_guru) === who);
}
function hasSubmittedTodayLocal(name) {
  if (!name) return false;
  return localStorage.getItem(`absen:${todayISO()}:${normalizeName(name)}`) === "1";
}
function markSubmittedLocal(name) {
  if (!name) return;
  localStorage.setItem(`absen:${todayISO()}:${normalizeName(name)}`, "1");
}
function showEl(el) { el?.classList.remove("hidden"); }
function hideEl(el) { el?.classList.add("hidden"); }

function updateAlreadyAbsentBanner(name) {
  const already = hasSubmittedTodayLocal(name) || hasSubmittedTodayServerSide(name);
  const banner = document.getElementById("already-banner");
  const btn = document.querySelector("#attendance-form button[type='submit']");
  const statusSel = document.getElementById("status-kehadiran");
  const warn = document.getElementById("warn-sudah-absen");
  if (already && name) {
    showEl(banner);
    if (warn) warn.textContent = "⚠️ Guru ini sudah mengisi kehadiran hari ini.";
    if (btn) { btn.disabled = true; btn.classList.add("opacity-60"); }
    if (statusSel) { statusSel.disabled = true; statusSel.classList.add("opacity-60"); }
  } else {
    hideEl(banner);
    if (warn) warn.textContent = "";
    if (btn) { btn.disabled = false; btn.classList.remove("opacity-60"); }
    if (statusSel) { statusSel.disabled = false; statusSel.classList.remove("opacity-60"); }
  }
}

/* terlambat setelah 07:30 */
function minutesLate(now = new Date()) {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30, 0);
  const diff = Math.floor((now - cutoff) / 60000);
  return diff > 0 ? diff : 0;
}
function updateLateBanner() {
  const mins = minutesLate(new Date());
  const b = document.getElementById("late-banner"), t = document.getElementById("late-minutes");
  if (mins > 0) { if (t) t.textContent = `(kesiangan ${mins} menit)`; showEl(b); } else hideEl(b);
}

/* ----------------- Distance (haversine) ----------------- */
function distanceMeters(lat1, lon1, lat2, lon2) {
  if ([lat1,lon1,lat2,lon2].some(v => v === null || v === undefined || isNaN(v))) return null;
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function updateDistanceBanner() {
  const b = document.getElementById("distance-banner"), info = document.getElementById("distance-info"), txt = document.getElementById("distance-text");
  const dist = distanceMeters(lastLat, lastLon, SCHOOL_LAT, SCHOOL_LON);
  if (dist === null) return;
  if (txt) txt.textContent = `Jarak Anda dari sekolah ± ${dist} m.`;
  if (info) {
    if (dist > RADIUS_LIMIT_M) {
      info.innerHTML = `<span class="badge" style="background:#FEF3C7;color:#92400E">⚠️ Di luar area (> ${RADIUS_LIMIT_M} m)</span>`;
      showEl(b);
    } else {
      info.innerHTML = `<span class="badge" style="background:#DCFCE7;color:#064E3B">🟢 Dalam area sekolah</span>`;
      hideEl(b);
    }
  }
}

/* called after attendance list update or selection change */
function updateDuplicateAndBanners() {
  const sel = document.getElementById("nama-guru-kehadiran");
  const name = sel?.value || "";
  updateAlreadyAbsentBanner(name);
  updateLateBanner();
  updateDistanceBanner();
}

/* attach check to select so UI updates on change */
function attachAlreadyCheckedWarning(selectEl) {
  if (!selectEl) return;
  const update = () => {
    const name = selectEl.value;
    // update banners & controls
    updateAlreadyAbsentBanner(name);
    updateLateBanner();
    updateDistanceBanner();
  };
  // ensure not duplicated
  if (!selectEl._hasChangeHook) {
    selectEl.addEventListener("change", update);
    selectEl._hasChangeHook = true;
  }
  update();
}

/* ----------------- Chart (doughnut, lightweight) ----------------- */
function getTodayCounts() {
  const t = todayISO();
  const todayRows = attendanceRecords.filter(r => normalizeDate(r.tanggal) === t);
  const counts = { Hadir:0, Izin:0, Sakit:0, "Dinas Luar":0 };
  todayRows.forEach(r => { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });
  // update small stats display
  document.getElementById('stat-hadir') && (document.getElementById('stat-hadir').textContent = counts.Hadir);
  document.getElementById('stat-izin') && (document.getElementById('stat-izin').textContent = counts.Izin);
  document.getElementById('stat-sakit') && (document.getElementById('stat-sakit').textContent = counts.Sakit);
  document.getElementById('stat-dl') && (document.getElementById('stat-dl').textContent = counts["Dinas Luar"]);
  return counts;
}
function sameCounts(a,b) { return !!a && !!b && a.Hadir === b.Hadir && a.Izin === b.Izin && a.Sakit === b.Sakit && a["Dinas Luar"] === b["Dinas Luar"]; }

function ensureChart() {
  const canvas = document.getElementById("dailyChart");
  if (!canvas) return null;
  if (dailyChart) return dailyChart;
  // create doughnut chart with minimal animation and maintainAspectRatio=false for responsiveness
  const ctx = canvas.getContext("2d");
  dailyChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels: ["Hadir","Izin","Sakit","Dinas Luar"], datasets: [{ data: [0,0,0,0], backgroundColor: ["#4CAF50","#FFC107","#F44336","#2196F3"], borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      animation: { duration: 200 },
      plugins: { legend: { position: "bottom" }, tooltip: { enabled: true } }
    }
  });
  return dailyChart;
}
const updateChartDebounced = debounce(updateChart, 100);
function updateChart() {
  const chart = ensureChart();
  if (!chart) return;
  const counts = getTodayCounts();
  if (sameCounts(counts, lastCounts)) return;
  chart.data.datasets[0].data = [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]];
  lastCounts = counts;
  chart.update("none");
}

/* ----------------- Geolocation (reverse via Nominatim for display) ----------------- */
function getLocation() {
  const locInput = document.getElementById("keterangan-lokasi");
  if (!locInput) return;
  if (!navigator.geolocation) { locInput.value = "Browser tidak mendukung GPS"; return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    lastLat = pos.coords.latitude; lastLon = pos.coords.longitude;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lastLat}&lon=${lastLon}`);
      const j = await res.json();
      locInput.value = j.display_name || `${lastLat}, ${lastLon}`;
    } catch (e) {
      locInput.value = `${lastLat}, ${lastLon}`;
    }
    updateDistanceBanner();
  }, () => { locInput.value = "Gagal mengambil lokasi"; });
}

/* ----------------- Submit handler ----------------- */
document.addEventListener("submit", async (e) => {
  if (!e.target) return;
  if (e.target.id === "attendance-form") {
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    const sel = document.getElementById("nama-guru-kehadiran");
    const name = sel?.value || "";
    if (!name) { alert("Silakan pilih nama guru."); submitting = false; return; }

    if (hasSubmittedTodayLocal(name)) { alert("⚠️ Guru ini sudah absen hari ini (lokal)."); submitting = false; return; }
    // refresh attendance from server to be safe
    await loadAttendance();
    if (hasSubmittedTodayServerSide(name)) { alert("⚠️ Guru ini sudah absen hari ini."); updateDuplicateAndBanners(); submitting = false; return; }

    const now = new Date();
    const terlambat = minutesLate(now);
    const baseLok = document.getElementById("keterangan-lokasi")?.value || "";
    const dist = distanceMeters(lastLat, lastLon, SCHOOL_LAT, SCHOOL_LON);
    const jarakInfo = (dist == null ? "" : ` | Jarak≈${dist}m`);
    const ketLate = (terlambat > 0 ? ` | Terlambat ${terlambat} menit` : "");

    const payload = {
      nama_guru: name,
      status: document.getElementById("status-kehadiran")?.value || "Hadir",
      jam_hadir: now.toLocaleTimeString("id-ID"),
      tanggal: todayISO(),
      keterangan_lokasi: baseLok + ketLate + jarakInfo
      // NOTE: foto not sent to Sheet (you asked preview-only)
    };

    // show overlay
    const overlay = document.createElement("div");
    overlay.id = "loading-msg";
    overlay.style.position = "fixed";
    overlay.style.inset = 0;
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.zIndex = 9999;
    overlay.innerHTML = `<div style="background:#fff;padding:16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.12)"><strong style="color:#1e3a8a">⏳ Menyimpan...</strong></div>`;
    document.body.appendChild(overlay);

    try {
      await saveAttendance(payload);
      markSubmittedLocal(name);
      // optimistic local push so UI updates immediately
      attendanceRecords.push({ nama_guru: payload.nama_guru, status: payload.status, jam: payload.jam_hadir, tanggal: payload.tanggal, lokasi: payload.keterangan_lokasi });
      setTimeout(async () => {
        await loadAttendance();
        document.getElementById("loading-msg")?.remove();
      }, 700);
      // clear photo preview if any
      const photoInput = document.getElementById("foto-kehadiran");
      if (photoInput) { photoInput.value = ""; const preview = document.getElementById("preview-foto"); if (preview) preview.src = ""; document.getElementById("foto-preview-wrap")?.classList.add("hidden"); }
      e.target.reset();
    } catch (err) {
      console.error("submit error", err);
      alert("Gagal menyimpan. Silakan coba lagi.");
      document.getElementById("loading-msg")?.remove();
    } finally {
      submitting = false;
      updateDuplicateAndBanners();
    }
  }
});

/* ----------------- Photo preview (local only) ----------------- */
(function initPhotoPreview() {
  const input = document.getElementById("foto-kehadiran");
  const wrap = document.getElementById("foto-preview-wrap");
  const img = document.getElementById("preview-foto");
  const btn = document.getElementById("hapus-foto");
  if (!input || !img) return;
  input.addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (!f) { wrap.classList.add("hidden"); img.src = ""; return; }
    const reader = new FileReader();
    reader.onload = ev => { img.src = ev.target.result; wrap.classList.remove("hidden"); };
    reader.readAsDataURL(f);
  });
  btn?.addEventListener("click", () => { input.value = ""; img.src = ""; wrap.classList.add("hidden"); });
})();

/* ----------------- Init: load data, clock, location, set intervals ----------------- */
window.addEventListener("load", async () => {
  // UI date
  const cd = document.getElementById("current-date");
  if (cd) cd.textContent = new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // draw clock
  drawAnalogClock();

  // try to get location (non-blocking)
  try { getLocation(); } catch(e) { console.warn("gps init failed", e); }

  // load teachers & attendance (no-cache)
  await loadTeachers();
  await loadAttendance();

  // attach change hook
  document.getElementById("nama-guru-kehadiran")?.addEventListener("change", () => updateDuplicateAndBanners());

  // periodic refresh (light)
  setInterval(() => updateLateBanner(), 60_000);
  setInterval(async () => { await loadAttendance(); }, 60_000);
});

/* ----------------- Fallback clickable list helper (if select not available) ----------------- */
(function fallbackIfNoSelect() {
  // after a short delay, if select still empty, create small clickable list
  setTimeout(() => {
    const sel = document.getElementById("nama-guru-kehadiran");
    if (!sel || (sel.options && sel.options.length > 1)) return;
    const parent = document.getElementById("attendance-form") || document.body;
    const wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(auto-fill,minmax(140px,1fr))";
    wrap.style.gap = "6px";
    teachers.forEach(t => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.nama_guru;
      b.style.padding = "8px";
      b.style.borderRadius = "8px";
      b.style.border = "1px solid #eee";
      b.style.background = "#fff";
      b.addEventListener("click", () => {
        let sel2 = document.getElementById("nama-guru-kehadiran");
        if (!sel2) {
          sel2 = document.createElement("select");
          sel2.id = "nama-guru-kehadiran";
          sel2.className = "w-full p-2 border rounded mt-2";
          parent.insertBefore(sel2, parent.firstChild);
          const ph = document.createElement("option"); ph.value=""; ph.textContent="-- Pilih Guru --"; sel2.appendChild(ph);
        }
        if (!Array.from(sel2.options).some(o => o.value === t.nama_guru)) {
          const opt = document.createElement("option"); opt.value = t.nama_guru; opt.textContent = t.nama_guru; sel2.appendChild(opt);
        }
        sel2.value = t.nama_guru;
        sel2.dispatchEvent(new Event("change", { bubbles: true }));
      });
      wrap.appendChild(b);
    });
    parent.appendChild(wrap);
  }, 600);
})();

/* ----------------- Optional debug block (commented) ----------------- */
/*
(function addDebugBox(){
  const box = document.createElement('div');
  box.style.position='fixed'; box.style.right='12px'; box.style.bottom='12px';
  box.style.background='rgba(0,0,0,.7)'; box.style.color='#fff'; box.style.padding='8px 10px'; box.style.borderRadius='8px'; box.style.zIndex=99999;
  box.id='debug-box'; box.textContent='debug...'; document.body.appendChild(box);
  (async ()=>{ try { const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + '?sheet=guru'); if(Array.isArray(raw)) box.textContent = 'guru rows=' + raw.length; else if(raw && Array.isArray(raw.values)) box.textContent='guru values=' + raw.values.length; else box.textContent='guru ok'; } catch(e){ box.textContent='err'; } })();
})();
*/