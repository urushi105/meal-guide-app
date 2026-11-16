// ============================================================
// settings.js ： 詳細設定の値を覚えておくファイル
//
// 覚えておく設定
//   fontSize   : 文字起こしの文字の大きさ（"S" / "M" / "L"）
//   speechRate : 再生速度（0.1〜2.0）
//   zoom       : カメラの倍率（0.5〜1.0）
//
// ※ 値はスマホの中（localStorage）に保存されるので、
//    アプリを閉じても次回そのまま使えます。
// ============================================================

import { UI } from "./config.js";


const STORAGE_KEY = "mealGuideSettings";


// ※ 現在の設定値（他のファイルから読み書きする）
export const settings = {
  fontSize: "M",
  speechRate: UI.RATE.DEFAULT,
  zoom: UI.ZOOM.DEFAULT,
};



// ------------------------------------------------------------
// 数字を範囲内におさめて、小数第1位までに丸める
//   例）clampStep(1.0000001, {MIN:0.1, MAX:2.0}) → 1
// ------------------------------------------------------------
export function clampStep(value, range) {

  const clamped = Math.min(range.MAX, Math.max(range.MIN, value));

  // ※ 0.1 + 0.2 = 0.30000000000000004 のような誤差を消すため、10倍して丸める
  return Math.round(clamped * 10) / 10;
}



// ------------------------------------------------------------
// 保存してある設定を読み込む
// ------------------------------------------------------------
export function loadSettings() {

  try {
    const text = localStorage.getItem(STORAGE_KEY);

    if (text) {
      const saved = JSON.parse(text);

      if (["S", "M", "L"].includes(saved.fontSize)) {
        settings.fontSize = saved.fontSize;
      }

      if (typeof saved.speechRate === "number") {
        settings.speechRate = clampStep(saved.speechRate, UI.RATE);
      }

      if (typeof saved.zoom === "number") {
        settings.zoom = clampStep(saved.zoom, UI.ZOOM);
      }
    }
  } catch (error) {
    console.warn("[設定] 読み込みに失敗しました:", error);
  }
}



// ------------------------------------------------------------
// 設定を保存する
// ------------------------------------------------------------
export function saveSettings() {

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("[設定] 保存に失敗しました:", error);
  }
}
