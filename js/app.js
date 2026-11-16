// ============================================================
// app.js ： アプリ全体をまとめるファイル（司令塔）
//
// このファイルがやること
//   ・画面（ホーム／詳細設定）の操作
//   ・カメラ・モデル・音声の準備
//   ・検出を繰り返し行い、結果を各部品に渡す
//   ・アプリの状態を管理する
//
// アプリの状態（state）
//   loading  : 準備中（カメラとモデルを読み込んでいる）
//   idle     : 待機中（案内していない。開始ジェスチャーを待っている）
//   scanning : 食卓スキャン中（案内開始・再検出の直後に、食卓を調べている）
//   guiding  : 案内中（初期案内のあと。再検出・終了のジェスチャーを待っている）
//   error    : カメラやモデルに問題があって動けない
//
//   処理の流れ
//     待機 → 開始ジェスチャー → 3秒後に案内開始 → 初期案内（熱い物・食べてはいけない物の方向）
//          → 再検出ジェスチャー（開始から終了まで何回でも）
//          → 終了ジェスチャー → 3秒後に案内終了 → 待機
//
//   loading → idle → scanning → guiding → idle → ...
//                       ↑__再検出__↓
// ============================================================

import { MODEL, GESTURE, ACTION_LABELS, SCAN, SPEECH, UI } from "./config.js";
import { loadModel, detect } from "./detector.js";
import { startCamera, restartCamera, setZoom, isReady } from "./camera.js";
import { createGestureEngine } from "./gesture.js";
import { createScanner, buildInitialMessages } from "./guide.js";
import { describeClass } from "./classes.js";
import { initSpeech, say, announceUI } from "./speech.js";
import { settings, loadSettings, saveSettings, clampStep } from "./settings.js";
import { log, saveLogFile } from "./logger.js";
import { drawDetections } from "./overlay.js";



// ============================================================
// 1. 画面の部品を取得する
// ============================================================
const $ = (id) => document.getElementById(id);

const homeScreen    = $("home");
const settingsSheet = $("settings");
const videoElement  = $("camera");
const overlayCanvas = $("overlay");
const transcript    = $("transcript");
const liveRegion    = $("liveRegion");

const openSettingsButton  = $("openSettings");
const closeSettingsButton = $("closeSettings");
const startButton         = $("startButton");
const endButton           = $("endButton");

const modelNameText = $("modelName");
const rateValueText = $("rateValue");
const zoomValueText = $("zoomValue");
const rateNote      = $("rateNote");
const zoomNote      = $("zoomNote");
const saveStatus    = $("saveStatus");



// ============================================================
// 2. アプリの状態
// ============================================================
let state = "loading";
let modelReady = false;
let trayExpected = false;   // ※ モデルに「お盆」のクラスがあるか（あれば、お盆の中心を基準にする）

let scanner = null;       // ※ 食卓スキャンの集計係
let scanOpenAt = 0;       // ※ この時刻からスキャンの撮影を始める
let scanCloseAt = 0;      // ※ この時刻でスキャンを終える



// ------------------------------------------------------------
// 状態を変える
// ------------------------------------------------------------
function setState(next) {

  log("state", `${state} -> ${next}`);
  state = next;
}



// ============================================================
// 3. 文字起こし（ホーム画面の黒い部分）
// ============================================================

// ------------------------------------------------------------
// 読み上げる文章を、文字起こしに1行追加する（新しいものが上）
// ------------------------------------------------------------
function addTranscriptLine(text) {

  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;

  transcript.prepend(line);

  // ※ 決めた行数を超えた古い行は消す
  while (transcript.children.length > UI.TRANSCRIPT_LINES) {
    transcript.lastChild.remove();
  }
}



// ============================================================
// 4. 案内の開始・再検出・終了
// ============================================================

// ------------------------------------------------------------
// 食卓スキャンを始める（案内開始・再検出の両方で使う）
// ------------------------------------------------------------
function beginScan() {

  setState("scanning");

  scanner = createScanner();

  const now = performance.now();
  scanOpenAt = now + SCAN.WAIT_MS;                      // ※ 手を下ろす時間を待ってから撮影
  scanCloseAt = scanOpenAt + SCAN.DURATION_MS;
}


// ------------------------------------------------------------
// 案内を開始する
// ------------------------------------------------------------
function startGuidance() {

  if (state !== "idle") {
    return false;
  }

  gestureEngine.reset();

  say("案内を開始します。手を下ろして、そのままお待ちください。", { interrupt: true });

  beginScan();

  return true;
}


