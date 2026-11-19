// ============================================================
// guide.js ： 案内の中身（初期案内・再検出案内・食事終了案内）を作るファイル
//
// 【案内開始時】
//   (0) 基準の説明
//   (1) 熱い物
//   (2) 食べてはいけない物（「食べてはいけない物があります。〜です。」）
//   (3) そのほかすべて（お盆・ジェスチャー以外の検出要素）
//
// 【再検出時】
//   ※ お盆・水・箸・ふりかけ・食べてはいけない物以外に要素がない場合：
//      「食事が終わりました。」と案内
//   ※ 食べるべき物がある場合：
//      (0) 基準の説明
//      (1) 熱い物
//      (2) 食べてはいけない物（「食べてはいけない物があります」とは言わず位置だけ）
//      (3) そのほかすべて（お盆・ジェスチャー以外の検出要素）
//
// 方向の基準は「お盆の中心」です（お盆が見つかったとき）。
// お盆が使えないときは、画像の中心（または料理全体の真ん中）を基準にします。
// ============================================================

import { SCAN } from "./config.js";



// ============================================================
// 角度と方向の計算
// ============================================================

// ------------------------------------------------------------
// 「上（食卓の奥）」を 0度として、時計回りに増える角度（0〜360）を返す
//   dx : 右にどれだけ進むか（右が＋）
//   dy : 下にどれだけ進むか（下が＋）  ※画像は下向きが＋です
// ------------------------------------------------------------
function angleFromUp(dx, dy) {

  // ※ スマホが向かい側にあるときは、上下左右を逆にする
  if (SCAN.ROTATE_180) {
    dx = -dx;
    dy = -dy;
  }

  // ※ atan2 は角度を求める関数。上向き（dyがマイナス）を 0度にするため -dy を使う
  let degrees = Math.atan2(dx, -dy) * 180 / Math.PI;

  if (degrees < 0) {
    degrees += 360;
  }

  return degrees;
}


// ------------------------------------------------------------
// 時計の方向（1〜12）を返す  例）真上 → 12、右 → 3、真下 → 6
// ------------------------------------------------------------
export function clockHour(dx, dy) {

  const degrees = angleFromUp(dx, dy);

  // ※ 30度ごとに1時間。四捨五入して 0 になったら 12 時にする
  let hour = Math.round(degrees / 30) % 12;

  if (hour === 0) {
    hour = 12;
  }

  return hour;
}


// ------------------------------------------------------------
// 数字の真ん中の値（中央値）を返す ※ 外れ値に強いので平均より安定する
// ------------------------------------------------------------
function median(numbers) {

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}



// ============================================================
// 食卓のスキャン
// ============================================================

// ------------------------------------------------------------
// 「食事終了の判定」で食べ物として数えない物かどうかを判定する
//   対象：お盆・水・箸・ふりかけ・食べてはいけない物
// ------------------------------------------------------------
function isExcludedFromRemainingFood(item) {
  if (item.inedible) return true;
  if (item.info && item.info.tray) return true;
  if (item.info && item.info.notFoodOnEnd) return true;

  const nameLower = String(item.name || "").toLowerCase();
  const jaText = String(item.ja || "");

  const excludedWords = [
    "お盆", "obon", "tray", "トレー", "トレイ", "toray",
    "水", "mizu", "water", "コップ", "cup", "お茶", "tea",
    "箸", "hasi", "hashi", "chopstick",
    "ふりかけ", "hurikake", "furikake",
  ];

  return excludedWords.some((w) => nameLower.includes(w.toLowerCase()) || jaText.includes(w));
}


