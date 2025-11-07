// app.js — anti-absen ganda final (no-cache + guards)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

let teachers = [];
let attendanceRecords = [];
let dailyChart = null;
let lastCounts = null;
let _submitMutex = false; // kunci klik ganda

/* ===================== UTIL ===================== */
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "string" && value.includes("T")) {
    const d = new Date(value);
    d.setHours(d.getHours() + 7); // WIB
    return d.toISOString().split("T")[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!isNaN(d)) return d.toISOString().split("T")[0];
  return String(value).trim();
}
function normalizeName(name=""){
  return (name||"").toLowerCase().replace(/\s+/g," ").trim();
}
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function todayISO(){ return new Date().toISOString().split("T")[0]; }
function isTabActive(tab){ const el=document.getElementById(`content-${tab}`); return el ? !el.classList.contains('hidden') : true; }

// Fetch JSON dengan anti-cache kuat
async function fetchJsonNoCache(url){
  const sep = url.includes("?") ? "&" : "?";
  const full = `${url}${sep}_ts=${Date.now()}`;
  const res = await fetch(full, {
    method: "GET",
    cache: "no-store",
    headers: { "cache-control":"no-cache", "pragma":"no-cache" }
  });
  return res.json();
}

/* ===== Avatar Inisial ===== */
const AVATAR_COLORS = ["#1D4ED8","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#22C55E","#E11D48"];
function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return Math.abs(h); }
function nameToInitials(name=""){ const p=name.trim().split(/\s+/); return ((p[0]?.[0]||"")+(p[1]?.[0]||"")).toUpperCase()||"?"; }
function colorForName(name=""){ return AVATAR_COLORS[ hashCode(name)%AVATAR_COLORS.length ]; }
function renderNameWithAvatar(name=""){
  const safe = escapeHtml(name), init = nameToInitials(name), color = colorForName(name);
  return `<span class="name-cell"><span class="avatar" style="background-color:${color}">${init}</span><span>${safe}</span></span>`;
}

/* ===================== CLOCK ===================== */
function drawAnalogClock() {
  const canvas = document.getElementById("analogClock");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const radius = canvas.height / 2;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate(radius, radius);

  function face(){ ctx.beginPath(); ctx.arc(0,0,radius*0.95,0,2*Math.PI); ctx.fillStyle="white"; ctx.fill(); ctx.strokeStyle="#1e3a8a"; ctx.lineWidth=radius*0.05; ctx.stroke(); ctx.beginPath(); ctx.arc(0,0,radius*0.05,0,2*Math.PI); ctx.fillStyle="#1e3a8a"; ctx.fill(); }
  function numbers(){ ctx.font=radius*0.15+"px Arial"; ctx.textBaseline="middle"; ctx.textAlign="center"; for(let n=1;n<=12;n++){ const ang=(n*Math.PI)/6; ctx.rotate(ang); ctx.translate(0,-radius*0.85); ctx.rotate(-ang); ctx.fillText(n.toString(),0,0); ctx.rotate(ang); ctx.translate(0,radius*0.85); ctx.rotate(-ang); } }
  function hand(pos,len,w,col){ ctx.beginPath(); ctx.lineWidth=w; ctx.lineCap="round"; ctx.strokeStyle=col; ctx.moveTo(0,0); ctx.rotate(pos); ctx.lineTo(0,-len); ctx.stroke(); ctx.rotate(-pos); }
  function time(){ const now=new Date(); const h=now.getHours()%12, m=now.getMinutes(), s=now.getSeconds();
    hand(((h*Math.PI)/6)+((m*Math.PI)/(6*60))+((s*Math.PI)/(360*60)), radius*0.5, radius*0.07, "#1e3a8a");
    hand(((m*Math.PI)/30)+((s*Math.PI)/(30*60)), radius*0.8, radius*0.05, "#2563eb");
    hand((s*Math.PI)/30, radius*0.9, radius*0.02, "#ef4444");
  }
  function draw(){ ctx.clearRect(-radius,-radius,canvas.width,canvas.height); face(); numbers(); time(); }
  draw();
  if (window._analogClockInterval) clearInterval(window._analogClockInterval);
  window._analogClockInterval = setInterval(draw, 1000);
}

