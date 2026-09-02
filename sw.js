/* McEnergy Service & Maintenance Report — service worker
   ------------------------------------------------------
   Bump CACHE_VERSION every time index.html changes (1.11.0 -> 1.11.1 -> ...).
   Bumping the number also wipes every old cache on the phone, which is the
   surest way to get a stuck device back onto the current form. */
var CACHE_VERSION = 'mce-report-3.6.0';

/* how long to wait for the network before falling back to the stored copy.
   long enough for a weak site signal, short enough that the form still opens */
var NET_TIMEOUT_MS = 8000;

var APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(c){
      /* addAll fails as a unit, so add one by one and tolerate misses */
      return Promise.all(APP_SHELL.map(function(u){
        return c.add(new Request(u, { cache: 'reload' })).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* fetch the page while ignoring the browser's own HTTP cache.
   Without cache:'reload' the browser may hand back a stored copy without ever
   asking the server, which is how phones ended up running an old form even
   though this worker asks for the network first. */
function fetchFreshPage(url){
  return fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
}

/* give up on a slow network instead of leaving the technician on a blank
   screen - the stored copy opens immediately and still works offline */
function withTimeout(promise, ms){
  return new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){
      if(!done){ done = true; reject(new Error('network timeout')); }
    }, ms);
    promise.then(function(v){
      if(done) return;
      done = true; clearTimeout(timer); resolve(v);
    }, function(err){
      if(done) return;
      done = true; clearTimeout(timer); reject(err);
    });
  });
}

function cachedPage(){
  return caches.match('./index.html').then(function(hit){
    return hit || caches.match('./');
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  /* the page itself: always network first, and never trust the HTTP cache,
     so a newly deployed form is picked up the moment the phone has signal.
     The stored copy is only a fallback for no signal or a very slow one. */
  if(req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('index.html'))){
    e.respondWith(
      withTimeout(fetchFreshPage(req.url), NET_TIMEOUT_MS).then(function(res){
        if(!res || !res.ok) throw new Error('bad response');
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put('./index.html', copy); });
        return res;
      }).catch(function(){
        return cachedPage();
      })
    );
    return;
  }

  /* everything else (icons, Google Fonts): cache first, then fill the cache */
  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(res && (res.ok || res.type === 'opaque')){
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return hit; });
    })
  );
});
