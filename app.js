// app.js — robust index script: fetch no-cache, search dropdown, anti-duplikat 1x/hari,
// late after 07:30, geofence 100m (coords set), photo preview (local only), doughnut chart light.

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

// KOORDINAT SEKOLAH (isi dari link yang kamu berikan)
const SCHOOL_LAT = -6.7010469;
const SCHOOL_LON = 107.0521643;
const RADIUS_LIMIT_M = 100;

let teachers = [];
let attendanceRecords = [];
let dailyChart = null;
let lastCounts = null;
let _submitMutex = false;
let lastLat = null, lastLon = null;

/* ---------- utilities ---------- */
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function todayISO(){ return new Date().toISOString().split('T')[0]; }
function normalizeDate(v){
  if(!v) return '';
  if(typeof v==='string' && v.includes('T')){ const d=new Date(v); d.setHours(d.getHours()+7); return d.toISOString().split('T')[0]; }
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v); return !isNaN(d) ? d.toISOString().split('T')[0] : String(v).trim();
}
function normalizeName(s=''){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
async function fetchJsonNoCache(url){
  const sep = url.includes('?') ? '&' : '?';
  const full = `${url}${sep}_ts=${Date.now()}`;
  const res = await fetch(full, { cache: 'no-store', headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }});
  return res.json();
}

/* ---------- avatar small ---------- */
const AVATAR_COLORS = ["#1D4ED8","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#22C55E","#E11D48"];
function hashCode(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0;} return Math.abs(h); }
function initials(n){ const p=n.trim().split(/\s+/); return ((p[0]?.[0]||'') + (p[1]?.[0]||'')).toUpperCase() || '?'; }
function avatarHtml(n){ const c=AVATAR_COLORS[hashCode(n)%AVATAR_COLORS.length]; return `<span class="avatar" style="background:${c}">${initials(n)}</span><span>${escapeHtml(n)}</span>`; }

/* ---------- clock ---------- */
function drawAnalogClock(){
  const canvas = document.getElementById('analogClock'); if(!canvas) return;
  const ctx = canvas.getContext('2d'); const r = canvas.height/2;
  ctx.setTransform(1,0,0,1,0,0); ctx.translate(r,r);
  function face(){ ctx.beginPath(); ctx.arc(0,0,r*0.95,0,2*Math.PI); ctx.fillStyle='white'; ctx.fill(); ctx.strokeStyle='#1e3a8a'; ctx.lineWidth=r*0.05; ctx.stroke(); }
  function nums(){ ctx.font=r*0.15+'px Arial'; ctx.textBaseline='middle'; ctx.textAlign='center'; for(let n=1;n<=12;n++){ const ang=(n*Math.PI)/6; ctx.rotate(ang); ctx.translate(0,-r*0.85); ctx.rotate(-ang); ctx.fillText(n.toString(),0,0); ctx.rotate(ang); ctx.translate(0,r*0.85); ctx.rotate(-ang); } }
  function hand(pos,len,w,col){ ctx.beginPath(); ctx.lineWidth=w; ctx.lineCap='round'; ctx.strokeStyle=col; ctx.moveTo(0,0); ctx.rotate(pos); ctx.lineTo(0,-len); ctx.stroke(); ctx.rotate(-pos); }
  function time(){ const now=new Date(); const h=now.getHours()%12, m=now.getMinutes(), s=now.getSeconds(); hand(((h*Math.PI)/6)+((m*Math.PI)/(6*60))+((s*Math.PI)/(360*60)), r*0.5, r*0.07, '#1e3a8a'); hand(((m*Math.PI)/30)+((s*Math.PI)/(30*60)), r*0.8, r*0.05, '#2563eb'); hand((s*Math.PI)/30, r*0.9, r*0.02, '#ef4444'); }
  function draw(){ ctx.clearRect(-r,-r,canvas.width,canvas.height); face(); nums(); time(); }
  draw(); if(window._clockInt) clearInterval(window._clockInt); window._clockInt = setInterval(draw,1000);
}

