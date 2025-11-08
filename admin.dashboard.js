// ==============================
// admin-dashboard.js (READ-ONLY MODE + Last Updated)
// ==============================

const GS_URL = 'https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec';

let guruList = [];
let kehadiranList = [];
let chartHarian = null;
let lastUpdated = null;

window.addEventListener('DOMContentLoaded', async () => {
  await initDashboard();
});

// === INISIALISASI ===
async function initDashboard() {
  try {
    showLoading('📡 Memuat data dari Google Sheet...');
    await Promise.all([loadGuru(), loadKehadiran()]);
    hideLoading();
    renderDashboard();
    updateLastUpdated();
  } catch (err) {
    console.error(err);
    alert('❌ Gagal memuat data. Periksa koneksi internet atau izin Google Sheet.');
  }
}

// === LOAD DATA (READ-ONLY) ===
async function loadGuru() {
  const res = await fetch(`${GS_URL}?sheet=guru`);
  const data = await res.json();
  guruList = data.slice(1).map(r => ({
    nama: r[0],
    nip: r[1],
    jabatan: r[2],
    status: r[3]
  }));
  renderGuruTable();
  updateDashboardStat();
}

async function loadKehadiran() {
  const res = await fetch(`${GS_URL}?sheet=kehadiran`);
  const data = await res.json();
  kehadiranList = data.slice(1).map(r => ({
    nama: r[0],
    status: r[1],
    jam: r[2],
    tanggal: normalizeDate(r[3]),
    lokasi: r[4]
  }));
  updateDashboardStat();
  renderChartHarian();
  renderRecentActivity();
}

// === NORMALISASI TANGGAL ===
function normalizeDate(v) {
  if (!v) return '';
  if (typeof v === 'string' && v.includes('T')) {
    const d = new Date(v);
    d.setHours(d.getUTCHours() + 7);
    return d.toISOString().split('T')[0];
  }
  return String(v).slice(0, 10);
}

// === DASHBOARD ===
function updateDashboardStat() {
  document.getElementById('stat-total-guru').textContent = guruList.length;
  const today = new Date().toISOString().split('T')[0];
  const todayData = kehadiranList.filter(r => r.tanggal === today);
  const hadir = todayData.filter(r => r.status === 'Hadir').length;
  const lain = todayData.filter(r => r.status !== 'Hadir').length;
  document.getElementById('stat-hadir').textContent = hadir;
  document.getElementById('stat-lain').textContent = lain;
}

function renderChartHarian() {
  const ctx = document.getElementById('chartHarian').getContext('2d');
  const today = new Date().toISOString().split('T')[0];
  const hariIni = kehadiranList.filter(r => r.tanggal === today);
  const counts = { Hadir: 0, Izin: 0, Sakit: 0, 'Dinas Luar': 0 };
  hariIni.forEach(r => {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  if (chartHarian) chartHarian.destroy();
  chartHarian = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        label: 'Jumlah Guru',
        data: Object.values(counts),
        backgroundColor: ['#16a34a', '#facc15', '#f87171', '#3b82f6']
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      responsive: true,
      scales: { y: { beginAtZero: true, precision: 0 } }
    }
  });
}

function renderRecentActivity() {
  const container = document.getElementById('recent-activity');
  const sorted = [...kehadiranList].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
  const latest = sorted.slice(0, 10);
  container.innerHTML = latest.map(r =>
    `<div class="flex justify-between border-b py-1">
      <span>${r.nama} - ${r.status}</span>
      <span class="text-gray-500 text-xs">${r.tanggal}</span>
    </div>`
  ).join('') || `<p class="text-gray-400">Belum ada data kehadiran.</p>`;
}

function renderDashboard() {
  updateDashboardStat();
  renderChartHarian();
  renderRecentActivity();
}

