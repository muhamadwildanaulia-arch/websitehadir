// app.js - ringan, fallback-only donut chart (CSS conic-gradient)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

let teachers = [];
let attendanceRecords = [];

// ========== HELPERS ==========
function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "string" && value.includes("T")) {
    const d = new Date(value);
    d.setHours(d.getHours() + 7); // WIB adjust if needed
    return d.toISOString().split("T")[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // try parse common formats
  try {
    const s = String(value).replace(',', ' ').replace(/\.(?=\d{2}\b)/g, ':').trim();
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().split("T")[0];
  } catch (e) {}
  const d = new Date(value);
  if (!isNaN(d)) return d.toISOString().split("T")[0];
  return String(value).trim();
}

function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

// ========== DRAW ANALOG CLOCK ==========
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

// ========== LOAD / SAVE ==========
async function loadTeachers() {
  try {
    const res = await fetch(GOOGLE_SCRIPT_URL + "?sheet=guru&_ts=" + Date.now());
    const data = await res.json();
    teachers = data.slice(1).map(r => ({ nama_guru: r[0], nip: r[1], jabatan: r[2], status: r[3] }));
    updateTeacherDropdown();
    updateTeacherList();
  } catch (e) { console.error("loadTeachers:", e); teachers = []; updateTeacherDropdown(); updateTeacherList(); }
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
  } catch (e) { console.error("loadAttendance:", e); attendanceRecords = []; updateAttendanceToday(); updateChart(); }
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
    const opt = document.createElement('option'); opt.textContent = t.nama_guru; opt.value = t.nama_guru; select.appendChild(opt);
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

// ========== LIGHTWEIGHT DONUT CHART (fallback-only) ==========
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
    wrap.style.height = '240px';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    if (canvas && canvas.parentNode) canvas.parentNode.appendChild(wrap);
    else document.body.appendChild(wrap);
  }

  const today = new Date().toISOString().split("T")[0];
  const todayData = attendanceRecords.filter(r => normalizeDate(r.tanggal) === today);
  const counts = { Hadir: 0, Izin: 0, Sakit: 0, "Dinas Luar": 0 };
  todayData.forEach(r => { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });

  const total = counts.Hadir + counts.Izin + counts.Sakit + counts["Dinas Luar"];
  const colors = ['#4CAF50','#FFC107','#F44336','#2196F3'];
  const vals = [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]];
  let start = 0;
  const stops = vals.map((v,i)=>{
    const pct = total>0?(v/total)*100:0;
    const from = start; const to = start + pct; start = to;
    return `${colors[i]} ${from}% ${to}%`;
  }).join(', ');
  const gradient = total>0?`conic-gradient(${stops})`:`conic-gradient(#E5E7EB 0% 100%)`;

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