/* ---------- load/save ---------- */
async function loadTeachers(){
  try {
    const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + '?sheet=guru');
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else if (raw && Array.isArray(raw.values)) rows = raw.values;
    else rows = [];
    if (!rows.length){ teachers = []; updateTeacherDropdown(); return; }
    // detect header row
    const first = rows[0];
    const dataRows = (Array.isArray(first) && first.some(c => /nama|nip|jabatan|status/i.test(String(c)))) ? rows.slice(1) : rows;
    teachers = dataRows.map(r => {
      if (Array.isArray(r)) return { nama_guru: (r[0]||'').toString().trim(), nip: (r[1]||'').toString().trim(), jabatan: (r[2]||'').toString().trim(), status: (r[3]||'').toString().trim() };
      if (typeof r === 'object') return { nama_guru: (r[0]||r.nama_guru||'').toString().trim(), nip: (r[1]||r.nip||'').toString().trim(), jabatan: (r[2]||r.jabatan||''), status: (r[3]||r.status||'')};
      return { nama_guru: String(r||''), nip:'', jabatan:'', status:'' };
    }).filter(t => t.nama_guru);
    updateTeacherDropdown();
    document.dispatchEvent(new Event('teachers-updated'));
  } catch (e) {
    console.error('loadTeachers error', e);
    teachers = [];
    updateTeacherDropdown();
  }
}

async function loadAttendance(){
  try {
    const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL + '?sheet=kehadiran');
    let rows = [];
    if (Array.isArray(raw)) rows = raw;
    else if (raw && Array.isArray(raw.values)) rows = raw.values;
    else rows = [];
    attendanceRecords = [];
    if (rows.length >= 2) {
      const dataRows = rows.slice(1);
      attendanceRecords = dataRows.map(r => {
        if (Array.isArray(r)) return { nama_guru: r[0]||'', status: r[1]||'', jam: r[2]||'', tanggal: normalizeDate(r[3]||''), lokasi: r[4]||'' };
        if (typeof r === 'object') return { nama_guru: r[0]||r.nama_guru||'', status: r[1]||r.status||'', jam: r[2]||r.jam||'', tanggal: normalizeDate(r[3]||r.tanggal||''), lokasi: r[4]||r.lokasi||'' };
        return { nama_guru: String(r), status:'', jam:'', tanggal:'', lokasi:'' };
      });
    }
    updateAttendanceToday();
  } catch (e) {
    console.error('loadAttendance error', e);
    attendanceRecords = [];
    updateAttendanceToday();
  }
}

async function saveAttendance(d){
  try { await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ type: 'attendance', data: d }) }); }
  catch(e){ console.error('saveAttendance', e); }
}

/* ---------- UI helpers ---------- */
function updateTeacherDropdown(){
  const sel = document.getElementById('nama-guru-kehadiran'), search = document.getElementById('search-guru');
  if(!sel) return;
  const prev = sel.value || '';
  sel.innerHTML = '';
  const ph = document.createElement('option'); ph.value=''; ph.textContent='-- Pilih Guru --'; sel.appendChild(ph);
  if(!teachers.length){
    const empty = document.createElement('option'); empty.value=''; empty.textContent='Belum ada data guru'; empty.disabled=true; sel.appendChild(empty);
    attachAlreadyCheckedWarning(sel);
    return;
  }
  teachers.forEach(t => {
    const o = document.createElement('option'); o.value = t.nama_guru; o.textContent = t.nama_guru; sel.appendChild(o);
  });
  if(prev && Array.from(sel.options).some(o=>o.value===prev)) sel.value = prev;
  attachAlreadyCheckedWarning(sel);

  if(search){
    const doFilter = () => {
      const q = normalizeName(search.value);
      Array.from(sel.options).forEach(opt => {
        if(!opt.value) return;
        opt.hidden = q ? !normalizeName(opt.value).includes(q) : false;
      });
    };
    search.removeEventListener('input', debounce(doFilter,100));
    search.addEventListener('input', debounce(doFilter,100));
    if(search.value && search.value.trim()) doFilter();
  }
}

/* attendance list */
function isToday(d){
  if(!d) return false;
  const t = new Date(), x = new Date(d);
  return x.getDate()===t.getDate() && x.getMonth()===t.getMonth() && x.getFullYear()===t.getFullYear();
}
function updateAttendanceToday(){
  const tbody = document.getElementById('attendance-list'); if(!tbody) return;
  const todayData = attendanceRecords.filter(r => isToday(r.tanggal));
  if(!todayData.length){ tbody.innerHTML = '<tr><td colspan="5" style="padding:.8rem;text-align:center">Belum ada kehadiran hari ini</td></tr>'; updateDuplicateAndBanners(); return; }
  tbody.innerHTML = todayData.map(r => `<tr>
    <td style="padding:.6rem;border:1px solid #eef2f7">${avatarHtml(r.nama_guru)}</td>
    <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.status)}</td>
    <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.jam)}</td>
    <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.lokasi||'')}</td>
    <td style="padding:.6rem;border:1px solid #eef2f7">${escapeHtml(r.tanggal)}</td>
  </tr>`).join('');
  updateDuplicateAndBanners();
}