/* ===================== LOAD / SAVE ===================== */
async function loadTeachers() {
  try {
    const data = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + "?sheet=guru");
    teachers = data.slice(1).map(r => ({ nama_guru: r[0], nip: r[1], jabatan: r[2], status: r[3] }));
    if (document.getElementById('guru-list')) updateTeacherList();
    if (document.getElementById('nama-guru-kehadiran')) updateTeacherDropdown();
    document.dispatchEvent(new Event('teachers-updated'));
  } catch (e) { console.error("loadTeachers:", e); }
}

async function loadAttendance() {
  try {
    const data = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + "?sheet=kehadiran");
    attendanceRecords = data.slice(1).map(r => ({
      nama_guru: r[0],
      status: r[1],
      jam: r[2],
      tanggal: normalizeDate(r[3]),
      lokasi: r[4],
      foto_url: r[5] || ""
    }));
    if (document.getElementById('attendance-list')) updateAttendanceToday();
    if (isTabActive('kehadiran')) updateChartDebounced();
    document.dispatchEvent(new Event('attendance-updated'));
  } catch (e) { console.error("loadAttendance:", e); }
}

async function saveAttendance(d) {
  try {
    await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ type: 'attendance', data: d }) });
  } catch (e) { console.error("saveAttendance:", e); }
}

/* ===================== UI ===================== */
function updateTeacherList() {
  const tbody = document.getElementById('guru-list');
  if (!tbody) return;
  if (!teachers.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">Belum ada data</td></tr>`;
    return;
  }
  tbody.innerHTML = teachers.map((t, i) => `
    <tr>
      <td class="border p-2">${renderNameWithAvatar(t.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(t.nip || "")}</td>
      <td class="border p-2">${escapeHtml(t.jabatan || "")}</td>
      <td class="border p-2">${escapeHtml(t.status || "")}</td>
      <td class="border p-2"><button onclick="editGuru(${i})" class="text-blue-700">Edit</button></td>
    </tr>`).join('');
}

function updateTeacherDropdown() {
  const select = document.getElementById('nama-guru-kehadiran');
  if (!select) return;
  select.innerHTML = '<option value="">-- Pilih Guru --</option>';
  teachers.forEach(t => {
    const opt = document.createElement('option');
    opt.textContent = t.nama_guru;
    opt.value = t.nama_guru;
    select.appendChild(opt);
  });
  attachAlreadyCheckedWarning(select);
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date(), d = new Date(dateStr);
  return d.getDate()===today.getDate() && d.getMonth()===today.getMonth() && d.getFullYear()===today.getFullYear();
}

function updateAttendanceToday() {
  const tbody = document.getElementById("attendance-list");
  if (!tbody) return;
  const todayData = attendanceRecords.filter(r => isToday(r.tanggal));
  if (!todayData.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">Belum ada kehadiran hari ini</td></tr>`;
    updateDuplicateNotice();
    return;
  }
  tbody.innerHTML = todayData.map(r => `
    <tr>
      <td class="border p-2">${renderNameWithAvatar(r.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(r.status)}</td>
      <td class="border p-2">${escapeHtml(r.jam)}</td>
      <td class="border p-2">${escapeHtml(r.lokasi || "")}</td>
      <td class="border p-2">${escapeHtml(r.tanggal)}</td>
    </tr>
  `).join('');
  updateDuplicateNotice();
}

/* ===================== ANTI-DUPLIKASI ===================== */
function hasSubmittedTodayServerSide(name){
  if (!name) return false;
  const who = normalizeName(name), t = todayISO();
  return attendanceRecords.some(r => normalizeDate(r.tanggal) === t && normalizeName(r.nama_guru) === who);
}
function hasSubmittedTodayLocal(name){
  if (!name) return false;
  return localStorage.getItem(`absen:${todayISO()}:${normalizeName(name)}`) === '1';
}
function markSubmittedLocal(name){
  if (!name) return;
  localStorage.setItem(`absen:${todayISO()}:${normalizeName(name)}`, '1');
}
function attachAlreadyCheckedWarning(selectEl){
  if (!selectEl) return;
  let warn = document.getElementById('warn-sudah-absen');
  if (!warn){
    warn = document.createElement('div');
    warn.id = 'warn-sudah-absen';
    warn.className = 'text-sm mt-1';
    selectEl.parentElement.appendChild(warn);
  }
  const btn = document.querySelector('#attendance-form button[type="submit"]');
  const update = () => {
    const nama = selectEl.value;
    const already = hasSubmittedTodayLocal(nama) || hasSubmittedTodayServerSide(nama);
    if (nama && already) {
      warn.innerHTML = '⚠️ <span class="text-yellow-700">Guru ini sudah mengisi kehadiran hari ini.</span>';
      if (btn) { btn.disabled = true; btn.classList.add('opacity-60','cursor-not-allowed'); }
    } else {
      warn.textContent = '';
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','cursor-not-allowed'); }
    }
  };
  selectEl.addEventListener('change', update);
  update();
}
function updateDuplicateNotice(){
  const selectEl = document.getElementById('nama-guru-kehadiran');
  if (selectEl) attachAlreadyCheckedWarning(selectEl);
}