// ------------------------------------------------------------
// スキャンのしくみを作る
//   addFrame(detections)          : 1フレームぶんの検出結果を渡す
//   finish(w, h, { trayExpected }) : 集計して { items, reference } を返す
//        items     : 見つかった物のリスト（方向つき。お盆・ジェスチャーは除外）
//        reference : 方向の基準点 { type, x, y, size }
//                    type = "tray"（お盆）/ "image"（画像の中心など）/ "image-fallback"
//                           （お盆のクラスはあるが、今回は見つからなかった）
// ------------------------------------------------------------
export function createScanner() {

  const frames = [];       // ※ フレームごとの「クラス名 → 検出」のメモ（お盆・ジェスチャー以外の要素）
  const trayFrames = [];   // ※ フレームごとの、お盆の検出（見つからなければ null）


  function addFrame(detections) {

    // ※ 1フレームの中で、クラスごとにいちばん自信度が高いものだけを残す
    const bestByName = new Map();
    let bestTray = null;

    for (const det of detections) {

      if (det.score < SCAN.CONF_THRESHOLD) continue;

      // --- お盆（基準点に使う。案内対象からは除外） ---
      if (det.info.kind === "tray") {
        if (bestTray === null || det.score > bestTray.score) {
          bestTray = det;
        }
        continue;
      }

      // --- ジェスチャーなどは除く（お盆・ジェスチャー以外の検出要素のみ対象） ---
      if (det.info.kind !== "item") continue;

      const old = bestByName.get(det.name);

      if (old === undefined || det.score > old.score) {
        bestByName.set(det.name, det);
      }
    }

    frames.push(bestByName);
    trayFrames.push(bestTray);
  }


  function finish(frameWidth, frameHeight, options = {}) {

    const trayExpected = options.trayExpected === true;

    // ※ 基準点の初期値：画像の真ん中
    let reference = {
      type: "image",
      x: frameWidth / 2,
      y: frameHeight / 2,
      size: Math.min(frameWidth, frameHeight),
    };

    if (frames.length === 0) {
      return { items: [], reference };
    }


    // --- クラスごとに、何回見えたか・どこにあったかを集める ---
    const records = new Map();

    for (const frame of frames) {
      for (const [name, det] of frame) {

        if (!records.has(name)) {
          records.set(name, { det: det, xs: [], ys: [] });
        }

        const record = records.get(name);
        record.xs.push(det.cx);
        record.ys.push(det.cy);
      }
    }


    // --- 見えた割合が低いものは、誤検出かもしれないので捨てる ---
    const items = [];

    for (const [name, record] of records) {

      const seenRatio = record.xs.length / frames.length;

      if (seenRatio < SCAN.MIN_SEEN_RATIO) continue;

      items.push({
        name: name,
        ja: record.det.info.ja,
        hot: Boolean(record.det.info.hot),
        inedible: Boolean(record.det.info.inedible),
        info: record.det.info,
        x: median(record.xs),
        y: median(record.ys),
      });
    }


    // --- 方向の基準点を決める ---
    const trays = trayFrames.filter((t) => t !== null);

    if (trays.length > 0 && trays.length / trayFrames.length >= SCAN.MIN_SEEN_RATIO) {

      // (a) お盆が見つかった → お盆の中心を基準にする（枠の大きさも中央値）
      const widths = trays.map((t) => t.x2 - t.x1);
      const heights = trays.map((t) => t.y2 - t.y1);

      reference = {
        type: "tray",
        x: median(trays.map((t) => t.cx)),
        y: median(trays.map((t) => t.cy)),
        size: Math.min(median(widths), median(heights)),
      };

    } else if (trayExpected) {

      // (b) お盆のクラスはあるのに、今回は見つからなかった → 画像の中心で代用
      reference.type = "image-fallback";

    } else if (SCAN.CENTER_MODE === "dishes" && items.length >= 2) {

      // (c) お盆のクラスが無いモデル → 設定どおり、料理全体の真ん中を基準にする
      reference.x = items.reduce((sum, i) => sum + i.x, 0) / items.length;
      reference.y = items.reduce((sum, i) => sum + i.y, 0) / items.length;
    }


    // --- 各物の「何時の方向」と角度を計算する ---
    for (const item of items) {

      const dx = item.x - reference.x;
      const dy = item.y - reference.y;

      item.hour = clockHour(dx, dy);
      item.angle = angleFromUp(dx, dy);

      // ※ 基準点にとても近い物は、角度が安定しないので「中央」とする
      item.center = Math.hypot(dx, dy) < SCAN.CENTER_ZONE_RATIO * reference.size;
    }

    // ※ 「中央」の物は最後に、それ以外は12時の方向から時計回りの順番に並べる
    items.sort((a, b) => (a.center - b.center) || (a.angle - b.angle));

    return { items, reference };
  }

  return { addFrame, finish };
}