// === LAST UPDATED INDICATOR ===
function updateLastUpdated() {
  lastUpdated = new Date();
  const el = document.getElementById('lastUpdated');
  if (!el) {
    // buat elemen baru jika belum ada
    const target = document.querySelector('#page-dashboard h2');
    const info = document.createElement('p');
    info.id = 'lastUpdated';
    info.className = 'text-sm text-gray-500 italic mb-4';
    target.insertAdjacentElement('afterend', info);
  }
  const waktu = lastUpdated.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
  document.getElementById('lastUpdated').textContent = `⏱️ Diperbarui: ${waktu} WIB`;
}

// === DATA GURU (READ ONLY) ===
function renderGuruTable() {
  const tbody = document.getElementById('tabelGuru');
  if (!guruList.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-500">Belum ada data guru.</td></tr>`;
    return;
  }
  tbody.innerHTML = guruList.map((g) => `
    <tr class="hover:bg-blue-50">
      <td class="border p-2">${g.nip}</td>
      <td class="border p-2">${g.nama}</td>
      <td class="border p-2">${g.jabatan}</td>
      <td class="border p-2">${g.status}</td>
      <td class="border p-2 text-center text-gray-400 italic">Tidak dapat diubah</td>
    </tr>
  `).join('');
}

// === LAPORAN BULANAN ===
document.getElementById('tampilkanLaporan').addEventListener('click', generateLaporan);
async function generateLaporan() {
  const bulanInput = document.getElementById('bulanLaporan').value;
  if (!bulanInput) return alert('Pilih bulan terlebih dahulu.');

  const [tahun, bulan] = bulanInput.split('-');
  const filtered = kehadiranList.filter(r => r.tanggal.startsWith(`${tahun}-${bulan}`));
  const tbody = document.querySelector('#tabelLaporan tbody');

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">Tidak ada data untuk bulan ini.</td></tr>`;
    document.getElementById('resumeLaporan').innerHTML = '';
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td class="border p-2">${r.tanggal}</td>
      <td class="border p-2">${r.nama}</td>
      <td class="border p-2">${r.status}</td>
      <td class="border p-2">${r.jam}</td>
      <td class="border p-2">${r.lokasi}</td>
    </tr>
  `).join('');

  const total = { Hadir: 0, Izin: 0, Sakit: 0, 'Dinas Luar': 0 };
  filtered.forEach(r => { if (total[r.status] !== undefined) total[r.status]++; });

  document.getElementById('resumeLaporan').innerHTML = `
    <h4 class="font-semibold text-blue-900 mb-2">Resume Bulan ${bulan}-${tahun}</h4>
    <p>Hadir: <b>${total.Hadir}</b> | Izin: <b>${total.Izin}</b> | Sakit: <b>${total.Sakit}</b> | Dinas Luar: <b>${total['Dinas Luar']}</b></p>
    <p>Total Data: <b>${filtered.length}</b></p>
  `;
}

document.getElementById('exportLaporan').addEventListener('click', () => {
  const rows = [];
  document.querySelectorAll('#tabelLaporan tbody tr').forEach(tr => {
    const td = tr.querySelectorAll('td');
    if (td.length === 5)
      rows.push({
        Tanggal: td[0].textContent,
        Nama: td[1].textContent,
        Status: td[2].textContent,
        Jam: td[3].textContent,
        Lokasi: td[4].textContent
      });
  });
  if (!rows.length) return alert('Tidak ada data laporan untuk diekspor.');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  XLSX.writeFile(wb, `laporan_${new Date().toISOString().split('T')[0]}.xlsx`);
});

// === LOADING OVERLAY ===
function showLoading(msg) {
  const el = document.createElement('div');
  el.id = 'loadingOverlay';
  el.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50';
  el.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-lg text-center"><p class="text-blue-700 font-semibold">${msg}</p></div>`;
  document.body.appendChild(el);
}
function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.remove();
}

// === LOGOUT ===
document.getElementById('logoutBtn').addEventListener('click', () => {
  if (confirm('Keluar dari dashboard?')) window.location.href = 'admin.html';
});