/* ===================== CHART (doughnut ringan) ===================== */
function getTodayCounts(){
  const tISO = todayISO();
  const todayData = attendanceRecords.filter(r => normalizeDate(r.tanggal) === tISO);
  const counts = { Hadir:0, Izin:0, Sakit:0, "Dinas Luar":0 };
  todayData.forEach(r => { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });
  const h = document.getElementById('stat-hadir');
  if (h) {
    document.getElementById('stat-hadir').textContent = counts.Hadir;
    document.getElementById('stat-izin').textContent = counts.Izin;
    document.getElementById('stat-sakit').textContent = counts.Sakit;
    document.getElementById('stat-dl').textContent = counts["Dinas Luar"];
  }
  return counts;
}
function sameCounts(a,b){ return !!a && !!b && a.Hadir===b.Hadir && a.Izin===b.Izin && a.Sakit===b.Sakit && a["Dinas Luar"]===b["Dinas Luar"]; }

function ensureChart(){
  const canvas = document.getElementById("dailyChart");
  if (!canvas) return null;
  if (dailyChart) return dailyChart;
  const ctx = canvas.getContext("2d");
  dailyChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels: ["Hadir","Izin","Sakit","Dinas Luar"], datasets: [{ data: [0,0,0,0], borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, devicePixelRatio: 1, cutout: "62%",
      animation: false, events: [],
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } }, tooltip: { enabled: true } }
    }
  });
  return dailyChart;
}
const updateChartDebounced = debounce(updateChart, 120);
function updateChart() {
  const chart = ensureChart(); if (!chart) return;
  const counts = getTodayCounts();
  if (sameCounts(counts, lastCounts)) return;
  chart.data.datasets[0].data = [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]];
  lastCounts = counts;
  chart.update('none');
}

/* ===================== REPORT, CSV, GPS ===================== */
function generateMonthlyReport() { /* tidak diubah dari versi sebelumnya */ }
function downloadMonthlyReport() { /* tidak diubah dari versi sebelumnya */ }
function getLocation() {
  const locInput = document.getElementById('keterangan-lokasi');
  if (!locInput) return;
  if (!navigator.geolocation) { locInput.value = "Browser tidak mendukung GPS"; return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
      const data = await res.json();
      locInput.value = data.display_name || `${lat}, ${lon}`;
    } catch (e) { locInput.value = `${lat}, ${lon}`; }
  }, () => { locInput.value = "Gagal mengambil lokasi"; });
}

/* ===================== EVENTS ===================== */
document.addEventListener('submit', async (e) => {
  if (!e.target) return;

  if (e.target.id === 'attendance-form') {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const namaGuru = document.getElementById('nama-guru-kehadiran').value;

    // mutex klik ganda
    if (_submitMutex) return;
    _submitMutex = true;

    // Lapis 1: cek lokal
    if (hasSubmittedTodayLocal(namaGuru)) {
      alert('⚠️ Guru ini sudah absen hari ini (lokal).');
      _submitMutex = false; return;
    }

    // Lapis 2: muat data terbaru (no-cache) lalu cek
    await loadAttendance();
    if (hasSubmittedTodayServerSide(namaGuru)) {
      alert('⚠️ Guru ini sudah absen hari ini.');
      updateDuplicateNotice();
      _submitMutex = false; return;
    }

    const now = new Date();
    const data = {
      nama_guru: namaGuru,
      status: document.getElementById('status-kehadiran').value,
      jam_hadir: now.toLocaleTimeString('id-ID'),
      tanggal: todayISO(),
      keterangan_lokasi: document.getElementById('keterangan-lokasi').value || ''
    };

    // overlay + lock tombol
    const loading = document.createElement('div');
    loading.id = 'loading-msg';
    loading.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50';
    loading.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-lg text-center"><p class="text-blue-700 font-semibold">⏳ Menyimpan...</p></div>`;
    document.body.appendChild(loading);
    if (btn){ btn.disabled = true; btn.classList.add('opacity-60','cursor-not-allowed'); }

    await saveAttendance(data);

    // Lapis 3: tandai lokal + tambahkan ke memori agar langsung terblok
    markSubmittedLocal(namaGuru);
    attendanceRecords.push({
      nama_guru: data.nama_guru,
      status: data.status,
      jam: data.jam_hadir,
      tanggal: data.tanggal,
      lokasi: data.keterangan_lokasi
    });

    setTimeout(async () => {
      await loadAttendance(); // sinkron server (no-cache)
      document.getElementById('loading-msg')?.remove();
      if (btn){ btn.disabled = false; btn.classList.remove('opacity-60','cursor-not-allowed'); }
      updateDuplicateNotice();
      _submitMutex = false;
    }, 600);

    e.target.reset();
  }

  if (e.target.id === 'guru-form') {
    e.preventDefault();
    const d = {
      nama_guru: document.getElementById('nama-guru').value,
      nip: document.getElementById('nip-guru').value,
      jabatan: document.getElementById('jabatan-guru').value,
      status: document.getElementById('status-kepegawaian').value
    };
    await saveTeacher(d);
    setTimeout(async () => { await loadTeachers(); }, 400);
  }
});

