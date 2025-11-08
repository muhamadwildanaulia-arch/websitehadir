// --- KONFIGURASI APLIKASI ---
// Menggunakan CONST untuk kredensial admin agar lebih mudah diubah
const ADMIN_USER = 'admin';
const ADMIN_PASS = '198901162023211009'; // PENTING: Kredensial ini hanya untuk DEVELOPMENT. Sebaiknya gunakan Auth Google/Token.
// URL Apps Script Anda
const GS_URL = 'https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec';

// --- ELEMENT SELECTORS (Agar kode lebih bersih) ---
const loginPage = document.getElementById('loginPage');
const adminPanel = document.getElementById('adminPanel');
const sidebar = document.getElementById('sidebar');
const loginError = document.getElementById('loginError');

// --- EVENT LISTENERS (Menghubungkan tombol ke fungsi) ---
document.getElementById('loginButton').addEventListener('click', loginAdmin);
document.getElementById('logoutButton').addEventListener('click', logout);
document.getElementById('menuToggle').addEventListener('click', toggleSidebar);

// Menambahkan Event Listener untuk Navigasi Menu
document.querySelectorAll('.sidebar a[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault(); // Mencegah pindah halaman
        showPage(e.target.dataset.page);
        // Otomatis tutup sidebar di HP setelah klik menu
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('active');
        }
    });
});

// --- FUNGSI UTAMA ---

function toggleSidebar() {
    sidebar.classList.toggle('active');
}

/**
 * Handle proses login admin
 */
async function loginAdmin() {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();

    // Verifikasi menggunakan konstanta
    if (u === ADMIN_USER && p === ADMIN_PASS) {
        loginError.classList.add('hidden');
        loginPage.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        await initAdmin();
        window.scrollTo(0, 0);
    } else {
        loginError.classList.remove('hidden');
    }
}

/**
 * Handle proses logout admin
 */
function logout() {
    adminPanel.classList.add('hidden');
    loginPage.classList.remove('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    // Hentikan interval jam saat logout
    clearInterval(clockInterval);
}

/**
 * Memperbarui jam digital
 */
function updateClock() {
    const now = new Date();
    const jam = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = document.getElementById('clock');
    if (el) el.textContent = jam;
}
let clockInterval = null; // Variabel untuk menyimpan interval jam

/**
 * Menampilkan halaman/section yang diminta
 * @param {string} page - Nama halaman ('dashboard', 'guru', 'laporan')
 */
function showPage(page) {
    const pages = ['dashboard', 'guru', 'laporan'];
    
    pages.forEach(p => {
        const section = document.getElementById('page-' + p);
        const menu = document.getElementById('menu-' + p);
        
        // Sembunyikan semua section dan nonaktifkan semua menu
        if (section) section.classList.add('hidden');
        if (menu) menu.classList.remove('active');
        
        // Tampilkan section yang dipilih dan aktifkan menu
        if (p === page) {
            if (section) section.classList.remove('hidden');
            if (menu) menu.classList.add('active');
        }
    });

    // Perbarui judul halaman
    const title = document.getElementById('pageTitle');
    if (title) {
        title.textContent = page === 'guru' ? 'Data Guru' : (page === 'laporan' ? 'Laporan Kehadiran' : 'Dashboard');
    }
}

/**
 * Fungsi inisialisasi yang dipanggil setelah login berhasil
 */
async function initAdmin() {
    // Mulai jam digital
    if (clockInterval) clearInterval(clockInterval); // Bersihkan interval lama jika ada
    updateClock();
    clockInterval = setInterval(updateClock, 1000);

    // TODO: Panggil fungsi untuk mengambil dan menampilkan data
    console.log("Admin Panel Berhasil Dimuat.");
    // if(typeof loadGuru === 'function') await loadGuru(); 
    // if(typeof loadKehadiran === 'function') await loadKehadiran();
    showPage('dashboard');
}

// --- FUNGSI PENANGAN DATA (Belum diimplementasi, hanya sebagai placeholder) ---

/**
 * TODO: Implementasi fungsi untuk mengambil data guru dari Google Sheet
 */
async function loadGuru() {
    console.log('Memuat data guru dari Google Sheet...');
    // Contoh Fetch (Implementasi API Anda di sini)
    // const response = await fetch(`${GS_URL}?action=getGuru`);
    // const data = await response.json();
    // Tampilkan data di #guruTableBody
}

/**
 * TODO: Implementasi fungsi untuk mengambil data kehadiran dari Google Sheet
 */
async function loadKehadiran() {
    console.log('Memuat data kehadiran hari ini...');
    // Contoh Fetch (Implementasi API Anda di sini)
    // const response = await fetch(`${GS_URL}?action=getSummary`);
    // const summary = await response.json();
    // Perbarui #totalGuru, #totalHadir, #totalLain
}
