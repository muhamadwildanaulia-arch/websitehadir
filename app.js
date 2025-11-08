// app.js - versi rebuild yang kompatibel dengan struktur HTML lama
// - Pastikan file ini di-include dengan 'defer' atau sebelum </body>.
// - Tidak mengubah id HTML yang ada: attendanceForm, btnSaveAttendance, attendanceLocation, attendanceStatus.

(function () {
  'use strict';

  // --- Konstanta id (jangan ubah kecuali kamu ubah HTML) ---
  const IDS = {
    form: 'attendanceForm',
    saveBtn: 'btnSaveAttendance',
    tryLocBtn: 'btnTryLocation',
    locationInput: 'attendanceLocation',
    statusText: 'attendanceStatus'
  };

  // --- util debug sederhana ---
  function log(...args) { console.log('[WH]', ...args); }
  function warn(...args) { console.warn('[WH]', ...args); }
  function error(...args) { console.error('[WH]', ...args); }

  // --- state lokal ---
  const state = {
    geo: null,            // terakhir posisi dari geolocation API
    locationPermitted: false
  };

  // --- helper untuk DOM ---
  function $(id) { return document.getElementById(id); }

  // --- inisialisasi setelah DOM siap ---
  function init() {
    log('init start');

    // jika sudah ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  function onReady() {
    log('DOM ready');
    const saveBtn = $(IDS.saveBtn);
    const tryLocBtn = $(IDS.tryLocBtn);
    const locInput = $(IDS.locationInput);
    const status = $(IDS.statusText);

    if (!saveBtn) {
      error('Tombol simpan tidak ditemukan (id=', IDS.saveBtn, '). Pastikan struktur HTML tetap sama.');
      return;
    }

    // Pastikan tombol enable
    saveBtn.disabled = false;

    // Pasang handler; hapus dulu untuk menghindari ganda
    saveBtn.removeEventListener('click', onSaveClick);
    saveBtn.addEventListener('click', onSaveClick);

    if (tryLocBtn) {
      tryLocBtn.removeEventListener('click', onTryLocationClick);
      tryLocBtn.addEventListener('click', onTryLocationClick);
    }

    // Coba otomatis ambil lokasi (non-blocking)
    setStatus('Mencoba mendapatkan lokasi otomatis...');
    tryGetLocation(8000).then(pos => {
      if (pos) {
        state.geo = pos;
        state.locationPermitted = true;
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        if (locInput) locInput.value = `${lat}, ${lon}`;
        setStatus(`Lokasi terdeteksi: ${lat}, ${lon}`);
        log('Geolocation success', pos);
      } else {
        setStatus('Lokasi otomatis tidak tersedia. Bisa diisi manual atau klik "Coba Dapatkan Lokasi".');
        log('No geolocation available');
      }
    }).catch(err => {
      warn('tryGetLocation threw', err);
      setStatus('Gagal mendapatkan lokasi otomatis. Isi manual atau klik "Coba Dapatkan Lokasi".');
    });

    function setStatus(text) {
      const s = $(IDS.statusText);
      if (s) s.textContent = text;
    }
  }

  // --- setStatus global helper (dipakai di beberapa tempat) ---
  function setStatus(text) {
    const s = $(IDS.statusText);
    if (s) s.textContent = text;
  }

  // --- getCurrentPosition wrapped with Promise dan timeout fallback ---
  function tryGetLocation(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        log('Browser tidak mendukung geolocation');
        resolve(null);
        return;
      }

      let finished = false;
      const options = { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (finished) return;
          finished = true;
          resolve(position);
        },
        (geoErr) => {
          if (finished) return;
          finished = true;
          // jangan reject; resolve null agar alur tetap berjalan
          warn('geolocation error', geoErr);
          resolve(null);
        },
        options
      );

      // extra safety timeout
      setTimeout(() => {
        if (finished) return;
        finished = true;
        warn('getCurrentPosition manual timeout');
        resolve(null);
      }, timeoutMs + 2000);
    });
  }

  // --- handler tombol "Coba Dapatkan Lokasi" ---
  function onTryLocationClick(e) {
    e && e.preventDefault();
    setStatus('Mencoba meminta lokasi (akan muncul prompt izin di browser)...');
    tryGetLocation(10000).then(pos => {
      if (pos) {
        state.geo = pos;
        state.locationPermitted = true;
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        const locInput = $(IDS.locationInput);
        if (locInput) locInput.value = `${lat}, ${lon}`;
        setStatus(`Lokasi berhasil: ${lat}, ${lon}`);
        log('Manual geolocation success', pos);
      } else {
        setStatus('Gagal mendapatkan lokasi. Pastikan permission diizinkan atau isi kolom lokasi secara manual.');
      }
    }).catch(err => {
      warn('Error when manual get location', err);
      setStatus('Error saat mencoba lokasi. Lihat console.');
    });
  }

  // --- handler tombol Simpan ---
  function onSaveClick(e) {
    e && e.preventDefault();
    const saveBtn = $(IDS.saveBtn);
    if (saveBtn) saveBtn.disabled = true; // mencegah double click

    try {
      const formEl = $(IDS.form);
      const payload = {};

      if (formEl) {
        // ambil semua input/select/textarea di dalam form
        const inputs = formEl.querySelectorAll('input[name], select[name], textarea[name]');
        inputs.forEach(inp => {
          // gunakan value (untuk checkbox/radio bisa dikembangkan bila perlu)
          payload[inp.name] = inp.value;
        });
      } else {
        // fallback: ambil nama dan lokasi manual
        const name = document.getElementById('teacherName');
        const cls = document.getElementById('className');
        if (name && name.value) payload.teacherName = name.value;
        if (cls && cls.value) payload.className = cls.value;
        const loc = document.getElementById(IDS.locationInput);
        if (loc && loc.value) payload.location = loc.value;
      }

      // jika ada geolocation dari API, prioritaskan
      if (state.geo) {
        payload.latitude = state.geo.coords.latitude;
        payload.longitude = state.geo.coords.longitude;
        payload.accuracy = state.geo.coords.accuracy;
      }

      payload.timestamp = new Date().toISOString();

      // Minimal validation: nama wajib
      if (!payload.teacherName || payload.teacherName.trim() === '') {
        alert('Nama guru harus diisi.');
        return;
      }

      // Simpan ke server (contoh): ganti URL dengan endpoint nyata
      // fetch('/api/attendance', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(payload)
      // }).then(res => { ... })

      // Sementara: simpan fallback di localStorage agar tidak hilang
      try {
        const stored = JSON.parse(localStorage.getItem('attendance_backup') || '[]');
        stored.push(payload);
        localStorage.setItem('attendance_backup', JSON.stringify(stored));
        log('Saved attendance to localStorage fallback', payload);
        setStatus('Kehadiran tersimpan (fallback local). Jika seharusnya ke server, periksa endpoint.');
        alert('Kehadiran tersimpan.');
      } catch (ex) {
        error('Gagal menyimpan fallback:', ex);
        alert('Gagal menyimpan data. Lihat console untuk detail.');
      }

    } catch (ex) {
      error('Error saat proses simpan', ex);
      alert('Terjadi error saat menyimpan. Lihat console.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // --- start ---
  init();

})();