// ============================================================
// 案内文章の生成（案内開始・再検出）
// ============================================================

// ------------------------------------------------------------
// スキャン結果（finish の戻り値）から、読み上げる文章（複数）を作る
//   options.isRedetect : true の場合は「再検出」のルールで文章を作る
// ------------------------------------------------------------
export function buildInitialMessages(result, options = {}) {

  const isRedetect = options.isRedetect === true;
  const { items, reference } = result;

  // ※ 再検出時：お盆・水・箸・ふりかけ・食べてはいけない物以外に要素がない場合
  if (isRedetect) {
    const remainingFoods = items.filter((item) => !isExcludedFromRemainingFood(item));
    if (remainingFoods.length === 0) {
      return ["食事が終わりました。"];
    }
  }

  // ※ 何も見つからなかったとき（カメラの向きが悪いなど）
  if (items.length === 0) {
    return [
      "何も見つかりません。カメラの位置を確認して、再検出のジェスチャーをしてください。",
    ];
  }

  const hotItems = items.filter((item) => item.hot);
  const inedibleItems = items.filter((item) => item.inedible && !item.hot);
  const otherItems = items.filter((item) => !item.hot && !item.inedible);

  // ※ 基準点にとても近い物の言い方（お盆が基準なら「お盆の中央」）
  const centerWord = reference.type === "tray" ? "お盆の中央" : "中央";

  // ※ 「味噌汁は3時の方向」のような文を作る小さな関数
  const describe = (item) => item.center
    ? `${item.ja}は${centerWord}`
    : `${item.ja}は${item.hour}時の方向`;

  const messages = [];


  // (0) 何を基準にした方向なのかを、最初に伝える
  if (reference.type === "tray") {
    messages.push("お盆の中心から見た方向でお伝えします。");
  } else if (reference.type === "image-fallback") {
    messages.push("お盆が見つかりませんでした。画面の中心から見た方向でお伝えします。");
  }


  // (1) 熱い物（いちばん先に伝える）
  if (hotItems.length > 0) {
    messages.push("熱い物があります。" + hotItems.map(describe).join("、") + "です。");
  } else if (!isRedetect) {
    messages.push("熱い物は見つかりませんでした。");
  }


  // (2) 食べてはいけない物
  //     ・案内開始時：「食べてはいけない物があります。〜です。」
  //     ・再検出時：「食べてはいけない物」とは言わず、位置だけ伝える
  if (inedibleItems.length > 0) {
    if (isRedetect) {
      messages.push(inedibleItems.map(describe).join("、") + "です。");
    } else {
      messages.push("食べてはいけない物があります。" + inedibleItems.map(describe).join("、") + "です。");
    }
  } else if (!isRedetect) {
    messages.push("食べてはいけない物は見つかりませんでした。");
  }


  // (3) そのほかすべて（お盆・ジェスチャー以外で検出できた残りの要素）
  if (SCAN.ANNOUNCE_OTHERS && otherItems.length > 0) {
    messages.push("そのほか、" + otherItems.map(describe).join("、") + "です。");
  }

  return messages;
}


// ------------------------------------------------------------
// 再検出専用のヘルパー関数
// ------------------------------------------------------------
export function buildRedetectMessages(result) {
  return buildInitialMessages(result, { isRedetect: true });
}