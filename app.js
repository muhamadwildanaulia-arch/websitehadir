// app.js - WebsiteHadir versi perbaikan desktop chart & timezone
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

let teachers = [];
let attendanceRecords = [];

// ========== HELPERS ==========
function normalizeDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) return String(value).trim();
  try {
    const d = new Date(value);
    if (!isNaN(d)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch (e) { }
  return String(value).trim();
}

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ========== DRAW ANALOG CLOCK ==========
function drawAnalogClock() {
  const canvas = document.getElementById("analogClock");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const radius = canvas.height / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(radius, radius);

  function drawFace() {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.95, 0, 2 * Math.PI);
    ctx.fillStyle = "white"; ctx.fill();
    ctx.strokeStyle = "#1e3a8a"; ctx.lineWidth = radius * 0.05; ctx.stroke();
  }
  function drawNumbers() {
    ctx.font = radius * 0.15 + "px Arial";
    ctx.textBaseline = "middle"; ctx.textAlign = "center";
    for (let num = 1; num <= 12; num++) {
      const ang = (num * Math.PI) / 6;
      ctx.rotate(ang);
      ctx.translate(0, -radius * 0.85);
      ctx.rotate(-ang);
      ctx.fillText(num.toString(), 0, 0);
      ctx.rotate(ang);
      ctx.translate(0, radius * 0.85);
      ctx.rotate(-ang);
    }
  }
  function drawHand(pos, length, width, color) {
    ctx.beginPath(); ctx.lineWidth = width; ctx.lineCap = "round"; ctx.strokeStyle = color;
    ctx.moveTo(0, 0); ctx.rotate(pos); ctx.lineTo(0, -length); ctx.stroke(); ctx.rotate(-pos);
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

// ========== LOAD / SAVE ==========
async function loadTeachers() {
  try {
    const res = await fetch(GOOGLE_SCRIPT_URL + "?sheet=guru&_ts=" + Date.now());
    const data = await res.json();
    teachers = data.slice(1).map(r => ({ nama_guru: r[0], nip: r[1], jabatan: r[2], status: r[3] }));
    updateTeacherDropdown();
    updateTeacherList();
  } catch (e) {
    console.error("loadTeachers:", e);
    teachers = [];
    updateTeacherDropdown();
    updateTeacherList();
  }
}

async function loadAttendance() {
  try {
    const res = await fetch(GOOGLE_SCRIPT_URL + "?sheet=kehadiran&_ts=" + Date.now());
    const data = await res.json();
    attendanceRecords = data.slice(1).map(r => ({
      nama_guru: r[0],
      status: r[1],
      jam: r[2],
      tanggal: normalizeDate(r[3]),
      lokasi: r[4]
    }));
    updateAttendanceToday();
    updateChart();
  } catch (e) {
    console.error("loadAttendance:", e);
    attendanceRecords = [];
    updateAttendanceToday();
    updateChart();
  }
}

async function saveAttendance(d) {
  try {
    await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ type: 'attendance', data: d }) });
  } catch (e) { console.error("saveAttendance:", e); throw e; }
}

async function saveTeacher(d) {
  try {
    await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ type: 'teacher', data: d }) });
  } catch (e) { console.error("saveTeacher:", e); }
}

// ========== UI UPDATES ==========
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
}