// ------------------------------------------------------------
// 再検出する（もう一度、食卓をスキャンして最初の案内をやり直す）
// ------------------------------------------------------------
function redetect() {

  if (state !== "guiding") {
    return false;
  }

  gestureEngine.reset();

  say("再検出します。手を下ろして、そのままお待ちください。", { interrupt: true });

  beginScan();

  return true;
}


// ------------------------------------------------------------
// 案内を終了する
// ------------------------------------------------------------
function endGuidance() {

  if (state !== "scanning" && state !== "guiding") {
    return false;
  }

  gestureEngine.reset();
  scanner = null;

  setState("idle");

  say("案内を終了します。", { interrupt: true });

  return true;
}


// ------------------------------------------------------------
// スキャンが終わったとき：結果をまとめて、最初の案内を読み上げる
// ------------------------------------------------------------
function finishScan(frameWidth, frameHeight) {

  const result = scanner.finish(frameWidth, frameHeight, { trayExpected: trayExpected });
  const messages = buildInitialMessages(result);

  scanner = null;

  const summary = result.items.map((i) => (i.center ? `${i.ja}=中央` : `${i.ja}=${i.hour}時`)).join(" ");
  log("state", `スキャン結果（基準: ${result.reference.type}）: ${summary || "なし"}`);

  for (const message of messages) {
    say(message);
  }

  setState("guiding");
}



// ============================================================
// 5. ジェスチャー
// ============================================================

// ------------------------------------------------------------
// 今の状態で、その動作を受け付けてよいか
//   start    : 待機中のみ
//   redetect : 案内中のみ
//   end      : スキャン中・案内中
// ------------------------------------------------------------
function isActionAllowed(action) {

  if (action === "start")    return state === "idle";
  if (action === "redetect") return state === "guiding";
  if (action === "end")      return state === "scanning" || state === "guiding";

  return false;
}


// ※ 動作名 → 実際の処理
function runAction(action) {

  if (action === "start")    startGuidance();
  if (action === "redetect") redetect();
  if (action === "end")      endGuidance();
}


const gestureEngine = createGestureEngine({

  isAllowed: isActionAllowed,

  // ※ ジェスチャーが見つかって、待機（案内開始・案内終了は3秒）が始まったとき
  //    ※ 再検出は待たずにすぐ実行されるので、ここは呼ばれません
  onPending: (info) => {
    const label = ACTION_LABELS[info.action];              // 例）「案内を開始」
    const seconds = Math.round(info.holdMs / 1000);        // 例）3
    log("gesture", `待機開始: ${info.action}（${seconds}秒）`);
    say(`${seconds}秒後に${label}します`, { interrupt: true });
  },

  // ※ 3秒たつ前にキャンセルされたとき
  onCancel: (info, reason) => {
    log("gesture", `キャンセル: ${info.action}（${reason}）`);

    // ※ 別のジェスチャーに変わったときは、続けて新しい案内が出るので何も言わない
    if (reason === "lost") {
      say("キャンセルしました", { interrupt: true });
    }
  },

  // ※ 3秒たって、実行するとき
  onFire: (info) => {
    log("gesture", `実行: ${info.action}`);
    runAction(info.action);
  },
});



// ============================================================
// 6. 検出ループ
// ============================================================

// ※ 指定した時間（ミリ秒）だけ待つ
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// ------------------------------------------------------------
// 検出結果を1コマ分処理する
// ------------------------------------------------------------
function handleResult(result) {

  const now = performance.now();
  const { detections, frameWidth, frameHeight, ms } = result;

  // --- 枠を描く ---
  drawDetections(overlayCanvas, videoElement, detections);

  // --- ログに残す（検出精度の評価用） ---
  const summary = detections
    .map((d) => `${d.name}:${d.score.toFixed(2)}@${Math.round(d.cx)},${Math.round(d.cy)}`)
    .join("|");

  log("detect", `${summary || "なし"} ms=${ms}`);

  // --- ジェスチャーの判定 ---
  gestureEngine.update(detections, now);

  // --- 状態ごとの処理 ---
  if (state === "scanning") {

    // ※ 撮影の時間帯だけ、結果を集める
    if (now >= scanOpenAt && now < scanCloseAt) {
      scanner.addFrame(detections);
    }

    // ※ 時間が来たらまとめる
    if (now >= scanCloseAt) {
      finishScan(frameWidth, frameHeight);
    }

  }

  // ※ 案内中(guiding)は、ジェスチャー（再検出・終了）を待つだけです
}