// ========== GENERATE MONTHLY REPORT ==========
function generateMonthlyReport() {
  const bulanInput = document.getElementById('bulan-laporan');
  if (!bulanInput) return;
  const val = bulanInput.value;
  if (!val) return;
  const [tahun, bulan] = val.split('-');
  const hariDalamBulan = new Date(tahun, bulan, 0).getDate();
  const guruList = teachers.map(t => t.nama_guru);
  const dataBulan = attendanceRecords.filter(r => r.tanggal && r.tanggal.startsWith(`${tahun}-${bulan}`));

  let html = `<thead class='bg-gray-100'><tr><th class='border p-1'>Nama Guru</th>`;
  for (let i = 1; i <= hariDalamBulan; i++) html += `<th class='border p-1'>${i}</th>`;
  html += `</tr></thead><tbody>`;

  let total = { Hadir:0, Izin:0, Sakit:0, "Dinas Luar":0 };

  guruList.forEach(nama => {
    html += `<tr><td class='border p-1 font-semibold'>${nama}</td>`;
    for (let i=1;i<=hariDalamBulan;i++) {
      const tanggal = `${tahun}-${bulan}-${String(i).padStart(2,'0')}`;
      const abs = dataBulan.find(r => r.nama_guru===nama && r.tanggal===tanggal);
      const s = abs ? abs.status[0] : '';
      if (abs && total.hasOwnProperty(abs.status)) total[abs.status]++;
      let warna = "";
      if (s === "H") warna = "bg-green-100 text-green-700 font-bold";
      else if (s === "I") warna = "bg-yellow-100 text-yellow-700 font-bold";
      else if (s === "S") warna = "bg-red-100 text-red-700 font-bold";
      else if (s === "D") warna = "bg-blue-100 text-blue-700 font-bold";
      html += `<td class='border text-center text-xs p-1 ${warna}'>${s}</td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody>`;
  const tabel = document.getElementById('tabel-laporan');
  if (tabel) tabel.innerHTML = html;

  const sum = total.Hadir + total.Izin + total.Sakit + total["Dinas Luar"];
  const resume = document.getElementById('resume-laporan');
  if (resume) resume.innerHTML = `
    <h4 class='font-semibold text-blue-900 mb-2'>Resume Kehadiran Bulan ${bulan}-${tahun}</h4>
    <p>Hadir: <b>${total.Hadir}</b> | Izin: <b>${total.Izin}</b> | Sakit: <b>${total.Sakit}</b> | Dinas Luar: <b>${total["Dinas Luar"]}</b></p>
    <p>Total Kehadiran: <b>${sum}</b> dari ${guruList.length * hariDalamBulan} data</p>
    <div class="mt-3 text-sm space-x-2">
      <span class="bg-green-100 text-green-700 px-2 py-1 rounded">H = Hadir</span>
      <span class="bg-yellow-100 text-yellow-700 px-2 py-1 rounded">I = Izin</span>
      <span class="bg-red-100 text-red-700 px-2 py-1 rounded">S = Sakit</span>
      <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">D = Dinas Luar</span>
    </div>
  `;
}

// ========== DOWNLOAD CSV ==========
function downloadMonthlyReport() {
  const table = document.getElementById("tabel-laporan");
  if (!table || !table.rows.length) {
    alert("⚠️ Laporan belum tersedia. Silakan pilih bulan terlebih dahulu!");
    return;
  }
  const bulan = document.getElementById("bulan-laporan").value || "laporan";
  let csv = "";
  const rows = table.querySelectorAll("tr");
  rows.forEach(row => {
    const cols = row.querySelectorAll("th, td");
    const rowData = Array.from(cols).map(td => `"${td.innerText.replace(/"/g,'""')}"`);
    csv += rowData.join(",") + "\n";
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Laporan_Kehadiran_${bulan}.csv`;
  link.click();
}

// ========== GPS (display only) ==========
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

// ========== EVENT LISTENERS ==========
document.addEventListener('submit', async (e) => {
  if (!e.target) return;
  if (e.target.id === 'attendance-form') {
    e.preventDefault();
    const now = new Date();
    const data = {
      nama_guru: document.getElementById('nama-guru-kehadiran').value,
      status: document.getElementById('status-kehadiran').value,
      jam_hadir: now.toLocaleTimeString('id-ID'),
      tanggal: now.toISOString().split('T')[0],
      keterangan_lokasi: document.getElementById('keterangan-lokasi').value || ''
    };

    // overlay
    const loading = document.createElement('div');
    loading.id = 'loading-msg';
    loading.className = 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50';
    loading.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-lg text-center"><p class="text-blue-700 font-semibold">⏳ Menyimpan...</p></div>`;
    document.body.appendChild(loading);

    try {
      await saveAttendance(data);
      // small delay for sheet write-through
      setTimeout(async () => {
        await loadAttendance();
        document.getElementById('loading-msg')?.remove();
        alert('✅ Kehadiran tersimpan.');
      }, 1500);
    } catch (err) {
      console.error(err);
      document.getElementById('loading-msg')?.remove();
      alert('Gagal menyimpan. Silakan coba lagi.');
    }

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
    try {
      await saveTeacher(d);
      setTimeout(async () => { await loadTeachers(); alert('✅ Data guru tersimpan.'); }, 800);
    } catch (err) { console.error(err); alert('Gagal menyimpan data guru'); }
  }
});

// editGuru global
window.editGuru = function(i) {
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
  if (cd) cd.textContent = new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  drawAnalogClock();
  try { getLocation(); } catch(e) {}
  await loadTeachers();
  await loadAttendance();
  setInterval(async () => { await loadAttendance(); }, 30000);
});