function updateTeacherList() {
  const tbody = document.getElementById('guru-list');
  if (!tbody) return;
  if (!teachers.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">Belum ada data</td></tr>`;
    return;
  }
  tbody.innerHTML = teachers.map((t, i) => `
    <tr>
      <td class="border p-2">${t.nama_guru}</td>
      <td class="border p-2">${t.nip}</td>
      <td class="border p-2">${t.jabatan}</td>
      <td class="border p-2">${t.status}</td>
      <td class="border p-2"><button onclick="editGuru(${i})" class="text-blue-700">Edit</button></td>
    </tr>`).join('');
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date(), d = new Date(dateStr);
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

function updateAttendanceToday() {
  const tbody = document.getElementById("attendance-list");
  if (!tbody) return;
  const todayData = attendanceRecords.filter(r => isToday(r.tanggal));
  if (!todayData.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4">Belum ada kehadiran hari ini</td></tr>`;
    return;
  }
  tbody.innerHTML = todayData.map(r => `
    <tr>
      <td class="border p-2">${escapeHtml(r.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(r.status)}</td>
      <td class="border p-2">${escapeHtml(r.jam)}</td>
      <td class="border p-2">${escapeHtml(r.lokasi || '')}</td>
      <td class="border p-2">${escapeHtml(r.tanggal)}</td>
    </tr>
  `).join('');
}

// ========== LIGHTWEIGHT DONUT CHART (perbaikan untuk PC) ==========
function updateChart() {
  const canvas = document.getElementById("dailyChart");
  if (canvas) canvas.style.display = "none";

  let wrap = document.getElementById('dailyDonutFallback');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'dailyDonutFallback';
    wrap.style.width = '100%';
    wrap.style.maxWidth = '420px';
    wrap.style.margin = '0 auto';
    wrap.style.minHeight = '220px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    if (canvas && canvas.parentNode) {
      canvas.parentNode.insertBefore(wrap, canvas.nextSibling);
    } else {
      document.body.appendChild(wrap);
    }
  }

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayData = attendanceRecords.filter(r => normalizeDate(r.tanggal) === today);
  const counts = { Hadir: 0, Izin: 0, Sakit: 0, "Dinas Luar": 0 };
  todayData.forEach(r => { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });

  const total = counts.Hadir + counts.Izin + counts.Sakit + counts["Dinas Luar"];
  const colors = ['#4CAF50', '#FFC107', '#F44336', '#2196F3'];
  const vals = [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]];
  let gradient;
  if (total > 0) {
    let start = 0;
    const stops = vals.map((v, i) => {
      const pct = (v / total) * 100;
      const from = start;
      const to = start + pct;
      start = to;
      return `${colors[i]} ${from}% ${to}%`;
    }).join(', ');
    gradient = `conic-gradient(${stops})`;
  } else {
    gradient = `conic-gradient(#E5E7EB 0% 100%)`;
  }

  console.debug('[updateChart] today=', today, 'counts=', counts, 'total=', total);

  wrap.innerHTML = `
    <div style="width:180px;height:180px;border-radius:50%;background:${gradient};
      display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,0.05);">
      <div style="width:100px;height:100px;background:white;border-radius:50%;
        display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="font-weight:700;color:#1e3a8a">${total}</div>
        <div style="font-size:12px;color:#6b7280">Total</div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;font-size:13px;">
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:${colors[0]};display:inline-block;border-radius:2px"></span> Hadir: <b>${counts.Hadir}</b></span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:${colors[1]};display:inline-block;border-radius:2px"></span> Izin: <b>${counts.Izin}</b></span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:${colors[2]};display:inline-block;border-radius:2px"></span> Sakit: <b>${counts.Sakit}</b></span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background:${colors[3]};display:inline-block;border-radius:2px"></span> Dinas Luar: <b>${counts["Dinas Luar"]}</b></span>
    </div>
  `;
}

// ========== LAPORAN, CSV, GPS, EVENT ==========
function generateMonthlyReport() { /* ... tidak diubah ... */ }
function downloadMonthlyReport() { /* ... tidak diubah ... */ }
function getLocation() { /* ... tidak diubah ... */ }

// ========== EVENT LISTENERS ==========
document.addEventListener('submit', async (e) => {
  /* ... sama seperti versi kamu ... */
});

window.editGuru = function (i) {
  const g = teachers[i];
  if (!g) return;
  document.getElementById('nama-guru').value = g.nama_guru;
  document.getElementById('nip-guru').value = g.nip;
  document.getElementById('jabatan-guru').value = g.jabatan;
  document.getElementById('status-kepegawaian').value = g.status;
  if (typeof switchTab === 'function') switchTab('guru');
};

// ========== TAB SWITCH ==========
function switchTab(tab) {
  document.querySelectorAll('section[id^="content-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('tab-active'));
  const content = document.getElementById(`content-${tab}`);
  const btn = document.getElementById(`tab-${tab}`);
  if (content) content.classList.remove('hidden');
  if (btn) btn.classList.add('tab-active');
}

// ========== INIT ==========
window.addEventListener('load', async () => {
  const cd = document.getElementById('current-date');
  if (cd) cd.textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  drawAnalogClock();
  try { getLocation(); } catch (e) { }
  await loadTeachers();
  await loadAttendance();
  setInterval(async () => { await loadAttendance(); }, 30000);
});

// rerender donut saat resize
window.addEventListener('resize', () => {
  try { updateChart(); } catch (e) { }
});