// editGuru global (untuk dashboard)
window.editGuru = function(i) {
  const g = teachers[i];
  document.getElementById('nama-guru').value = g.nama_guru;
  document.getElementById('nip-guru').value = g.nip;
  document.getElementById('jabatan-guru').value = g.jabatan;
  document.getElementById('status-kepegawaian').value = g.status;
  if (typeof switchTab === 'function') switchTab('guru');
};

/* ===================== DASHBOARD (ringkas) ===================== */
async function loadDashboard() {
  await loadTeachers();
  await loadAttendance();
  const totalGuru = document.getElementById('totalGuru');
  const hadirHariIni = document.getElementById('hadirHariIni');
  const tidakHadir = document.getElementById('tidakHadirHariIni');
  const tabelGuru = document.getElementById('tabelGuru');
  if (totalGuru) totalGuru.textContent = teachers.length;

  const tISO = todayISO();
  const hariIni = attendanceRecords.filter(r => r.tanggal && normalizeDate(r.tanggal) === tISO);
  const hadir = hariIni.filter(r => r.status === 'Hadir').length;
  const notHadir = hariIni.length - hadir;
  if (hadirHariIni) hadirHariIni.textContent = hadir;
  if (tidakHadir) tidakHadir.textContent = notHadir;

  if (tabelGuru) {
    tabelGuru.innerHTML = teachers.map(t => `<tr>
      <td class="border p-2">${renderNameWithAvatar(t.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(t.nip || "")}</td>
      <td class="border p-2">${escapeHtml(t.jabatan || "")}</td>
      <td class="border p-2">${escapeHtml(t.status || "")}</td>
    </tr>`).join('');
  }

  const ctx = document.getElementById('chartKehadiran');
  if (ctx) {
    if (window._dashChart && typeof window._dashChart.destroy === 'function') window._dashChart.destroy();
    const counts = { Hadir:0, Izin:0, Sakit:0, "Dinas Luar":0 };
    hariIni.forEach(r => { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });
    window._dashChart = new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ["Hadir","Izin","Sakit","Dinas Luar"], datasets: [{ data: [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]], borderWidth: 0 }] },
      options: { responsive: true, devicePixelRatio: 1, cutout: "62%", animation: false, events: [], plugins: { legend: { position: 'bottom' } } }
    });
  }
}

/* ===================== TAB SWITCH (opsional) ===================== */
window.switchTab = function(tab) {
  document.querySelectorAll('section[id^="content-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('tab-active'));
  const content = document.getElementById(`content-${tab}`);
  const btn = document.getElementById(`tab-${tab}`);
  if (content) content.classList.remove('hidden');
  if (btn) btn.classList.add('tab-active');
  if (tab === 'kehadiran') updateChartDebounced();
};

/* ===================== INIT ===================== */
window.addEventListener('load', async () => {
  const cd = document.getElementById('current-date');
  if (cd) cd.textContent = new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  drawAnalogClock();
  try { getLocation(); } catch(e){}
  await loadTeachers();
  await loadAttendance();
  setInterval(async () => { await loadAttendance(); }, 60000);
});