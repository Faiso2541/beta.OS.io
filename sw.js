/* McE. Check-in — service worker
   แคชไฟล์แอปไว้ในเครื่อง เปิดใช้ได้แม้สัญญาณหลุด
   ทุก path เป็นแบบ relative จึงทำงานใต้ /ชื่อ-repo/ ของ GitHub Pages ได้ */
var VERSION = "mce-checkin-v1.0.0";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () { /* ข้ามไฟล์ที่โหลดไม่ได้ */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === VERSION ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  // ฟอนต์จาก Google: เอาจากแคชก่อน แล้วค่อยอัปเดตเบื้องหลัง
  if (url.origin.indexOf("fonts.googleapis.com") > -1 || url.origin.indexOf("fonts.gstatic.com") > -1) {
    e.respondWith(
      caches.open(VERSION + "-font").then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && res.status === 200) c.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: ลองเน็ตก่อน ถ้าออฟไลน์ค่อยใช้แคช
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put("./index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("./index.html").then(function (hit) {
          return hit || caches.match("./");
        });
      })
    );
    return;
  }

  // ไฟล์อื่น: แคชก่อน
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
