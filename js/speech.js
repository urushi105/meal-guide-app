// ============================================================
// speech.js ： 音声で案内するファイル
//
// 音声の出し方は 2 通り（config.js の SPEECH.MODE で選びます）
//
//   "voiceover" （標準）
//       画面に隠してある「読み上げ領域」の文字を書き換えると、
//       iPhone の VoiceOver がそれを読み上げてくれます。
//       ※ VoiceOver をオンにしておく必要があります。
//
//   "synthesis"
//       ブラウザの音声合成（speechSynthesis）で読み上げます。
//       ※ VoiceOver がオフでも鳴ります。再生速度の設定が使えます。
//
// どちらの場合も、
//   ・順番待ちの列（キュー）を作って、案内が重ならないようにする
//   ・読み上げる文字を「文字起こし」として画面に出す
// という共通の仕事をします。
// ============================================================

import { SPEECH } from "./config.js";


let liveRegion = null;          // VoiceOver に読ませるための隠し領域
let getRate = () => 1.0;        // 再生速度を教えてくれる関数（app.js から渡される）
let onSpeak = () => {};         // 読み上げ開始のときに呼ぶ関数（文字起こし・ログ用）

const queue = [];               // ※ 読み上げ待ちの文章の列
let speaking = false;           // ※ 今、読み上げ中かどうか
let timerId = null;             // ※ 読み上げ終了を待つタイマー
let currentToken = 0;           // ※ 「いまの読み上げ」を見分ける番号（打ち切った古い読み上げの終了通知を無視するため）



// ------------------------------------------------------------
// 準備
// ------------------------------------------------------------
export function initSpeech(options) {

  liveRegion = options.liveRegion;
  getRate = options.getRate;
  onSpeak = options.onSpeak;
}



// ------------------------------------------------------------
// VoiceOver に読ませる（隠し領域の文字を書き換える）
// ------------------------------------------------------------
function announceToVoiceOver(text) {

  // ※ 同じ文章が続いても読み直してもらえるように、一度空にしてから入れ直す
  liveRegion.textContent = "";

  setTimeout(() => {
    liveRegion.textContent = text;
  }, 60);
}



// ------------------------------------------------------------
// 画面操作の結果だけを VoiceOver に伝える（文字起こしには出さない）
//   例）「再生速度 1.1」
// ------------------------------------------------------------
export function announceUI(text) {
  announceToVoiceOver(text);
}



// ------------------------------------------------------------
// 読み上げにかかる時間を見積もる（VoiceOver用）
// ------------------------------------------------------------
function estimateDuration(text) {
  return SPEECH.VOICEOVER_PADDING_MS + text.length * SPEECH.VOICEOVER_MS_PER_CHAR;
}



// ------------------------------------------------------------
// 列の先頭の文章を読み上げる
// ------------------------------------------------------------
function playNext() {

  if (queue.length === 0) {
    speaking = false;
    return;
  }

  speaking = true;

  const text = queue.shift();
  const token = ++currentToken;   // ※ この読み上げの番号

  // ※ 文字起こし・ログのために知らせる
  onSpeak(text);

  if (SPEECH.MODE === "synthesis" && "speechSynthesis" in window) {

    // --- ブラウザの音声合成で読み上げる ---
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = "ja-JP";
    utterance.rate = getRate();   // ※ 詳細設定の「再生速度」

    // ※ 読み終わったら次へ（打ち切られた古い読み上げの通知は無視する）
    const goNext = () => {
      if (token === currentToken) {
        playNext();
      }
    };

    utterance.onend = goNext;
    utterance.onerror = goNext;

    window.speechSynthesis.speak(utterance);

  } else {

    // --- VoiceOver に読ませる ---
    announceToVoiceOver(text);

    // ※ 読み終わる頃（見積もり）に次へ進む
    timerId = setTimeout(playNext, estimateDuration(text));
  }
}



// ------------------------------------------------------------
// 文章を読み上げの列に加える（app.js から使う）
//   interrupt = true なら、いま読んでいる途中の案内を打ち切って、すぐ読む
// ------------------------------------------------------------
export function say(text, options = {}) {

  if (options.interrupt) {
    clearSpeech();
  }

  queue.push(text);

  if (!speaking) {
    playNext();
  }
}



// ------------------------------------------------------------
// 読み上げ待ちの文章をすべて消す
// ------------------------------------------------------------
export function clearSpeech() {

  queue.length = 0;
  speaking = false;
  currentToken += 1;   // ※ いまの読み上げを「古いもの」にする

  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}



// ------------------------------------------------------------
// 今、読み上げ中（または順番待ち）かどうか
// ※ 通常案内は、混み合っているときは出さないために使う
// ------------------------------------------------------------
export function isBusy() {
  return speaking || queue.length > 0;
}