// ------------------------------------------------------------
// 検出を繰り返す
// ------------------------------------------------------------
async function detectionLoop() {

  let errorCount = 0;

  while (true) {

    const loopStart = performance.now();

    // ※ モデルとカメラの準備ができていて、画面が見えているときだけ検出する
    if (modelReady && isReady() && !document.hidden) {

      try {
        const result = await detect(videoElement);
        handleResult(result);
        errorCount = 0;

      } catch (error) {

        errorCount += 1;
        console.error("[検出エラー]", error);
        log("error", String(error.message || error));

        // ※ エラーが続くときは、案内して止める
        if (errorCount >= 5) {
          setState("error");
          say(`エラーが発生しました。${error.message || ""}`, { interrupt: true });
          return;
        }
      }
    }

    // ※ 発熱を抑えるため、最低限の間隔をあける
    const elapsed = performance.now() - loopStart;
    await sleep(Math.max(10, MODEL.MIN_INTERVAL_MS - elapsed));
  }
}



// ============================================================
// 7. 手動ボタン（音声案内開始・終了）
// ============================================================
function setupManualButtons() {

  startButton.addEventListener("click", () => {

    log("button", "音声案内開始");
    gestureEngine.reset();

    if (state === "loading") {
      say("準備中です。しばらくお待ちください。", { interrupt: true });
    } else if (state === "error") {
      say("カメラまたはモデルに問題があり、開始できません。", { interrupt: true });
    } else if (state === "idle") {
      startGuidance();
    } else {
      say("すでに案内中です。", { interrupt: true });
    }
  });


  endButton.addEventListener("click", () => {

    log("button", "音声案内終了");
    gestureEngine.reset();

    if (!endGuidance()) {
      say("案内は開始していません。", { interrupt: true });
    }
  });
}



// ============================================================
// 8. 詳細設定画面
// ============================================================

// ------------------------------------------------------------
// 設定値を画面の表示に反映する
// ------------------------------------------------------------
function refreshSettingsView() {

  // ※ モデル名
  modelNameText.textContent = MODEL.DISPLAY_NAME;

  // ※ 文字の大きさ（S/M/L）：選ばれているものを青くする
  for (const size of ["S", "M", "L"]) {
    const button = document.querySelector(`[data-font="${size}"]`);
    button.setAttribute("aria-pressed", String(settings.fontSize === size));
  }

  // ※ 数字
  rateValueText.textContent = settings.speechRate.toFixed(1);
  zoomValueText.textContent = settings.zoom.toFixed(1);

  // ※ 文字起こしの文字の大きさを反映
  document.documentElement.style.setProperty("--transcript-size", UI.FONT_SIZES[settings.fontSize] + "px");

  // ※ VoiceOver 方式のときだけ、再生速度についての注意書きを出す
  rateNote.hidden = SPEECH.MODE !== "voiceover";
}


// ------------------------------------------------------------
// カメラ倍率を反映して、方式の説明文を更新する
// ------------------------------------------------------------
async function applyZoom() {

  let mode = "unknown";

  try {
    mode = await setZoom(settings.zoom);
  } catch (error) {
    console.warn("[倍率]", error);
  }

  const notes = {
    hardware:    "カメラのズーム機能で倍率を変えています。",
    lens:        "レンズの切り替えで調整しています（0.7以下で超広角レンズ）。",
    unsupported: "この端末では、カメラの倍率を変更できません。",
    unknown:     "",
  };

  zoomNote.textContent = notes[mode] || "";
  zoomNote.hidden = !zoomNote.textContent;
}


// ------------------------------------------------------------
// 設定画面を開く
// ------------------------------------------------------------
function openSettings() {

  settingsSheet.hidden = false;

  // ※ 後ろのホーム画面は、VoiceOver が読まないようにする
  homeScreen.setAttribute("aria-hidden", "true");
  homeScreen.inert = true;

  closeSettingsButton.focus();
}


// ------------------------------------------------------------
// 設定画面を閉じて、ホーム画面に戻る
// ------------------------------------------------------------
function closeSettings() {

  settingsSheet.hidden = true;

  homeScreen.removeAttribute("aria-hidden");
  homeScreen.inert = false;

  openSettingsButton.focus();
}


