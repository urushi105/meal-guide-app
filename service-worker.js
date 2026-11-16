// ============================================================
// service-worker.js ： アプリをオフラインでも動かすための仕組み（PWA）
//
// やること
//   1. 初めて開いたとき、アプリに必要なファイルをスマホに保存（キャッシュ）する
//   2. 次からは、ネットにつながっていればネットから最新を取得し、
//      つながっていなければ保存してあるファイルを使う
//
// ※ ファイルを書き換えて公開し直したときは、下の CACHE_NAME の数字を
//    変えてください（古い保存データが消えて、新しいものに入れ替わります）
// ============================================================

const CACHE_NAME = "meal-guide-v1";


// ※ 保存しておくファイルの一覧
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/app.js",
  "./js/camera.js",
  "./js/classes.js",
  "./js/config.js",
  "./js/detector.js",
  "./js/gesture.js",
  "./js/guide.js",
  "./js/logger.js",
  "./js/overlay.js",
  "./js/settings.js",
  "./js/speech.js",
  "./lib/ort.wasm.min.js",
  "./lib/ort-wasm-simd-threaded.mjs",
  "./lib/ort-wasm-simd-threaded.wasm",
  "./model/last.onnx",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];



// ------------------------------------------------------------
// インストール時：ファイルを保存する
// ------------------------------------------------------------
self.addEventListener("install", (event) => {

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {

      // ※ 1つずつ保存する（モデルファイルがまだ無くても、他は保存できるように）
      return Promise.allSettled(FILES_TO_CACHE.map((file) => cache.add(file)));
    })
  );

  // ※ 待たずに、すぐ新しい版を使い始める
  self.skipWaiting();
});



// ------------------------------------------------------------
// 有効になったとき：古い版の保存データを消す
// ------------------------------------------------------------
self.addEventListener("activate", (event) => {

  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});



// ------------------------------------------------------------
// ファイルを取りにいくとき：ネット優先、だめなら保存データ
// ------------------------------------------------------------
self.addEventListener("fetch", (event) => {

  // ※ 取得（GET）以外は何もしない
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {

        // ※ 取得できたら、保存データも新しいものに更新しておく
        const copy = response.clone();

        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }

        return response;
      })
      .catch(() => {

        // ※ ネットにつながらないときは、保存してあるものを返す
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("./index.html");
        });
      })
  );
});
