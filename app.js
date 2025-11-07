// app.js — anti-absen ganda + disable dropdown Status bila sudah absen
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw1Hvqf8_pY8AoeI-MOzLHYQEX0hrlY9S7C07Wvmzzey_u4w5cAZpTVbAm1opzBTeMJ/exec";

let teachers = [];
let attendanceRecords = [];
let dailyChart = null;
let lastCounts = null;
let _submitMutex = false;

/* ===== Utils ===== */
const debounce = (fn, ms=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
function normalizeDate(v){ if(!v)return""; if(typeof v==="string"&&v.includes("T")){ const d=new Date(v); d.setHours(d.getHours()+7); return d.toISOString().split("T")[0]; }
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const d=new Date(v); return !isNaN(d)?d.toISOString().split("T")[0]:String(v).trim(); }
function normalizeName(s=""){ return s.toLowerCase().replace(/\s+/g," ").trim(); }
function escapeHtml(s=""){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function todayISO(){ return new Date().toISOString().split("T")[0]; }
function isTabActive(tab){ const el=document.getElementById(`content-${tab}`); return el? !el.classList.contains('hidden'): true; }
async function fetchJsonNoCache(url){ const sep=url.includes("?")?"&":"?"; const full=`${url}${sep}_ts=${Date.now()}`; const res=await fetch(full,{cache:"no-store",headers:{"cache-control":"no-cache","pragma":"no-cache"}}); return res.json(); }

/* ===== Avatar ===== */
const AVATAR_COLORS=["#1D4ED8","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#22C55E","#E11D48"];
function hashCode(str){let h=0;for(let i=0;i<str.length;i++){h=((h<<5)-h)+str.charCodeAt(i);h|=0;}return Math.abs(h);}
function nameToInitials(n=""){const p=n.trim().split(/\s+/);return ((p[0]?.[0]||"")+(p[1]?.[0]||"")).toUpperCase()||"?";}
function colorForName(n=""){return AVATAR_COLORS[hashCode(n)%AVATAR_COLORS.length];}
function renderNameWithAvatar(n=""){const init=nameToInitials(n),c=colorForName(n);return `<span class="name-cell"><span class="avatar" style="background-color:${c}">${init}</span><span>${escapeHtml(n)}</span></span>`;}

/* ===== Clock ===== */
function drawAnalogClock(){ const canvas=document.getElementById("analogClock"); if(!canvas)return; const ctx=canvas.getContext("2d"); const r=canvas.height/2; ctx.setTransform(1,0,0,1,0,0); ctx.translate(r,r);
  function face(){ctx.beginPath();ctx.arc(0,0,r*0.95,0,2*Math.PI);ctx.fillStyle="white";ctx.fill();ctx.strokeStyle="#1e3a8a";ctx.lineWidth=r*0.05;ctx.stroke();ctx.beginPath();ctx.arc(0,0,r*0.05,0,2*Math.PI);ctx.fillStyle="#1e3a8a";ctx.fill();}
  function nums(){ctx.font=r*0.15+"px Arial";ctx.textBaseline="middle";ctx.textAlign="center";for(let n=1;n<=12;n++){const ang=(n*Math.PI)/6;ctx.rotate(ang);ctx.translate(0,-r*0.85);ctx.rotate(-ang);ctx.fillText(n.toString(),0,0);ctx.rotate(ang);ctx.translate(0,r*0.85);ctx.rotate(-ang);}}
  function hand(pos,len,w,col){ctx.beginPath();ctx.lineWidth=w;ctx.lineCap="round";ctx.strokeStyle=col;ctx.moveTo(0,0);ctx.rotate(pos);ctx.lineTo(0,-len);ctx.stroke();ctx.rotate(-pos);}
  function time(){const now=new Date();const h=now.getHours()%12,m=now.getMinutes(),s=now.getSeconds();hand(((h*Math.PI)/6)+((m*Math.PI)/(6*60))+((s*Math.PI)/(360*60)),r*0.5,r*0.07,"#1e3a8a");hand(((m*Math.PI)/30)+((s*Math.PI)/(30*60)),r*0.8,r*0.05,"#2563eb");hand((s*Math.PI)/30,r*0.9,r*0.02,"#ef4444");}
  function draw(){ctx.clearRect(-r,-r,canvas.width,canvas.height);face();nums();time();} draw(); clearInterval(window._analogClockInterval); window._analogClockInterval=setInterval(draw,1000); }

/* ===== Data ===== */
async function loadTeachers(){ try{ const data=await fetchJsonNoCache(GOOGLE_SCRIPT_URL+"?sheet=guru");
  teachers=data.slice(1).map(r=>({nama_guru:r[0],nip:r[1],jabatan:r[2],status:r[3]}));
  if(document.getElementById('guru-list')) updateTeacherList();
  if(document.getElementById('nama-guru-kehadiran')) updateTeacherDropdown();
  document.dispatchEvent(new Event('teachers-updated'));
}catch(e){console.error("loadTeachers:",e);} }

async function loadAttendance(){ try{ const data=await fetchJsonNoCache(GOOGLE_SCRIPT_URL+"?sheet=kehadiran");
  attendanceRecords=data.slice(1).map(r=>({nama_guru:r[0],status:r[1],jam:r[2],tanggal:normalizeDate(r[3]),lokasi:r[4],foto_url:r[5]||""}));
  if(document.getElementById('attendance-list')) updateAttendanceToday();
  if(isTabActive('kehadiran')) updateChartDebounced();
  document.dispatchEvent(new Event('attendance-updated'));
}catch(e){console.error("loadAttendance:",e);} }

async function saveAttendance(d){ try{ await fetch(GOOGLE_SCRIPT_URL,{method:'POST',body:JSON.stringify({type:'attendance',data:d})}); }catch(e){console.error("saveAttendance:",e);} }

/* ===== UI ===== */
function updateTeacherList(){ const tbody=document.getElementById('guru-list'); if(!tbody)return;
  if(!teachers.length){ tbody.innerHTML=`<tr><td colspan="5" class="text-center p-4">Belum ada data</td></tr>`; return; }
  tbody.innerHTML=teachers.map((t,i)=>`
    <tr>
      <td class="border p-2">${renderNameWithAvatar(t.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(t.nip||"")}</td>
      <td class="border p-2">${escapeHtml(t.jabatan||"")}</td>
      <td class="border p-2">${escapeHtml(t.status||"")}</td>
      <td class="border p-2"><button onclick="editGuru(${i})" class="text-blue-700">Edit</button></td>
    </tr>`).join('');
}

function updateTeacherDropdown(){ const select=document.getElementById('nama-guru-kehadiran'); if(!select)return;
  select.innerHTML='<option value="">-- Pilih Guru --</option>';
  teachers.forEach(t=>{ const opt=document.createElement('option'); opt.textContent=t.nama_guru; opt.value=t.nama_guru; select.appendChild(opt); });
  attachAlreadyCheckedWarning(select);
}

function isToday(d){ if(!d)return false; const t=new Date(), x=new Date(d); return x.getDate()===t.getDate()&&x.getMonth()===t.getMonth()&&x.getFullYear()===t.getFullYear(); }

function updateAttendanceToday(){ const tbody=document.getElementById("attendance-list"); if(!tbody)return;
  const todayData=attendanceRecords.filter(r=>isToday(r.tanggal));
  if(!todayData.length){ tbody.innerHTML=`<tr><td colspan="5" class="text-center p-4">Belum ada kehadiran hari ini</td></tr>`; updateDuplicateNotice(); return; }
  tbody.innerHTML=todayData.map(r=>`
    <tr>
      <td class="border p-2">${renderNameWithAvatar(r.nama_guru)}</td>
      <td class="border p-2">${escapeHtml(r.status)}</td>
      <td class="border p-2">${escapeHtml(r.jam)}</td>
      <td class="border p-2">${escapeHtml(r.lokasi||"")}</td>
      <td class="border p-2">${escapeHtml(r.tanggal)}</td>
    </tr>`).join('');
  updateDuplicateNotice();
}

/* ===== Anti-duplikasi ===== */
function hasSubmittedTodayServerSide(name){ if(!name)return false; const who=normalizeName(name), t=todayISO(); return attendanceRecords.some(r=>normalizeDate(r.tanggal)===t && normalizeName(r.nama_guru)===who); }
function hasSubmittedTodayLocal(name){ if(!name)return false; return localStorage.getItem(`absen:${todayISO()}:${normalizeName(name)}`)==='1'; }
function markSubmittedLocal(name){ if(!name)return; localStorage.setItem(`absen:${todayISO()}:${normalizeName(name)}`,'1'); }

function attachAlreadyCheckedWarning(selectEl){
  if(!selectEl) return;
  const warn = document.getElementById('warn-sudah-absen');
  const btn  = document.querySelector('#attendance-form button[type="submit"]');
  const statusSel = document.getElementById('status-kehadiran');
  const statusInfo = document.getElementById('status-info');

  const update = ()=>{
    const nama = selectEl.value;
    const already = hasSubmittedTodayLocal(nama) || hasSubmittedTodayServerSide(nama);
    if(nama && already){
      if (warn) warn.innerHTML = '⚠️ <span class="text-yellow-700">Guru ini sudah mengisi kehadiran hari ini.</span>';
      if (btn){ btn.disabled = true; btn.classList.add('opacity-60','cursor-not-allowed'); }
      if (statusSel){ statusSel.disabled = true; statusSel.classList.add('opacity-60','cursor-not-allowed'); }
      if (statusInfo){ statusInfo.textContent = 'Status dinonaktifkan karena sudah absen hari ini.'; }
    }else{
      if (warn) warn.textContent = '';
      if (btn){ btn.disabled = false; btn.classList.remove('opacity-60','cursor-not-allowed'); }
      if (statusSel){ statusSel.disabled = false; statusSel.classList.remove('opacity-60','cursor-not-allowed'); }
      if (statusInfo){ statusInfo.textContent = 'Pilih salah satu: Hadir / Izin / Sakit / Dinas Luar.'; }
    }
  };
  selectEl.addEventListener('change', update);
  update();
}
function updateDuplicateNotice(){ const s=document.getElementById('nama-guru-kehadiran'); if(s) attachAlreadyCheckedWarning(s); }

/* ===== Chart (doughnut ringan) ===== */
function getTodayCounts(){ const t=todayISO(); const td=attendanceRecords.filter(r=>normalizeDate(r.tanggal)===t);
  const c={Hadir:0,Izin:0,Sakit:0,"Dinas Luar":0}; td.forEach(r=>{ if(c.hasOwnProperty(r.status)) c[r.status]++; });
  const h=document.getElementById('stat-hadir'); if(h){ document.getElementById('stat-hadir').textContent=c.Hadir; document.getElementById('stat-izin').textContent=c.Izin; document.getElementById('stat-sakit').textContent=c.Sakit; document.getElementById('stat-dl').textContent=c["Dinas Luar"]; }
  return c;
}
function sameCounts(a,b){ return !!a&&!!b&&a.Hadir===b.Hadir&&a.Izin===b.Izin&&a.Sakit===b.Sakit&&a["Dinas Luar"]===b["Dinas Luar"]; }
function ensureChart(){ const cvs=document.getElementById("dailyChart"); if(!cvs)return null; if(dailyChart)return dailyChart; const ctx=cvs.getContext("2d");
  dailyChart=new Chart(ctx,{type:"doughnut",data:{labels:["Hadir","Izin","Sakit","Dinas Luar"],datasets:[{data:[0,0,0,0],borderWidth:0}]},
  options:{responsive:true,maintainAspectRatio:false,devicePixelRatio:1,cutout:"62%",animation:false,events:[],plugins:{legend:{position:"bottom",labels:{boxWidth:12}},tooltip:{enabled:true}}}}); return dailyChart; }
const updateChartDebounced=debounce(updateChart,120);
function updateChart(){ const c=ensureChart(); if(!c)return; const counts=getTodayCounts(); if(sameCounts(counts,lastCounts))return; c.data.datasets[0].data=[counts.Hadir,counts.Izin,counts.Sakit,counts["Dinas Luar"]]; lastCounts=counts; c.update('none'); }

/* ===== Laporan/CSV/GPS (tanpa perubahan logika) ===== */
function generateMonthlyReport(){ /* sama seperti versi sebelumnya */ }
function downloadMonthlyReport(){ /* sama seperti versi sebelumnya */ }
function getLocation(){ const el=document.getElementById('keterangan-lokasi'); if(!el)return;
  if(!navigator.geolocation){ el.value="Browser tidak mendukung GPS"; return; }
  navigator.geolocation.getCurrentPosition(async pos=>{ const {latitude:lat,longitude:lon}=pos.coords;
    try{ const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`); const data=await res.json(); el.value=data.display_name||`${lat}, ${lon}`; }
    catch(e){ el.value=`${lat}, ${lon}`; }
  },()=>{ el.value="Gagal mengambil lokasi"; });
}

/* ===== Events ===== */
document.addEventListener('submit', async (e)=>{
  if(!e.target) return;
  if(e.target.id==='attendance-form'){
    e.preventDefault();
    if(_submitMutex) return; _submitMutex=true;
    const btn=e.target.querySelector('button[type="submit"]');
    const statusSel=document.getElementById('status-kehadiran');
    const nama=document.getElementById('nama-guru-kehadiran').value;

    if(hasSubmittedTodayLocal(nama)){ alert('⚠️ Guru ini sudah absen hari ini (lokal).'); _submitMutex=false; return; }

    await loadAttendance(); // no-cache
    if(hasSubmittedTodayServerSide(nama)){ alert('⚠️ Guru ini sudah absen hari ini.'); updateDuplicateNotice(); _submitMutex=false; return; }

    const now=new Date();
    const data={ nama_guru:nama, status:document.getElementById('status-kehadiran').value,
      jam_hadir:now.toLocaleTimeString('id-ID'), tanggal:todayISO(), keterangan_lokasi:document.getElementById('keterangan-lokasi').value||'' };

    const overlay=document.createElement('div');
    overlay.id='loading-msg'; overlay.className='fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50';
    overlay.innerHTML=`<div class="bg-white p-6 rounded-lg shadow-lg text-center"><p class="text-blue-700 font-semibold">⏳ Menyimpan...</p></div>`;
    document.body.appendChild(overlay);
    if(btn){ btn.disabled=true; btn.classList.add('opacity-60','cursor-not-allowed'); }
    if(statusSel){ statusSel.disabled=true; statusSel.classList.add('opacity-60','cursor-not-allowed'); }

    await saveAttendance(data);

    // kunci lokal + tambahkan ke memori agar langsung terblok
    markSubmittedLocal(nama);
    attendanceRecords.push({ nama_guru:data.nama_guru, status:data.status, jam:data.jam_hadir, tanggal:data.tanggal, lokasi:data.keterangan_lokasi });

    setTimeout(async ()=>{
      await loadAttendance();
      document.getElementById('loading-msg')?.remove();
      if(btn){ btn.disabled=false; btn.classList.remove('opacity-60','cursor-not-allowed'); }
      updateDuplicateNotice();
      _submitMutex=false;
    }, 600);

    e.target.reset();
  }
});

/* ===== Dashboard helper (tetap) ===== */
window.editGuru=function(i){ const g=teachers[i]; document.getElementById('nama-guru').value=g.nama_guru;
  document.getElementById('nip-guru').value=g.nip; document.getElementById('jabatan-guru').value=g.jabatan; document.getElementById('status-kepegawaian').value=g.status;
  if(typeof switchTab==='function') switchTab('guru'); };

async function loadDashboard(){ await loadTeachers(); await loadAttendance();
  const tg=document.getElementById('totalGuru'), h=document.getElementById('hadirHariIni'), th=document.getElementById('tidakHadirHariIni'), tbl=document.getElementById('tabelGuru');
  if(tg) tg.textContent=teachers.length;
  const t=todayISO(); const hariIni=attendanceRecords.filter(r=>r.tanggal&&normalizeDate(r.tanggal)===t);
  const hadir=hariIni.filter(r=>r.status==='Hadir').length; const notHadir=hariIni.length-hadir;
  if(h) h.textContent=hadir; if(th) th.textContent=notHadir;
  if(tbl){ tbl.innerHTML=teachers.map(t=>`<tr><td class="border p-2">${renderNameWithAvatar(t.nama_guru)}</td><td class="border p-2">${escapeHtml(t.nip||"")}</td><td class="border p-2">${escapeHtml(t.jabatan||"")}</td><td class="border p-2">${escapeHtml(t.status||"")}</td></tr>`).join(''); }
  const cvs=document.getElementById('chartKehadiran'); if(cvs){ if(window._dashChart&&window._dashChart.destroy) window._dashChart.destroy();
    const counts={Hadir:0,Izin:0,Sakit:0,"Dinas Luar":0}; hariIni.forEach(r=>{ if(counts.hasOwnProperty(r.status)) counts[r.status]++; });
    window._dashChart=new Chart(cvs.getContext('2d'),{type:'doughnut',data:{labels:["Hadir","Izin","Sakit","Dinas Luar"],datasets:[{data:[counts.Hadir,counts.Izin,counts.Sakit,counts["Dinas Luar"]],borderWidth:0}]},
      options:{responsive:true,devicePixelRatio:1,cutout:"62%",animation:false,events:[],plugins:{legend:{position:'bottom'}}}});
  }
}

/* ===== Init ===== */
window.switchTab=function(tab){ document.querySelectorAll('section[id^="content-"]').forEach(el=>el.classList.add('hidden'));
  document.querySelectorAll('nav button').forEach(el=>el.classList.remove('tab-active'));
  const c=document.getElementById(`content-${tab}`), b=document.getElementById(`tab-${tab}`); if(c)c.classList.remove('hidden'); if(b)b.classList.add('tab-active'); if(tab==='kehadiran') updateChartDebounced(); };

window.addEventListener('load', async ()=>{
  const cd=document.getElementById('current-date'); if(cd) cd.textContent=new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  drawAnalogClock(); try{ getLocation(); }catch(e){}
  await loadTeachers(); await loadAttendance();
  setInterval(async ()=>{ await loadAttendance(); }, 60000);
});