/* ---------- anti-dupe & banners ---------- */
function hasSubmittedTodayServerSide(name){ if(!name) return false; const who=normalizeName(name), t=todayISO(); return attendanceRecords.some(r=>normalizeDate(r.tanggal)===t && normalizeName(r.nama_guru)===who); }
function hasSubmittedTodayLocal(name){ if(!name) return false; return localStorage.getItem(`absen:${todayISO()}:${normalizeName(name)}`) === '1'; }
function markSubmittedLocal(name){ if(!name) return; localStorage.setItem(`absen:${todayISO()}:${normalizeName(name)}`,'1'); }
function show(el){ el?.classList.remove('hidden'); }
function hide(el){ el?.classList.add('hidden'); }

function updateAlreadyAbsentBanner(nama){
  const already = hasSubmittedTodayLocal(nama) || hasSubmittedTodayServerSide(nama);
  const banner = document.getElementById('already-banner');
  const btn = document.querySelector('#attendance-form button[type="submit"]');
  const statusSel = document.getElementById('status-kehadiran');
  const warn = document.getElementById('warn-sudah-absen');
  if(already && nama){
    show(banner);
    if(warn) warn.textContent = '⚠️ Guru ini sudah mengisi kehadiran hari ini.';
    if(btn){ btn.disabled=true; btn.classList.add('opacity-60'); }
    if(statusSel){ statusSel.disabled=true; statusSel.classList.add('opacity-60'); }
  } else {
    hide(banner);
    if(warn) warn.textContent = '';
    if(btn){ btn.disabled=false; btn.classList.remove('opacity-60'); }
    if(statusSel){ statusSel.disabled=false; statusSel.classList.remove('opacity-60'); }
  }
}

function minutesLate(now=new Date()){
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30, 0);
  const diff = Math.floor((now - cutoff)/60000);
  return diff>0 ? diff : 0;
}
function updateLateBanner(){
  const mins = minutesLate(new Date());
  const b = document.getElementById('late-banner'), t = document.getElementById('late-minutes');
  if(mins>0){ if(t) t.textContent = `(kesiangan ${mins} menit)`; show(b); } else hide(b);
}

