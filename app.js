/* ==========================================================
   McE. Check-in — เช็คอิน/เช็คเอาท์หน้างานด้วย GPS จริง
   ข้อมูลทั้งหมดเก็บใน localStorage ของเครื่องผู้ใช้
   ========================================================== */
(function () {
"use strict";

var VER = "1.0.0";
var KEY = "mce-checkin-v1";
var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
var esc = function (s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
};
var hm = function (ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
var TH_M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
var dmy = function (ts) { var d = new Date(ts); return d.getDate() + " " + TH_M[d.getMonth()] + " " + String(d.getFullYear() + 543).slice(2); };
var dayKey = function (ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };

/* ---------------- state ---------------- */
var S = {
  emps: [],       // {id,name,code,role}
  sites: [],      // {id,name,lat,lng,radius,note}
  jobs: [],       // {id,code,cust,title,siteId,empId,date,win,status,note}
  logs: [],       // {id,ts,type,empId,siteId,jobId,lat,lng,acc,dist}
  meId: null,
  siteId: null,
  jobId: null,
  cfg: { fence: 100, strict: true, shift: "08:00" }
};

function load() {
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var o = JSON.parse(raw);
      ["emps", "sites", "jobs", "logs"].forEach(function (k) { if (Array.isArray(o[k])) S[k] = o[k]; });
      if (o.meId) S.meId = o.meId;
      if (o.siteId) S.siteId = o.siteId;
      if (o.jobId) S.jobId = o.jobId;
      if (o.cfg) S.cfg = Object.assign(S.cfg, o.cfg);
    }
  } catch (e) { /* เริ่มใหม่ถ้าข้อมูลเสีย */ }
}
var saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(function () {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast("บันทึกไม่สำเร็จ — พื้นที่เก็บข้อมูลเต็ม"); }
  }, 60);
}

var byId = function (arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; };
var me   = function () { return byId(S.emps, S.meId); };
var site = function () { return byId(S.sites, S.siteId); };
var job  = function () { return byId(S.jobs, S.jobId); };

/* ---------------- toast ---------------- */
var tT;
function toast(m) {
  var el = $("#toast");
  el.textContent = m;
  el.classList.add("on");
  clearTimeout(tT);
  tT = setTimeout(function () { el.classList.remove("on"); }, 2800);
}

