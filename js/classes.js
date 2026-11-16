// ============================================================
// classes.js ： 「検出されたクラス名」が何を意味するか調べるファイル
//
// 例）"misosiru" → 日本語名「味噌汁」・熱い物
//     "finger2"   → 指2本のジェスチャー（再検出）
// ============================================================

import { CLASS_TABLE, GESTURE_NAME_TO_NUMBER, GESTURE_ACTIONS, GESTURE_BY_CLASS_NAME, ACTION_LABELS } from "./config.js";


// ※ 一度調べたクラス名は、ここに覚えておく（毎回調べ直さないため）
const cache = new Map();


// ------------------------------------------------------------
// 名前をそろえる（大文字小文字・全角半角・記号の違いを無視するため）
// 例）"Miso_Soup" → "misosoup"、"１" → "1"
// ------------------------------------------------------------
function normalize(name) {

  return String(name)
    .normalize("NFKC")          // ※ 全角の「１」を半角の「1」にする
    .toLowerCase()              // ※ 小文字にそろえる
    .replace(/[\s_\-]/g, "");   // ※ 空白・_・- を消す
}


// ------------------------------------------------------------
// クラス名の意味を返す
//   戻り値: { ja, kind, hot, inedible, gestureNumber, action }
//     kind = "item"（料理や食べてはいけない物）/ "tray"（お盆）/ "gesture"（ジェスチャー）/ "other"（案内に使わない物）
// ------------------------------------------------------------
export function describeClass(className) {

  // ※ 調べ済みなら、覚えている結果をそのまま返す
  if (cache.has(className)) {
    return cache.get(className);
  }

  const key = normalize(className);
  let result = null;


  // (0) 「gesture_start」のように、クラス名で指定したジェスチャーかどうか調べる
  for (const [gestureName, action] of Object.entries(GESTURE_BY_CLASS_NAME)) {

    if (normalize(gestureName) === key) {
      result = {
        ja: `合図（${ACTION_LABELS[action]}）`,
        kind: "gesture",
        hot: false,
        inedible: false,
        gestureNumber: null,
        action: action,
      };
      break;
    }
  }


  // (1) 次に「指の本数のジェスチャー」かどうか調べる
  //     ※ 名前がぴったり一致したときだけジェスチャーと判断します
  if (result === null && key in GESTURE_NAME_TO_NUMBER) {

    const number = GESTURE_NAME_TO_NUMBER[key];
    const actionInfo = GESTURE_ACTIONS[number];

    result = {
      ja: `指${number}本`,
      kind: "gesture",
      hot: false,
      inedible: false,
      gestureNumber: number,
      action: actionInfo ? actionInfo.action : null,   // ※ 未定義の本数は null
    };
  }


  // (2) 次に、料理・手などの対応表（CLASS_TABLE）から探す
  if (result === null) {

    for (const row of CLASS_TABLE) {

      // ※ words のどれか1つでも名前に含まれていれば一致
      const matched = row.words.some((word) => key.includes(normalize(word)));

      if (matched) {
        result = {
          ja: row.ja,
          kind: row.tray === true ? "tray" : "item",   // ※ お盆 or 案内に使う物
          hot: row.hot === true,        // ※ 熱い物
          inedible: row.inedible === true,   // ※ 食べてはいけない物
          gestureNumber: null,
          action: null,
        };
        break;
      }
    }
  }


  // (3) どれにも当てはまらなかった場合
  if (result === null) {

    console.warn(`[クラス名] 「${className}」は対応表にありません。config.js の CLASS_TABLE に追加してください。`);

    result = {
      ja: String(className),   // ※ そのままの名前で読み上げる
      kind: "other",           // ※ 案内には使わない
      hot: false,
      inedible: false,
      gestureNumber: null,
      action: null,
    };
  }


  cache.set(className, result);

  return result;
}