/* haversine */
function distanceMeters(lat1,lon1,lat2,lon2){
  if([lat1,lon1,lat2,lon2].some(v=>v===null||v===undefined||isNaN(v))) return null;
  const R=6371000, toRad = x => x*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function updateDistanceBanner(){
  const b = document.getElementById('distance-banner'), info = document.getElementById('distance-info'), txt = document.getElementById('distance-text');
  const dist = distanceMeters(lastLat,lastLon,SCHOOL_LAT,SCHOOL_LON);
  if(dist===null) return;
  if(txt) txt.textContent = `Jarak Anda dari sekolah ± ${dist} m.`;
  if(info){
    if(dist > RADIUS_LIMIT_M){
      info.innerHTML = `<span class="badge" style="background:#FEF3C7;color:#92400E">⚠️ Di luar area (> ${RADIUS_LIMIT_M} m)</span>`;
      show(b);
    } else {
      info.innerHTML = `<span class="badge" style="background:#DCFCE7;color:#064E3B">🟢 Dalam area sekolah</span>`;
      hide(b);
    }
  }
}

function updateDuplicateAndBanners(){
  const sel = document.getElementById('nama-guru-kehadiran');
  const nama = sel?.value || '';
  attachAlreadyCheckedWarning(sel);
  updateAlreadyAbsentBanner(nama);
  updateLateBanner();
  updateDistanceBanner();
}

function attachAlreadyCheckedWarning(selectEl){
  if(!selectEl) return;
  const warn = document.getElementById('warn-sudah-absen'), btn = document.querySelector('#attendance-form button[type="submit"]'), statusSel = document.getElementById('status-kehadiran');
  const update = () => {
    const nama = selectEl.value;
    const already = hasSubmittedTodayLocal(nama) || hasSubmittedTodayServerSide(nama);
    if(nama && already){
      if(warn) warn.textContent = '⚠️ Guru ini sudah mengisi kehadiran hari ini.';
      if(btn){ btn.disabled=true; btn.classList.add('opacity-60'); }
      if(statusSel){ statusSel.disabled=true; statusSel.classList.add('opacity-60'); }
      updateAlreadyAbsentBanner(nama);
    } else {
      if(warn) warn.textContent = '';
      if(btn){ btn.disabled=false; btn.classList.remove('opacity-60'); }
      if(statusSel){ statusSel.disabled=false; statusSel.classList.remove('opacity-60'); }
      updateAlreadyAbsentBanner('');
    }
    updateLateBanner();
  };
  selectEl.addEventListener('change', update);
  update();
}

/* ---------- chart ---------- */
function getTodayCounts(){
  const t = todayISO(), td = attendanceRecords.filter(r => normalizeDate(r.tanggal) === t);
  const c = { Hadir:0, Izin:0, Sakit:0, "Dinas Luar":0 };
  td.forEach(r => { if(c.hasOwnProperty(r.status)) c[r.status]++; });
  document.getElementById('stat-hadir') && (document.getElementById('stat-hadir').textContent = c.Hadir);
  document.getElementById('stat-izin') && (document.getElementById('stat-izin').textContent = c.Izin);
  document.getElementById('stat-sakit') && (document.getElementById('stat-sakit').textContent = c.Sakit);
  document.getElementById('stat-dl') && (document.getElementById('stat-dl').textContent = c["Dinas Luar"]);
  return c;
}
function sameCounts(a,b){ return !!a && !!b && a.Hadir===b.Hadir && a.Izin===b.Izin && a.Sakit===b.Sakit && a["Dinas Luar"]===b["Dinas Luar"]; }

function ensureChart(){
  const cvs = document.getElementById('dailyChart'); if(!cvs) return null;
  if(dailyChart) return dailyChart;
  const eco = localStorage.getItem('ecoMode') === '1';
  dailyChart = new Chart(cvs.getContext('2d'), {
    type: 'doughnut',
    data: { labels: ["Hadir","Izin","Sakit","Dinas Luar"], datasets: [{ data:[0,0,0,0], borderWidth:0 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'62%', animation:false, plugins:{ legend:{ position:'bottom' }, tooltip:{ enabled:true } } }
  });
  return dailyChart;
}
const updateChartDebounced = debounce(updateChart, 120);
function updateChart(){
  const c = ensureChart(); if(!c) return;
  const counts = getTodayCounts();
  if(sameCounts(counts, lastCounts)) return;
  c.data.datasets[0].data = [counts.Hadir, counts.Izin, counts.Sakit, counts["Dinas Luar"]];
  lastCounts = counts;
  c.update('none');
}

/* ---------- GPS ---------- */
function getLocation(){
  const locInput = document.getElementById('keterangan-lokasi');
  if(!locInput) return;
  if(!navigator.geolocation){ locInput.value = 'Browser tidak mendukung GPS'; return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    lastLat = pos.coords.latitude; lastLon = pos.coords.longitude;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lastLat}&lon=${lastLon}`);
      const j = await res.json();
      locInput.value = j.display_name || `${lastLat}, ${lastLon}`;
    } catch(e) { locInput.value = `${lastLat}, ${lastLon}`; }
    updateDistanceBanner();
  }, () => { locInput.value = 'Gagal mengambil lokasi'; });
}

/* ---------- events: submit, photo ---------- */
document.addEventListener('submit', async e => {
  if(!e.target) return;
  if(e.target.id === 'attendance-form'){
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const nama = document.getElementById('nama-guru-kehadiran').value;
    if(_submitMutex) return; _submitMutex = true;

    if(hasSubmittedTodayLocal(nama)){ alert('⚠️ Guru ini sudah absen hari ini (lokal).'); _submitMutex=false; return; }
    await loadAttendance();
    if(hasSubmittedTodayServerSide(nama)){ alert('⚠️ Guru ini sudah absen hari ini.'); updateDuplicateAndBanners(); _submitMutex=false; return; }

    const now = new Date();
    const terlambat = minutesLate(now);
    const baseLok = document.getElementById('keterangan-lokasi').value || '';
    const dist = distanceMeters(lastLat,lastLon,SCHOOL_LAT,SCHOOL_LON);
    const jarakInfo = dist == null ? '' : ` | Jarak≈${dist}m`;
    const ketLate = terlambat > 0 ? ` | Terlambat ${terlambat} menit` : '';

    const payload = {
      nama_guru: nama,
      status: document.getElementById('status-kehadiran').value,
      jam_hadir: now.toLocaleTimeString('id-ID'),
      tanggal: todayISO(),
      keterangan_lokasi: baseLok + ketLate + jarakInfo
    };

    const overlay = document.createElement('div'); overlay.id='loading-msg'; overlay.style.position='fixed'; overlay.style.inset=0; overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center'; overlay.style.background='rgba(0,0,0,.35)'; overlay.style.zIndex=9999;
    overlay.innerHTML = `<div style="background:#fff;padding:18px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12)"><strong style="color:#1e3a8a">⏳ Menyimpan...</strong></div>`;
    document.body.appendChild(overlay);
    if(btn){ btn.disabled=true; btn.classList.add('opacity-60'); }

    await saveAttendance(payload);

    markSubmittedLocal(nama);
    attendanceRecords.push({ nama_guru: payload.nama_guru, status: payload.status, jam: payload.jam_hadir, tanggal: payload.tanggal, lokasi: payload.keterangan_lokasi });

    setTimeout(async ()=>{
      await loadAttendance();
      document.getElementById('loading-msg')?.remove();
      if(btn){ btn.disabled=false; btn.classList.remove('opacity-60'); }
      updateDuplicateAndBanners();
      _submitMutex=false;
    }, 700);

    e.target.reset();
  }
});

/* photo preview */
(function(){
  const input = document.getElementById('foto-kehadiran'), wrap = document.getElementById('foto-preview-wrap'), img = document.getElementById('preview-foto'), btn = document.getElementById('hapus-foto');
  if(!input || !img) return;
  input.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if(!f){ wrap.classList.add('hidden'); img.src=''; return; }
    const reader = new FileReader();
    reader.onload = ev => { img.src = ev.target.result; wrap.classList.remove('hidden'); };
    reader.readAsDataURL(f);
  });
  btn?.addEventListener('click', ()=>{ input.value=''; img.src=''; wrap.classList.add('hidden'); });
})();

/* ---------- init ---------- */
window.addEventListener('load', async ()=>{
  drawAnalogClock();
  try{ getLocation(); }catch(e){}
  await loadTeachers();
  await loadAttendance();
  document.getElementById('nama-guru-kehadiran')?.addEventListener('change', ()=> updateDuplicateAndBanners());
  setInterval(()=> updateLateBanner(), 60000);
  setInterval(async ()=> { await loadAttendance(); }, 60000);

  // fallback UI: if select stays empty create clickable list
  (function fallbackList(){
    setTimeout(()=> {
      const sel = document.getElementById('nama-guru-kehadiran');
      if(!sel || (sel.options && sel.options.length>1)) return;
      const wrap = document.createElement('div'); wrap.style.marginTop='8px';
      if(teachers && teachers.length){
        teachers.forEach(t => {
          const b = document.createElement('button'); b.type='button'; b.textContent = t.nama_guru; b.style.margin='4px'; b.style.padding='8px'; b.style.borderRadius='8px'; b.style.border='1px solid #eee'; b.style.background='#fff';
          b.addEventListener('click', ()=>{ if(sel){ if(!Array.from(sel.options).some(o=>o.value===t.nama_guru)){ const o=document.createElement('option'); o.value=t.nama_guru; o.textContent=t.nama_guru; sel.appendChild(o);} sel.value=t.nama_guru; sel.dispatchEvent(new Event('change')); } });
          wrap.appendChild(b);
        });
        const parent = document.getElementById('search-guru')?.parentElement || document.getElementById('attendance-form');
        parent && parent.appendChild(wrap);
      }
    }, 600);
  })();
});

/* ---------- small helpers for external use ---------- */
window.editGuru = function(i){ const g = teachers[i]; try{ document.getElementById('nama-guru').value = g.nama_guru; }catch(e){} };
window.switchTab = function(){};

/* ---------- optional debug helper (visible on page when needed) ---------- */
/* Uncomment block below to enable visual debug box (temporary) */
/*
(function addDebugBox(){
  const box = document.createElement('div'); box.style.position='fixed'; box.style.right='12px'; box.style.bottom='12px'; box.style.background='rgba(0,0,0,.7)'; box.style.color='#fff'; box.style.padding='8px 10px'; box.style.borderRadius='8px'; box.style.zIndex=99999; box.id='debug-box'; box.textContent='debug...'; document.body.appendChild(box);
  (async ()=>{ try { const raw = await fetchJsonNoCache(GOOGLE_SCRIPT_URL+'?sheet=guru'); if(Array.isArray(raw)) box.textContent = 'rows='+raw.length; else if(raw && Array.isArray(raw.values)) box.textContent='rows='+raw.values.length; else box.textContent='ok'; } catch(e){ box.textContent='err'; } })();
})();
*/