/* ---------------- geo ---------------- */
var R = 6371000;
function haversine(a1, o1, a2, o2) {
  var t = Math.PI / 180;
  var dLat = (a2 - a1) * t, dLon = (o2 - o1) * t;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

var pos = null;      // GeolocationPosition ล่าสุด
var geoErr = null;   // ข้อความ error ล่าสุด
var watchId = null;

function startGeo() {
  if (!("geolocation" in navigator)) {
    geoErr = "อุปกรณ์นี้ไม่รองรับ GPS";
    paint(); return;
  }
  // ถือว่าไม่ปลอดภัยเฉพาะกรณีที่ยืนยันได้จริง (เปิดไฟล์ตรง ๆ หรือ http จากเครื่องอื่น)
  var local = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "";
  var insecure = location.protocol === "file:" || (location.protocol === "http:" && !local);
  if (insecure) {
    geoErr = "ต้องเปิดผ่าน HTTPS เบราว์เซอร์จึงจะให้ใช้ตำแหน่ง (เช่น ลิงก์ GitHub Pages)";
    paint(); return;
  }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    function (p) { pos = p; geoErr = null; paint(); },
    function (e) {
      geoErr = e.code === 1 ? "ถูกปฏิเสธสิทธิ์ตำแหน่ง — เปิดให้แอปนี้ใช้ตำแหน่งในตั้งค่าเบราว์เซอร์"
             : e.code === 2 ? "หาสัญญาณ GPS ไม่พบ ลองออกไปที่โล่ง"
             : "อ่านตำแหน่งไม่ทันเวลา ลองกดอ่านใหม่";
      paint();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

/* ระยะห่างจากจุดลงเวลาที่เลือก (เมตร) หรือ null */
function distNow() {
  var s = site();
  if (!pos || !s || typeof s.lat !== "number") return null;
  return haversine(pos.coords.latitude, pos.coords.longitude, s.lat, s.lng);
}
function fenceOf(s) { return (s && s.radius) || S.cfg.fence; }
function inFence() {
  var d = distNow(), s = site();
  if (d === null || !s) return false;
  return d <= fenceOf(s);
}
function fmtDist(d) {
  if (d === null) return ["—", "ม."];
  if (d < 1000) return [d < 10 ? d.toFixed(1) : Math.round(d).toString(), "ม."];
  return [(d / 1000).toFixed(2), "กม."];
}

/* ---------------- paint: หน้าลงเวลา ---------------- */
function paint() {
  var s = site(), j = job(), d = distNow(), card = $("#gpsCard");

  $("#tbWho").textContent = me() ? (me().name + " · " + (me().code || "—")) : "แตะไอคอนขวาบนเพื่อเลือกผู้ใช้";
  $("#pkSite").textContent = s ? s.name : (S.sites.length ? "ยังไม่ได้เลือก" : "ยังไม่มีไซต์ — เพิ่มในแท็บตั้งค่า");
  $("#pkJob").textContent  = j ? (j.code + " · " + j.cust) : "ไม่ผูกใบงาน";

  card.className = "gps";
  if (geoErr) {
    card.classList.add("off");
    $("#gpsState").textContent = "ตำแหน่งใช้งานไม่ได้";
    $("#gpsSub").textContent = geoErr;
  } else if (!pos) {
    card.classList.add("off");
    $("#gpsState").textContent = "กำลังอ่านตำแหน่ง…";
    $("#gpsSub").textContent = "อนุญาตให้เบราว์เซอร์ใช้ตำแหน่งเมื่อมีข้อความถาม";
  } else if (!s || typeof s.lat !== "number") {
    $("#gpsState").textContent = "ยังไม่ได้ตั้งพิกัดไซต์";
    $("#gpsSub").textContent = "เลือกหรือเพิ่มไซต์ที่มีพิกัดก่อน";
  } else {
    var near = d <= fenceOf(s);
    card.classList.add(near ? "near" : "far");
    $("#gpsState").textContent = near ? "อยู่ในพื้นที่ไซต์" : "อยู่นอกพื้นที่ไซต์";
    $("#gpsSub").textContent = "จาก " + s.name + " · รั้วพิกัด " + fenceOf(s) + " ม.";
  }

  var f = fmtDist(d);
  $("#gpsDist").textContent = f[0];
  $("#gpsUnit").textContent = f[1];

  if (pos) {
    $("#gLat").textContent = pos.coords.latitude.toFixed(6);
    $("#gLng").textContent = pos.coords.longitude.toFixed(6);
    $("#gAcc").textContent = "±" + Math.round(pos.coords.accuracy) + " ม.";
    $("#gAge").textContent = hm(pos.timestamp);
  } else {
    $("#gLat").textContent = $("#gLng").textContent = $("#gAcc").textContent = $("#gAge").textContent = "—";
  }

  drawRadar(d);

  /* คำเตือน */
  var w = $("#warn"), msg = "", bad = false;
  if (!me()) { msg = "<b>ยังไม่ได้เลือกว่าคุณคือใคร</b> — แตะไอคอนคนขวาบน หรือเพิ่มชื่อในแท็บตั้งค่า"; bad = true; }
  else if (!s) { msg = "<b>ยังไม่ได้เลือกจุดลงเวลา</b> — แตะแถบ “จุดลงเวลา” ด้านบน"; bad = true; }
  else if (geoErr) { msg = "<b>" + esc(geoErr) + "</b>"; bad = true; }
  else if (pos && pos.coords.accuracy > 60) { msg = "สัญญาณ GPS ยังหยาบ (±" + Math.round(pos.coords.accuracy) + " ม.) รอสักครู่ให้แม่นขึ้นก่อนกด"; }
  else if (d !== null && d > fenceOf(s)) {
    msg = "อยู่ห่างจุดลงเวลา <b>" + fmtDist(d).join(" ") + "</b> (รั้ว " + fenceOf(s) + " ม.)" +
          (S.cfg.strict ? " — เดินเข้าใกล้ก่อนจึงจะกดได้" : " — จะบันทึกว่าอยู่นอกพื้นที่");
    bad = true;
  }
  w.innerHTML = msg;
  w.hidden = !msg;
  w.className = "warn" + (bad ? " bad" : "");

  /* ปุ่ม */
  var t = todayLogs();
  var ready = !!me() && !!s && !!pos && !geoErr && (!S.cfg.strict || inFence());
  $("#inBtn").disabled  = !ready || !!t.inLog;
  $("#outBtn").disabled = !ready || !t.inLog || !!t.outLog;
  $("#inBtn").textContent = t.inLog ? "เช็คอินแล้ว" : "เช็คอิน";
  $("#outBtn").textContent = t.outLog ? "เช็คเอาท์แล้ว" : "เช็คเอาท์";

  /* สรุปวันนี้ */
  $("#tIn").textContent = t.inLog ? hm(t.inLog.ts) : "—";
  $("#tIn").className = "rv" + (t.inLog ? " set" : "");
  $("#tInS").textContent = t.inLog ? (siteName(t.inLog.siteId) + " · ห่าง " + Math.round(t.inLog.dist) + " ม.") : "ยังไม่เช็คอิน";
  $("#tOut").textContent = t.outLog ? hm(t.outLog.ts) : "—";
  $("#tOut").className = "rv" + (t.outLog ? " set" : "");
  $("#tOutS").textContent = t.outLog ? (siteName(t.outLog.siteId) + " · ห่าง " + Math.round(t.outLog.dist) + " ม.") : "ยังไม่เช็คเอาท์";
  var hrs = (t.inLog && t.outLog) ? (t.outLog.ts - t.inLog.ts) / 3600000 : 0;
  $("#tHrs").textContent = hrs.toFixed(1) + " ชม.";
}

function siteName(id) { var s = byId(S.sites, id); return s ? s.name : "—"; }
function empName(id) { var e = byId(S.emps, id); return e ? e.name : "—"; }

function todayLogs() {
  var k = dayKey(Date.now()), inL = null, outL = null;
  S.logs.forEach(function (l) {
    if (l.empId !== S.meId || dayKey(l.ts) !== k) return;
    if (l.type === "in" && (!inL || l.ts < inL.ts)) inL = l;
    if (l.type === "out" && (!outL || l.ts > outL.ts)) outL = l;
  });
  return { inLog: inL, outLog: outL };
}

/* ---------------- radar ---------------- */
function drawRadar(d) {
  var box = $("#radar"), s = site();
  if (!pos || !s || typeof s.lat !== "number") {
    box.innerHTML = '<div class="none">' +
      (geoErr ? esc(geoErr) : !s ? "เลือกไซต์เพื่อดูระยะห่าง" : "กำลังรอสัญญาณ GPS…") + "</div>";
    return;
  }
  var fence = fenceOf(s);
  var span = Math.max(fence * 2.4, d * 1.5, 40);   // เมตรจากกึ่งกลางถึงขอบ
  var H = box.clientHeight || 132, W = box.clientWidth || 300;
  var pxPerM = Math.min(W, H) / 2 / span;

  var t = Math.PI / 180;
  var dy = (pos.coords.latitude - s.lat) * 111320;
  var dx = (pos.coords.longitude - s.lng) * 111320 * Math.cos(s.lat * t);
  var mx = W / 2 + dx * pxPerM;
  var my = H / 2 - dy * pxPerM;
  mx = Math.max(9, Math.min(W - 9, mx));
  my = Math.max(9, Math.min(H - 9, my));

  var fr = fence * pxPerM * 2;
  var ar = pos.coords.accuracy * pxPerM * 2;
  box.innerHTML =
    '<div class="ring" style="width:' + (span * pxPerM * 2) + 'px;height:' + (span * pxPerM * 2) + 'px"></div>' +
    '<div class="ring fence" style="width:' + fr + 'px;height:' + fr + 'px"></div>' +
    '<div class="site"></div>' +
    (ar > 10 ? '<div class="ring" style="width:' + ar + 'px;height:' + ar + 'px;left:' + mx + 'px;top:' + my +
               'px;border-color:rgba(255,255,255,.5)"></div>' : "") +
    '<div class="me" style="left:' + mx + 'px;top:' + my + 'px"></div>' +
    '<div class="scale">รัศมีภาพ ' + Math.round(span) + ' ม.</div>';
}

/* ---------------- punch ---------------- */
function punch(type) {
  var s = site(), m = me();
  if (!s || !m || !pos) return;
  var d = distNow();
  if (S.cfg.strict && d > fenceOf(s)) { toast("อยู่นอกรั้วพิกัด กดไม่ได้"); return; }

  var log = {
    id: uid(), ts: Date.now(), type: type,
    empId: m.id, siteId: s.id, jobId: S.jobId || null,
    lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6),
    acc: Math.round(pos.coords.accuracy), dist: Math.round(d),
    outside: d > fenceOf(s)
  };
  S.logs.unshift(log);

  var j = job();
  if (j) {
    if (type === "in" && j.status === "todo") { j.status = "doing"; j.inTs = log.ts; }
    if (type === "out" && j.status === "doing") { j.status = "done"; j.outTs = log.ts; }
  }
  save(); paint(); renderJobs(); renderLog();

  var late = "";
  if (type === "in" && S.cfg.shift) {
    var p = S.cfg.shift.split(":");
    var due = new Date(); due.setHours(+p[0], +p[1], 0, 0);
    var mins = Math.round((log.ts - due.getTime()) / 60000);
    late = mins > 0 ? " · สาย " + mins + " นาที" : " · ตรงเวลา";
  }
  toast((type === "in" ? "เช็คอิน " : "เช็คเอาท์ ") + hm(log.ts) + " ที่ " + s.name + late);
}

/* ---------------- jobs ---------------- */
var jobFilter = "open";
function renderJobs() {
  var box = $("#jobList");
  var list = S.jobs.filter(function (j) {
    if (jobFilter === "open") return j.status !== "done";
    if (jobFilter === "done") return j.status === "done";
    return true;
  });
  list.sort(function (a, b) { return (a.date || "").localeCompare(b.date || "") || (a.win || "").localeCompare(b.win || ""); });

  if (!list.length) {
    box.innerHTML = '<div class="empty">ยังไม่มีใบงานในกลุ่มนี้<br>แตะปุ่ม ＋ มุมขวาบนเพื่อสร้างใบงานแรก</div>';
    return;
  }
  var ST = { todo: ["w", "ยังไม่เริ่ม"], doing: ["o", "กำลังทำ"], done: ["g", "ปิดแล้ว"] };
  box.innerHTML = list.map(function (j) {
    var st = ST[j.status] || ST.todo;
    var sel = j.id === S.jobId;
    return '<div class="item' + (j.status === "done" ? " done" : "") + (sel ? " cur" : "") + '" data-job="' + j.id + '">' +
      '<div class="it-top"><div class="it-g">' +
        '<div class="it-1">' + esc(j.cust) + "</div>" +
        '<div class="it-2">' + esc(j.title) + "</div>" +
      "</div>" +
      '<span class="tag ' + st[0] + '">' + st[1] + "</span></div>" +
      '<div class="it-3"><span>' + esc(j.code) + "</span>" +
        (j.date ? "<span>" + esc(j.date) + (j.win ? " " + esc(j.win) : "") + "</span>" : "") +
        "<span>" + esc(siteName(j.siteId)) + "</span>" +
        (j.empId ? "<span>" + esc(empName(j.empId)) + "</span>" : "") +
        (j.inTs ? "<span>เข้า " + hm(j.inTs) + (j.outTs ? " – ออก " + hm(j.outTs) : "") + "</span>" : "") +
      "</div>" +
      '<div class="it-act">' +
        '<button class="' + (sel ? "s" : "p") + '" data-use="' + j.id + '">' + (sel ? "กำลังใช้ใบงานนี้" : "ใช้ใบงานนี้") + "</button>" +
        '<button data-edit="' + j.id + '">แก้ไข</button>' +
      "</div></div>";
  }).join("");

  $$("[data-use]", box).forEach(function (b) {
    b.addEventListener("click", function () {
      var j = byId(S.jobs, b.dataset.use);
      S.jobId = (S.jobId === j.id) ? null : j.id;
      if (S.jobId && j.siteId) S.siteId = j.siteId;
      save(); renderJobs(); paint();
      toast(S.jobId ? ("ผูกกับใบงาน " + j.code) : "ยกเลิกการผูกใบงาน");
      if (S.jobId) go("clock");
    });
  });
  $$("[data-edit]", box).forEach(function (b) {
    b.addEventListener("click", function () { jobForm(byId(S.jobs, b.dataset.edit)); });
  });
}

/* ---------------- history ---------------- */
function renderLog() {
  var box = $("#logList");
  $("#logCount").textContent = S.logs.length + " รายการ";
  if (!S.logs.length) {
    box.innerHTML = '<div class="empty">ยังไม่มีประวัติการลงเวลา</div>';
    return;
  }
  box.innerHTML = S.logs.slice(0, 200).map(function (l) {
    return '<div class="row">' +
      '<div class="ic ' + l.type + '">' + (l.type === "in" ? "IN" : "OUT") + "</div>" +
      '<div class="g"><div class="r1">' + esc(empName(l.empId)) + " · " + esc(siteName(l.siteId)) + "</div>" +
      '<div class="r2">' + dmy(l.ts) + " " + hm(l.ts) + " · ห่าง " + l.dist + " ม. · ±" + l.acc + " ม." +
        (l.outside ? " · นอกพื้นที่" : "") + (l.jobId && byId(S.jobs, l.jobId) ? " · " + esc(byId(S.jobs, l.jobId).code) : "") +
      "</div></div>" +
      '<button class="mini d" data-del="' + l.id + '">ลบ</button></div>';
  }).join("");
  $$("[data-del]", box).forEach(function (b) {
    b.addEventListener("click", function () {
      if (!confirm("ลบรายการนี้?")) return;
      S.logs = S.logs.filter(function (x) { return x.id !== b.dataset.del; });
      save(); renderLog(); paint();
    });
  });
}

function csv() {
  if (!S.logs.length) { toast("ยังไม่มีข้อมูลให้ส่งออก"); return; }
  var head = ["วันที่", "เวลา", "ประเภท", "พนักงาน", "รหัส", "ไซต์", "ใบงาน", "ละติจูด", "ลองจิจูด", "ระยะห่าง(ม.)", "ความแม่นยำ(ม.)", "นอกพื้นที่"];
  var rows = S.logs.slice().sort(function (a, b) { return a.ts - b.ts; }).map(function (l) {
    var e = byId(S.emps, l.empId), j = byId(S.jobs, l.jobId);
    var d = new Date(l.ts);
    return [
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
      pad(d.getHours()) + ":" + pad(d.getMinutes()),
      l.type === "in" ? "เข้างาน" : "ออกงาน",
      e ? e.name : "", e ? (e.code || "") : "",
      siteName(l.siteId), j ? j.code : "",
      l.lat, l.lng, l.dist, l.acc, l.outside ? "ใช่" : ""
    ];
  });
  var body = [head].concat(rows).map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\r\n");
  download("mce-checkin-" + dayKey(Date.now()) + ".csv", "﻿" + body, "text/csv;charset=utf-8");
  toast("ส่งออก " + rows.length + " รายการแล้ว");
}
function download(name, text, mime) {
  var b = new Blob([text], { type: mime || "application/json" });
  var u = URL.createObjectURL(b), a = document.createElement("a");
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 800);
}

/* ---------------- setup lists ---------------- */
function renderEmps() {
  var box = $("#empList");
  if (!S.emps.length) { box.innerHTML = '<div class="empty">ยังไม่มีพนักงาน — แตะ “＋ เพิ่มชื่อ”</div>'; return; }
  box.innerHTML = S.emps.map(function (e) {
    return '<div class="row">' +
      '<div class="av' + (e.id === S.meId ? " me" : "") + '">' + esc(e.name.trim().charAt(0) || "?") + "</div>" +
      '<div class="g"><div class="r1">' + esc(e.name) + (e.id === S.meId ? " · คุณ" : "") + "</div>" +
      '<div class="r2">' + esc(e.code || "—") + (e.role ? " · " + esc(e.role) : "") + "</div></div>" +
      '<button class="mini" data-be="' + e.id + '">แก้ไข</button>' +
      '<button class="mini d" data-de="' + e.id + '">ลบ</button></div>';
  }).join("");
  $$("[data-be]", box).forEach(function (b) { b.addEventListener("click", function () { empForm(byId(S.emps, b.dataset.be)); }); });
  $$("[data-de]", box).forEach(function (b) {
    b.addEventListener("click", function () {
      var e = byId(S.emps, b.dataset.de);
      if (!confirm("ลบ " + e.name + " ? ประวัติการลงเวลาเดิมจะยังอยู่")) return;
      S.emps = S.emps.filter(function (x) { return x.id !== e.id; });
      if (S.meId === e.id) S.meId = S.emps.length ? S.emps[0].id : null;
      save(); renderEmps(); paint();
    });
  });
}

function renderSites() {
  var box = $("#siteList");
  if (!S.sites.length) { box.innerHTML = '<div class="empty">ยังไม่มีไซต์ — แตะ “＋ เพิ่มไซต์” แล้วกด “ใช้ตำแหน่งปัจจุบัน”</div>'; return; }
  box.innerHTML = S.sites.map(function (s) {
    var d = pos && typeof s.lat === "number"
      ? haversine(pos.coords.latitude, pos.coords.longitude, s.lat, s.lng) : null;
    return '<div class="row">' +
      '<div class="ic" style="background:' + (s.id === S.siteId ? "var(--lim)" : "var(--card)") + '">' +
        (typeof s.lat === "number" ? "📍" : "?") + "</div>" +
      '<div class="g"><div class="r1">' + esc(s.name) + "</div>" +
      '<div class="r2">' + (typeof s.lat === "number" ? s.lat.toFixed(5) + ", " + s.lng.toFixed(5) : "ยังไม่มีพิกัด") +
        " · รั้ว " + (s.radius || S.cfg.fence) + " ม." + (d !== null ? " · ห่าง " + fmtDist(d).join(" ") : "") + "</div></div>" +
      '<button class="mini" data-bs="' + s.id + '">แก้ไข</button>' +
      '<button class="mini d" data-ds="' + s.id + '">ลบ</button></div>';
  }).join("");
  $$("[data-bs]", box).forEach(function (b) { b.addEventListener("click", function () { siteForm(byId(S.sites, b.dataset.bs)); }); });
  $$("[data-ds]", box).forEach(function (b) {
    b.addEventListener("click", function () {
      var s = byId(S.sites, b.dataset.ds);
      if (!confirm("ลบไซต์ " + s.name + " ?")) return;
      S.sites = S.sites.filter(function (x) { return x.id !== s.id; });
      if (S.siteId === s.id) S.siteId = S.sites.length ? S.sites[0].id : null;
      save(); renderSites(); paint();
    });
  });
}

/* ---------------- sheet ---------------- */
function sheet(title, html, after) {
  $("#ovT").textContent = title;
  $("#ovB").innerHTML = html;
  $("#ov").hidden = false;
  if (after) after($("#ovB"));
}
function closeSheet() { $("#ov").hidden = true; }
function focusSoon(sel) {
  setTimeout(function () { var el = $(sel); if (el && !$("#ov").hidden) { try { el.focus(); } catch (e) {} } }, 120);
}
$$("[data-close]").forEach(function (b) { b.addEventListener("click", closeSheet); });

function optionsFor(arr, sel, blank) {
  var h = blank ? '<option value="">' + blank + "</option>" : "";
  return h + arr.map(function (x) {
    return '<option value="' + x.id + '"' + (x.id === sel ? " selected" : "") + ">" + esc(x.name) + "</option>";
  }).join("");
}

/* ---- employee form ---- */
function empForm(e) {
  var isNew = !e;
  e = e || { id: uid(), name: "", code: "", role: "" };
  sheet(isNew ? "เพิ่มพนักงาน" : "แก้ไขพนักงาน",
    '<div class="f"><label for="eN">ชื่อ–สกุล</label><input id="eN" value="' + esc(e.name) + '" placeholder="เช่น เอกรินทร์ วงศ์สถาพร" autocomplete="off"></div>' +
    '<div class="two"><div class="f"><label for="eC">รหัสพนักงาน</label><input id="eC" value="' + esc(e.code) + '" placeholder="MCE-002" autocomplete="off"></div>' +
    '<div class="f"><label for="eR">ตำแหน่ง</label><input id="eR" value="' + esc(e.role) + '" placeholder="ช่างเทคนิค" autocomplete="off"></div></div>' +
    '<button class="big org" id="eSave">' + (isNew ? "เพิ่มพนักงาน" : "บันทึก") + "</button>" +
    (isNew ? "" : '<button class="ghost" id="eMe" style="margin-top:10px">ตั้งเป็น “ฉัน”</button>'),
    function () {
      $("#eSave").addEventListener("click", function () {
        var n = $("#eN").value.trim();
        if (!n) { toast("ใส่ชื่อก่อน"); $("#eN").focus(); return; }
        e.name = n; e.code = $("#eC").value.trim(); e.role = $("#eR").value.trim();
        if (isNew) { S.emps.push(e); if (!S.meId) S.meId = e.id; }
        save(); renderEmps(); paint(); closeSheet();
        toast(isNew ? "เพิ่ม " + n + " แล้ว" : "บันทึกแล้ว");
      });
      var mb = $("#eMe");
      if (mb) mb.addEventListener("click", function () {
        S.meId = e.id; save(); renderEmps(); paint(); closeSheet(); toast("สลับเป็น " + e.name);
      });
      focusSoon("#eN");
    });
}

/* ---- site form ---- */
function siteForm(s) {
  var isNew = !s;
  s = s || { id: uid(), name: "", lat: null, lng: null, radius: S.cfg.fence, note: "" };
  sheet(isNew ? "เพิ่มไซต์งาน" : "แก้ไขไซต์งาน",
    '<div class="f"><label for="sN">ชื่อไซต์ / จุดลงเวลา</label><input id="sN" value="' + esc(s.name) + '" placeholder="เช่น McEnergy สำนักงานใหญ่" autocomplete="off"></div>' +
    '<button class="big lim" id="sHere">ใช้ตำแหน่งปัจจุบันเป็นพิกัดไซต์</button>' +
    '<div class="two" style="margin-top:13px"><div class="f"><label for="sLat">ละติจูด</label><input id="sLat" inputmode="decimal" value="' + (s.lat == null ? "" : s.lat) + '" placeholder="13.7563"></div>' +
    '<div class="f"><label for="sLng">ลองจิจูด</label><input id="sLng" inputmode="decimal" value="' + (s.lng == null ? "" : s.lng) + '" placeholder="100.5018"></div></div>' +
    '<div class="f"><label for="sR">รัศมีรั้วพิกัด (เมตร)</label><input type="number" id="sR" min="10" max="5000" step="10" value="' + (s.radius || S.cfg.fence) + '">' +
    '<div class="hint">ยิ่งรัศมีเล็ก ยิ่งเข้มงวด แต่ถ้าสัญญาณ GPS หยาบจะกดไม่ผ่าน แนะนำ 80–150 ม. สำหรับเดโม</div></div>' +
    '<button class="big org" id="sSave">' + (isNew ? "เพิ่มไซต์" : "บันทึก") + "</button>",
    function () {
      $("#sHere").addEventListener("click", function () {
        if (!pos) { toast(geoErr || "ยังไม่ได้พิกัด รอสัญญาณสักครู่"); return; }
        $("#sLat").value = pos.coords.latitude.toFixed(6);
        $("#sLng").value = pos.coords.longitude.toFixed(6);
        toast("ใส่พิกัดปัจจุบันแล้ว (±" + Math.round(pos.coords.accuracy) + " ม.)");
      });
      $("#sSave").addEventListener("click", function () {
        var n = $("#sN").value.trim();
        if (!n) { toast("ใส่ชื่อไซต์ก่อน"); $("#sN").focus(); return; }
        var la = parseFloat($("#sLat").value), ln = parseFloat($("#sLng").value);
        if (isNaN(la) || isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) { toast("พิกัดไม่ถูกต้อง"); return; }
        s.name = n; s.lat = la; s.lng = ln;
        s.radius = Math.max(10, parseInt($("#sR").value, 10) || S.cfg.fence);
        if (isNew) { S.sites.push(s); if (!S.siteId) S.siteId = s.id; }
        save(); renderSites(); paint(); closeSheet();
        toast(isNew ? "เพิ่มไซต์ " + n + " แล้ว" : "บันทึกแล้ว");
      });
      focusSoon("#sN");
    });
}

/* ---- job form ---- */
function jobForm(j) {
  var isNew = !j;
  var d = new Date();
  var today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  j = j || { id: uid(), code: "WO-" + String(Date.now()).slice(-5), cust: "", title: "", siteId: S.siteId, empId: S.meId, date: today, win: "09:00", status: "todo", note: "" };
  sheet(isNew ? "สร้างใบสั่งงาน" : "แก้ไขใบสั่งงาน",
    '<div class="two"><div class="f"><label for="jC">เลขที่ใบงาน</label><input id="jC" value="' + esc(j.code) + '" autocomplete="off"></div>' +
    '<div class="f"><label for="jS">สถานะ</label><select id="jS">' +
      ['todo|ยังไม่เริ่ม', 'doing|กำลังทำ', 'done|ปิดแล้ว'].map(function (o) {
        var p = o.split("|"); return '<option value="' + p[0] + '"' + (j.status === p[0] ? " selected" : "") + ">" + p[1] + "</option>";
      }).join("") + "</select></div></div>" +
    '<div class="f"><label for="jCu">ลูกค้า / หน่วยงาน</label><input id="jCu" value="' + esc(j.cust) + '" placeholder="เช่น บจก. ไบโอเทค" autocomplete="off"></div>' +
    '<div class="f"><label for="jT">งานที่ต้องทำ</label><input id="jT" value="' + esc(j.title) + '" placeholder="เช่น ตรวจระบบไฟฟ้าประจำปี ตู้ MDB" autocomplete="off"></div>' +
    '<div class="f"><label for="jSi">ไซต์ / จุดลงเวลา</label><select id="jSi">' + optionsFor(S.sites, j.siteId, "— ไม่ระบุ —") + "</select></div>" +
    '<div class="f"><label for="jE">ผู้รับผิดชอบ</label><select id="jE">' + optionsFor(S.emps, j.empId, "— ไม่ระบุ —") + "</select></div>" +
    '<div class="two"><div class="f"><label for="jD">วันที่</label><input type="date" id="jD" value="' + esc(j.date) + '"></div>' +
    '<div class="f"><label for="jW">เวลานัด</label><input type="time" id="jW" value="' + esc(j.win) + '"></div></div>' +
    '<div class="f"><label for="jN">หมายเหตุ</label><textarea id="jN" placeholder="รายละเอียดเพิ่มเติม">' + esc(j.note) + "</textarea></div>" +
    '<button class="big org" id="jSave">' + (isNew ? "สร้างใบงาน" : "บันทึก") + "</button>" +
    (isNew ? "" : '<button class="ghost danger" id="jDel" style="margin-top:10px">ลบใบงานนี้</button>'),
    function () {
      $("#jSave").addEventListener("click", function () {
        var c = $("#jCu").value.trim();
        if (!c) { toast("ใส่ชื่อลูกค้าก่อน"); $("#jCu").focus(); return; }
        j.code = $("#jC").value.trim() || "WO-" + String(Date.now()).slice(-5);
        j.cust = c; j.title = $("#jT").value.trim() || "ไม่ระบุรายละเอียดงาน";
        j.siteId = $("#jSi").value || null; j.empId = $("#jE").value || null;
        j.date = $("#jD").value; j.win = $("#jW").value; j.status = $("#jS").value;
        j.note = $("#jN").value.trim();
        if (isNew) S.jobs.push(j);
        save(); renderJobs(); paint(); closeSheet();
        toast(isNew ? "สร้างใบงาน " + j.code + " แล้ว" : "บันทึกแล้ว");
      });
      var db = $("#jDel");
      if (db) db.addEventListener("click", function () {
        if (!confirm("ลบใบงาน " + j.code + " ?")) return;
        S.jobs = S.jobs.filter(function (x) { return x.id !== j.id; });
        if (S.jobId === j.id) S.jobId = null;
        save(); renderJobs(); paint(); closeSheet(); toast("ลบใบงานแล้ว");
      });
      focusSoon("#jCu");
    });
}

/* ---- pickers ---- */
function pickWho() {
  if (!S.emps.length) { empForm(null); return; }
  sheet("ฉันคือใคร",
    '<div class="pickrow">' + S.emps.map(function (e) {
      return '<button aria-pressed="' + (e.id === S.meId) + '" data-p="' + e.id + '">' +
        '<span class="g"><span class="p1">' + esc(e.name) + "</span>" +
        '<span class="p2">' + esc(e.code || "—") + (e.role ? " · " + esc(e.role) : "") + "</span></span></button>";
    }).join("") + "</div>" +
    '<button class="ghost" id="wAdd" style="margin-top:14px">＋ เพิ่มชื่อใหม่</button>',
    function (b) {
      $$("[data-p]", b).forEach(function (x) {
        x.addEventListener("click", function () {
          S.meId = x.dataset.p; save(); paint(); renderEmps(); closeSheet();
          toast("สลับเป็น " + empName(S.meId));
        });
      });
      $("#wAdd").addEventListener("click", function () { closeSheet(); empForm(null); });
    });
}

function pickSite() {
  if (!S.sites.length) { siteForm(null); return; }
  sheet("เลือกจุดลงเวลา",
    '<div class="pickrow">' + S.sites.map(function (s) {
      var d = pos && typeof s.lat === "number" ? haversine(pos.coords.latitude, pos.coords.longitude, s.lat, s.lng) : null;
      var near = d !== null && d <= (s.radius || S.cfg.fence);
      return '<button aria-pressed="' + (s.id === S.siteId) + '" data-p="' + s.id + '">' +
        '<span class="g"><span class="p1">' + esc(s.name) + "</span>" +
        '<span class="p2">รั้ว ' + (s.radius || S.cfg.fence) + " ม." + (near ? " · อยู่ในพื้นที่" : "") + "</span></span>" +
        '<span class="p3 ' + (d === null ? "" : near ? "near" : "far") + '">' + (d === null ? "—" : fmtDist(d).join(" ")) + "</span></button>";
    }).join("") + "</div>" +
    '<button class="ghost" id="sAdd2" style="margin-top:14px">＋ เพิ่มไซต์ใหม่จากตำแหน่งปัจจุบัน</button>',
    function (b) {
      $$("[data-p]", b).forEach(function (x) {
        x.addEventListener("click", function () { S.siteId = x.dataset.p; save(); paint(); closeSheet(); });
      });
      $("#sAdd2").addEventListener("click", function () { closeSheet(); siteForm(null); });
    });
}

function pickJob() {
  var open = S.jobs.filter(function (j) { return j.status !== "done"; });
  if (!open.length) {
    sheet("เลือกใบสั่งงาน", '<div class="empty">ยังไม่มีใบงานที่ค้างอยู่</div>' +
      '<button class="big org" id="jAdd2" style="margin-top:14px">สร้างใบงานใหม่</button>',
      function () { $("#jAdd2").addEventListener("click", function () { closeSheet(); jobForm(null); }); });
    return;
  }
  sheet("เลือกใบสั่งงาน",
    '<div class="pickrow">' +
    '<button aria-pressed="' + (!S.jobId) + '" data-p=""><span class="g"><span class="p1">ไม่ผูกใบงาน</span>' +
    '<span class="p2">ลงเวลาเข้า–ออกงานตามปกติ</span></span></button>' +
    open.map(function (j) {
      return '<button aria-pressed="' + (j.id === S.jobId) + '" data-p="' + j.id + '">' +
        '<span class="g"><span class="p1">' + esc(j.cust) + "</span>" +
        '<span class="p2">' + esc(j.code) + " · " + esc(j.title) + "</span></span></button>";
    }).join("") + "</div>",
    function (b) {
      $$("[data-p]", b).forEach(function (x) {
        x.addEventListener("click", function () {
          S.jobId = x.dataset.p || null;
          var j = job();
          if (j && j.siteId) S.siteId = j.siteId;
          save(); paint(); renderJobs(); closeSheet();
        });
      });
    });
}

/* ---------------- demo seed ---------------- */
function seed() {
  if (!confirm("ใส่ข้อมูลตัวอย่าง 3 พนักงาน + 2 ใบงาน?\nไซต์จะสร้างจากตำแหน่งปัจจุบันของคุณ")) return;
  var la = pos ? pos.coords.latitude : 13.7563, ln = pos ? pos.coords.longitude : 100.5018;
  var e1 = { id: uid(), name: "เอกรินทร์ วงศ์สถาพร", code: "MCE-002", role: "หัวหน้าชุด" };
  var e2 = { id: uid(), name: "ประสิทธิ์ กันทะวงศ์", code: "MCE-001", role: "ช่างไฟฟ้าอาวุโส" };
  var e3 = { id: uid(), name: "กมลชนก จันทร์เพ็ญ", code: "MCE-006", role: "ผู้ช่วยช่าง" };
  var s1 = { id: uid(), name: "จุดที่ผมยืนอยู่ตอนนี้", lat: +la.toFixed(6), lng: +ln.toFixed(6), radius: 120 };
  var s2 = { id: uid(), name: "ไซต์ทดสอบ (ห่างออกไป ~1 กม.)", lat: +(la + 0.009).toFixed(6), lng: +ln.toFixed(6), radius: 100 };
  S.emps = S.emps.concat([e1, e2, e3]);
  S.sites = S.sites.concat([s1, s2]);
  var d = new Date();
  var today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  S.jobs = S.jobs.concat([
    { id: uid(), code: "WO-6821", cust: "บจก. ไบโอเทค (ป้อมหลัง)", title: "ตรวจระบบไฟฟ้าประจำปี — ตู้ MDB ชั้น 1", siteId: s1.id, empId: e1.id, date: today, win: "09:00", status: "todo", note: "" },
    { id: uid(), code: "WO-6822", cust: "บมจ. ยูพีดี ตรวจสภาพรถ", title: "เปลี่ยนบัลลาสต์โคมไฟโรงจอด 12 จุด", siteId: s2.id, empId: e2.id, date: today, win: "13:30", status: "todo", note: "" }
  ]);
  if (!S.meId) S.meId = e1.id;
  if (!S.siteId) S.siteId = s1.id;
  save(); renderEmps(); renderSites(); renderJobs(); paint();
  toast("ใส่ข้อมูลตัวอย่างแล้ว");
}

/* ---------------- nav ---------------- */
function go(v) {
  $$(".view").forEach(function (x) { x.classList.toggle("on", x.id === "v-" + v); });
  $$("#tabs .tab").forEach(function (b) { b.setAttribute("aria-current", String(b.dataset.v === v)); });
  window.scrollTo(0, 0);
}

/* ---------------- wire up ---------------- */
load();

$$("#tabs .tab").forEach(function (b) { b.addEventListener("click", function () { go(b.dataset.v); }); });
$("#whoBtn").addEventListener("click", pickWho);
$("#sitePick").addEventListener("click", pickSite);
$("#jobPick").addEventListener("click", pickJob);
$("#inBtn").addEventListener("click", function () { punch("in"); });
$("#outBtn").addEventListener("click", function () { punch("out"); });
$("#reBtn").addEventListener("click", function () { pos = null; geoErr = null; paint(); startGeo(); toast("กำลังอ่านตำแหน่งใหม่…"); });

$$("#jobSeg button").forEach(function (b) {
  b.addEventListener("click", function () {
    jobFilter = b.dataset.f;
    $$("#jobSeg button").forEach(function (x) { x.setAttribute("aria-current", String(x === b)); });
    renderJobs();
  });
});
$("#jobAdd").addEventListener("click", function () { jobForm(null); });
$("#empAdd").addEventListener("click", function () { empForm(null); });
$("#siteAdd").addEventListener("click", function () { siteForm(null); });
$("#csvBtn").addEventListener("click", csv);
$("#seedBtn").addEventListener("click", seed);

$("#setFence").value = S.cfg.fence;
$("#setStrict").checked = !!S.cfg.strict;
$("#setShift").value = S.cfg.shift;
$("#setFence").addEventListener("change", function () {
  S.cfg.fence = Math.max(10, parseInt(this.value, 10) || 100); this.value = S.cfg.fence; save(); paint(); renderSites();
});
$("#setStrict").addEventListener("change", function () { S.cfg.strict = this.checked; save(); paint(); });
$("#setShift").addEventListener("change", function () { S.cfg.shift = this.value; save(); });

$("#expBtn").addEventListener("click", function () {
  download("mce-checkin-backup-" + dayKey(Date.now()) + ".json", JSON.stringify(S, null, 2));
  toast("ดาวน์โหลดไฟล์สำรองแล้ว");
});
$("#impBtn").addEventListener("click", function () { $("#impFile").click(); });
$("#impFile").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function () {
    try {
      var o = JSON.parse(r.result);
      if (!o || !Array.isArray(o.emps)) throw 0;
      S = Object.assign(S, o); save();
      renderEmps(); renderSites(); renderJobs(); renderLog(); paint();
      toast("กู้คืนข้อมูลแล้ว");
    } catch (e) { toast("ไฟล์ไม่ถูกต้อง"); }
  };
  r.readAsText(f);
  this.value = "";
});
$("#wipeBtn").addEventListener("click", function () {
  if (!confirm("ล้างข้อมูลทั้งหมดในเครื่องนี้? กู้คืนไม่ได้")) return;
  localStorage.removeItem(KEY);
  location.reload();
});
$("#verTxt").textContent = "เวอร์ชัน " + VER;

/* install prompt (Android/Chrome) */
var deferred = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault(); deferred = e;
  $("#installSect").hidden = false;
});
$("#installBtn").addEventListener("click", function () {
  if (!deferred) { toast("เปิดเมนูเบราว์เซอร์แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”"); return; }
  deferred.prompt();
  deferred.userChoice.then(function () { deferred = null; $("#installSect").hidden = true; });
});

/* service worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").catch(function () { /* ใช้ต่อได้แม้ลงทะเบียนไม่สำเร็จ */ });
  });
}

/* first paint */
renderEmps(); renderSites(); renderJobs(); renderLog(); paint();
startGeo();
setInterval(function () { if (pos) $("#gAge").textContent = hm(pos.timestamp); }, 30000);
window.addEventListener("resize", function () { drawRadar(distNow()); });

})();
