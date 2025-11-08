// app.js - terhubung ke Google Apps Script Web App yang kamu berikan
(function(){
  'use strict';

  // ==== GANTI INI SUDAH SAYA SET DENGAN LINK YANG KAMU KIRIM ====
  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec';
  const USE_GAS = true;

  const IDS = {
    tabSelector: '.tab',
    tabPrefix: 'tab-',
    attendanceForm: 'attendanceForm',
    saveBtn: 'btnSaveAttendance',
    tryLocBtn: 'btnTryLocation',
    locationInput: 'attendanceLocation',
    statusText: 'attendanceStatus',
    chartCanvas: 'attendanceChart',
    chartSub: 'chartSub',
    tzLabel: 'tzLabel',
    currentTime: 'currentTime'
  };

  function log(...a){ console.log('[WH]', ...a); }
  function warn(...a){ console.warn('[WH]', ...a); }
  function error(...a){ console.error('[WH]', ...a); }

  const state = { geo: null, chart: null, attendanceData: [] };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();

  function init(){
    setupTabs();
    setupClockAndTZ();
    setupChart();
    setupAttendanceHandlers();
    loadLocalAttendance();
    if (USE_GAS) fetchAttendanceFromServer();
    refreshChartFromData();
  }

  /* Tabs */
  function setupTabs(){
    const tabs = Array.from(document.querySelectorAll(IDS.tabSelector));
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        if(!name) return;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('[id^="' + IDS.tabPrefix + '"]').forEach(c => c.style.display='none');
        const active = document.getElementById(IDS.tabPrefix + name);
        if (active) active.style.display = '';
      });
    });
  }

  /* Clock & timezone */
  function setupClockAndTZ(){
    const tzLabel = document.getElementById(IDS.tzLabel);
    const currentTime = document.getElementById(IDS.currentTime);
    const chartSub = document.getElementById(IDS.chartSub);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (tzLabel) tzLabel.textContent = tz;
    } catch(e){ if (tzLabel) tzLabel.textContent = 'UTC'; }

    function update(){
      const now = new Date();
      const fmt = new Intl.DateTimeFormat(undefined, {
        hour:'2-digit', minute:'2-digit', second:'2-digit',
        day:'2-digit', month:'short', year:'numeric'
      });
      if (currentTime) currentTime.textContent = fmt.format(now);
      if (chartSub) chartSub.textContent = 'Periode: ' + now.toLocaleDateString();
    }
    update();
    setInterval(update,1000);
  }

  /* Chart */
  function setupChart(){
    const canvas = document.getElementById(IDS.chartCanvas);
    if (!canvas) return warn('Chart canvas not found');
    const ctx = canvas.getContext('2d');

    state.chart = new Chart(ctx, {
      type:'line',
      data:{
        labels:['06:00','07:00','08:00','09:00','10:00','11:00'],
        datasets:[{
          label:'Kehadiran (orang)',
          data:[2,4,6,8,5,7],
          tension:0.35,
          fill:true,
          backgroundColor:'rgba(43,118,246,0.12)',
          borderColor:'rgba(43,118,246,1)',
          pointRadius:3
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ display:false } },
        scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } }
      }
    });
  }

  function refreshChartFromData(){
    if (!state.chart) return;
    const counts = {};
    state.attendanceData.forEach(item=>{
      try {
        const d = new Date(item.timestamp);
        const h = d.getHours().toString().padStart(2,'0') + ':00';
        counts[h] = (counts[h] || 0) + 1;
      } catch(e){}
    });
    const hours = [];
    for (let h=6; h<=18; h++) hours.push(h.toString().padStart(2,'0') + ':00');
    const series = hours.map(h=>counts[h]||0);
    if (state.attendanceData.length>0) {
      state.chart.data.labels = hours;
      state.chart.data.datasets[0].data = series;
    }
    state.chart.update();
  }

  /* Attendance + geolocation */
  function setupAttendanceHandlers(){
    const saveBtn = document.getElementById(IDS.saveBtn);
    const tryLocBtn = document.getElementById(IDS.tryLocBtn);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.addEventListener('click', onSaveClick); }
    if (tryLocBtn) tryLocBtn.addEventListener('click', onTryLocationClick);

    setStatus('Mencoba mendapatkan lokasi otomatis...');
    tryGetLocation(7000).then(pos=>{
      if (pos) {
        state.geo = pos;
        const lat = pos.coords.latitude.toFixed(6), lon = pos.coords.longitude.toFixed(6);
        const locInput = document.getElementById(IDS.locationInput);
        if (locInput) locInput.value = `${lat}, ${lon}`;
        setStatus(`Lokasi terdeteksi: ${lat}, ${lon}`);
      } else {
        setStatus('Lokasi otomatis tidak tersedia. Isi manual atau tekan "Coba Dapatkan Lokasi".');
      }
    }).catch(err=>{
      warn('Auto location error', err);
      setStatus('Gagal mendapatkan lokasi otomatis.');
    });
  }

  function setStatus(txt){
    const el = document.getElementById(IDS.statusText);
    if (el) el.textContent = txt;
  }

  function tryGetLocation(timeoutMs=8000){
    return new Promise((resolve)=>{
      if (!navigator.geolocation) { resolve(null); return; }
      let finished=false;
      const opts={enableHighAccuracy:true,timeout:timeoutMs,maximumAge:0};
      navigator.geolocation.getCurrentPosition(pos=>{ if (finished) return; finished=true; resolve(pos); }, geErr=>{ if (finished) return; finished=true; warn('geo err',geErr); resolve(null); }, opts);
      setTimeout(()=>{ if (!finished){ finished=true; warn('geo timeout'); resolve(null); } }, timeoutMs+1200);
    });
  }

  function onTryLocationClick(e){
    e&&e.preventDefault();
    setStatus('Meminta izin lokasi...');
    tryGetLocation(10000).then(pos=>{
      if (pos) {
        state.geo = pos;
        const lat = pos.coords.latitude.toFixed(6), lon = pos.coords.longitude.toFixed(6);
        const locInput = document.getElementById(IDS.locationInput);
        if (locInput) locInput.value = `${lat}, ${lon}`;
        setStatus(`Lokasi berhasil: ${lat}, ${lon}`);
      } else {
        setStatus('Gagal mendapatkan lokasi. Periksa izin browser atau isi manual.');
      }
    }).catch(err=>{
      warn('manual geo err', err);
      setStatus('Error saat permintaan lokasi.');
    });
  }

  /* Save attendance (POST to GAS or fallback local) */
  async function onSaveClick(e){
    e&&e.preventDefault();
    const saveBtn = document.getElementById(IDS.saveBtn);
    if (saveBtn) saveBtn.disabled = true;
    try {
      const form = document.getElementById(IDS.attendanceForm);
      const payload = {};
      if (form){
        const inputs = form.querySelectorAll('input[name], select[name], textarea[name]');
        inputs.forEach(inp=>payload[inp.name]=inp.value);
      }
      if (state.geo) {
        payload.latitude = state.geo.coords.latitude;
        payload.longitude = state.geo.coords.longitude;
        payload.accuracy = state.geo.coords.accuracy;
      }
      payload.timestamp = new Date().toISOString();

      if (!payload.teacherName || payload.teacherName.trim()===''){
        alert('Nama guru harus diisi.');
        return;
      }

      if (USE_GAS){
        try {
          const resp = await fetch(WEB_APP_URL, {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ action:'save', data: payload })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const j = await resp.json();
          if (j && j.success){
            if (j.saved) {
              state.attendanceData.push(j.saved);
              saveLocalMirror(state.attendanceData);
            } else {
              // if server replies with saved data missing timestamp, add payload as mirror
              state.attendanceData.push(payload);
              saveLocalMirror(state.attendanceData);
            }
            setStatus('Kehadiran tersimpan ke server.');
            alert('Kehadiran tersimpan ke server.');
          } else {
            warn('GAS returned non-success, falling back', j);
            saveToLocalFallback(payload);
            setStatus('Gagal simpan ke server — disimpan lokal.');
            alert('Gagal simpan ke server. Data disimpan lokal.');
          }
        } catch (err){
          warn('POST to GAS failed', err);
          saveToLocalFallback(payload);
          setStatus('Tidak bisa mencapai server — disimpan lokal.');
          alert('Tidak bisa mencapai server. Data disimpan lokal.');
        }
      } else {
        saveToLocalFallback(payload);
        setStatus('Data disimpan lokal (server belum dikonfigurasi).');
        alert('Data disimpan lokal.');
      }

    } catch(err){
      error('onSaveClick error', err);
      alert('Terjadi error. Lihat console.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      refreshChartFromData();
    }
  }

  /* Fetch attendance from GAS (GET) */
  async function fetchAttendanceFromServer(){
    try {
      const resp = await fetch(WEB_APP_URL + '?action=list');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const j = await resp.json();
      // Accept either array or wrapper {success:true, data: [...]}
      if (Array.isArray(j)) {
        state.attendanceData = j;
      } else if (j && Array.isArray(j.data)) {
        state.attendanceData = j.data;
      } else {
        warn('Unexpected list response from GAS', j);
        return;
      }
      saveLocalMirror(state.attendanceData);
      refreshChartFromData();
      setStatus('Data hadir diambil dari server.');
    } catch(err){
      warn('fetchAttendanceFromServer failed', err);
      setStatus('Gagal ambil data dari server — gunakan data lokal.');
    }
  }

  /* Local fallback helpers */
  function saveToLocalFallback(payload){
    try {
      const key = 'attendance_backup';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      existing.push(payload);
      localStorage.setItem(key, JSON.stringify(existing));
      state.attendanceData = existing;
      saveLocalMirror(existing);
      log('Saved to local fallback', payload);
    } catch(e){
      error('saveToLocalFallback failed', e);
    }
  }
  function loadLocalAttendance(){
    try {
      const key = 'attendance_backup';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      state.attendanceData = arr || [];
    } catch(e){
      state.attendanceData = [];
    }
  }
  function saveLocalMirror(arr){
    try { localStorage.setItem('attendance_mirror', JSON.stringify(arr)); } catch(e){}
  }

})();