// ------------------------------------------------------------
// 詳細設定画面のボタンをセットする
// ------------------------------------------------------------
function setupSettingsScreen() {

  openSettingsButton.addEventListener("click", openSettings);
  closeSettingsButton.addEventListener("click", closeSettings);


  // --- 文字の大きさ S / M / L ---
  for (const size of ["S", "M", "L"]) {

    document.querySelector(`[data-font="${size}"]`).addEventListener("click", () => {
      settings.fontSize = size;
      saveSettings();
      refreshSettingsView();
      announceUI(`文字の大きさ ${size}`);
    });
  }


  // --- 再生速度 − / ＋ ---
  $("rateDown").addEventListener("click", () => {
    settings.speechRate = clampStep(settings.speechRate - UI.RATE.STEP, UI.RATE);
    saveSettings();
    refreshSettingsView();
    announceUI(`再生速度 ${settings.speechRate.toFixed(1)}`);
  });

  $("rateUp").addEventListener("click", () => {
    settings.speechRate = clampStep(settings.speechRate + UI.RATE.STEP, UI.RATE);
    saveSettings();
    refreshSettingsView();
    announceUI(`再生速度 ${settings.speechRate.toFixed(1)}`);
  });


  // --- カメラ倍率 − / ＋ ---
  $("zoomDown").addEventListener("click", async () => {
    settings.zoom = clampStep(settings.zoom - UI.ZOOM.STEP, UI.ZOOM);
    saveSettings();
    refreshSettingsView();
    announceUI(`カメラ倍率 ${settings.zoom.toFixed(1)}倍`);
    await applyZoom();
  });

  $("zoomUp").addEventListener("click", async () => {
    settings.zoom = clampStep(settings.zoom + UI.ZOOM.STEP, UI.ZOOM);
    saveSettings();
    refreshSettingsView();
    announceUI(`カメラ倍率 ${settings.zoom.toFixed(1)}倍`);
    await applyZoom();
  });


  // --- データを保存する（ログをCSVファイルにする） ---
  $("saveData").addEventListener("click", async () => {

    saveStatus.textContent = "保存しています…";

    try {
      const { count, result } = await saveLogFile();

      const messages = {
        shared:     `ログを保存しました（${count}件）`,
        downloaded: `ログをダウンロードしました（${count}件）`,
        cancelled:  "保存をキャンセルしました",
      };

      saveStatus.textContent = messages[result];

    } catch (error) {
      console.error("[ログ保存]", error);
      saveStatus.textContent = "保存に失敗しました";
    }

    announceUI(saveStatus.textContent);
  });
}



// ============================================================
// 9. 画面を消さない・戻ってきたとき
// ============================================================
let wakeLock = null;

// ※ 食事中に画面が暗くならないようにする
async function keepScreenAwake() {

  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (error) {
    console.warn("[画面スリープ防止]", error);
  }
}


// ※ アプリを閉じて戻ってきたとき、カメラが止まっていたら起動し直す
document.addEventListener("visibilitychange", async () => {

  if (document.hidden) return;

  keepScreenAwake();

  if (!isReady() && state !== "loading") {
    try {
      await restartCamera();
      await applyZoom();
    } catch (error) {
      console.warn("[カメラ再起動]", error);
    }
  }
});



// ============================================================
// 10. 起動
// ============================================================
async function main() {

  // --- PWA：オフラインでも動くようにする仕組み（service-worker.js）を登録 ---
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("[Service Worker]", error);
    });
  }

  // --- 設定・画面・音声の準備 ---
  loadSettings();
  refreshSettingsView();
  setupManualButtons();
  setupSettingsScreen();

  initSpeech({
    liveRegion: liveRegion,
    getRate: () => settings.speechRate,
    onSpeak: (text) => {
      addTranscriptLine(text);    // ※ 文字起こしに出す
      log("speech", text);        // ※ ログに残す
    },
  });

  keepScreenAwake();

  say("モデルを読み込んでいます。しばらくお待ちください。");


  // --- カメラとモデルを同時に準備する（待ち時間を短くするため） ---
  const cameraTask = (async () => {
    await startCamera(videoElement);
    await applyZoom();
  })();

  const modelTask = loadModel();

  const [cameraResult, modelResult] = await Promise.allSettled([cameraTask, modelTask]);


  // --- 結果を確認する ---
  if (cameraResult.status === "rejected") {
    console.error("[カメラ]", cameraResult.reason);
    log("error", "カメラ: " + cameraResult.reason);
    say("カメラを使用できません。ブラウザの設定で、カメラの使用を許可してください。", { interrupt: true });
  }

  if (modelResult.status === "rejected") {
    console.error("[モデル]", modelResult.reason);
    log("error", "モデル: " + modelResult.reason);
    say(`モデルを読み込めません。${modelResult.reason.message || ""}`);
  }

  if (cameraResult.status === "rejected" || modelResult.status === "rejected") {
    setState("error");
    return;
  }


  // --- モデルに「お盆」のクラスがあるか調べる ---
  trayExpected = modelResult.value.classNames.some((name) => describeClass(name).kind === "tray");

  // --- 準備完了 ---
  modelReady = true;
  setState("idle");

  const startSeconds = Math.round(GESTURE.HOLD_MS.start / 1000);

  say(`準備ができました。指を1本立てると、${startSeconds}秒後に案内を開始します。`, { interrupt: true });

  detectionLoop();
}

main();
