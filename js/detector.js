// ============================================================
// detector.js ： 物体検出（YOLO）を行うファイル
//
// 流れ
//   1. モデル(ONNXファイル)を読み込む         → loadModel()
//   2. カメラ画像をモデルに入れられる形に変換する（前処理）
//   3. モデルで推論する
//   4. 結果を「枠・クラス名・自信度」に直す（後処理）
//                                              → detect()
//
// ※ 今後 YOLO 以外のモデルを使うときは、このファイルと同じ形
//    （loadModel と detect を持つファイル）を作って、
//    app.js の import を差し替えれば入れ替えられます。
// ============================================================

import { MODEL } from "./config.js";
import { describeClass } from "./classes.js";


// ※ lib/ort.wasm.min.js を読み込むと、ort という名前で使えるようになる
const ort = window.ort;


// ※ モデルの情報（loadModel で入れる）
let session = null;          // 推論を行うもの
let classNames = [];         // クラス名の一覧
let inputWidth = MODEL.INPUT_SIZE;
let inputHeight = MODEL.INPUT_SIZE;

// ※ 前処理用の「作業用の画像」
let workCanvas = null;
let workContext = null;



// ------------------------------------------------------------
// ONNXファイルの終わりの部分から、クラス名と画像サイズを読み取る
//
// ※ YOLO を ONNX に変換すると、クラス名が
//    "{0: 'miso_soup', 1: 'rice'}" のような文字でファイルの末尾に入っています。
//    それを取り出して使います。
// ------------------------------------------------------------
function readMetadata(arrayBuffer) {

  // ※ ファイルの最後の100KBだけ文字にする（全部だと重いため）
  const tailSize = Math.min(arrayBuffer.byteLength, 100000);
  const tailBytes = new Uint8Array(arrayBuffer, arrayBuffer.byteLength - tailSize, tailSize);
  const text = new TextDecoder("utf-8").decode(tailBytes);

  const result = { names: null, imgsz: null };


  // --- クラス名 ---
  const nameBlocks = [...text.matchAll(/names[^{]{0,12}(\{[^}]*\})/g)];

  if (nameBlocks.length > 0) {

    // ※ 一番最後に見つかったものを使う
    const block = nameBlocks[nameBlocks.length - 1][1];

    const entries = [...block.matchAll(/(\d+)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)];
    const names = [];

    for (const entry of entries) {
      const index = Number(entry[1]);
      names[index] = entry[2] !== undefined ? entry[2] : entry[3];
    }

    // ※ 番号が飛んでいない（0,1,2,...と続いている）ときだけ採用
    if (names.length > 0 && names.every((n) => n !== undefined)) {
      result.names = names;
    }
  }


  // --- 画像サイズ（[高さ, 幅]） ---
  const sizeBlocks = [...text.matchAll(/imgsz[^\[]{0,12}\[\s*(\d+)\s*,\s*(\d+)\s*\]/g)];

  if (sizeBlocks.length > 0) {
    const last = sizeBlocks[sizeBlocks.length - 1];
    result.imgsz = { height: Number(last[1]), width: Number(last[2]) };
  }

  return result;
}



// ------------------------------------------------------------
// ONNX Runtime（物体検出を動かす部品）の準備をする
//
// ※ lib フォルダの「ort-wasm-simd-threaded.mjs」は、サーバーによっては
//    正しい種類（JavaScript）として配信されず、読み込みに失敗することがあります
//    （Windows の python -m http.server などで起こります）。
//    そこで、いったん文字として取得し、JavaScript の部品として自分で渡します。
//    こうすると、サーバーの設定に関係なく動きます。
// ------------------------------------------------------------
async function prepareRuntime() {

  const libFolder = new URL("../lib/", import.meta.url).href;

  // --- .mjs ファイルを取得する ---
  const response = await fetch(libFolder + "ort-wasm-simd-threaded.mjs");

  if (!response.ok) {
    throw new Error(
      `lib/ort-wasm-simd-threaded.mjs が見つかりません（${response.status}）。` +
      `lib フォルダの中身を確認してください。`
    );
  }

  const code = await response.text();

  // --- 「これは JavaScript です」という印を付けて、ブラウザに渡せる形にする ---
  const blob = new Blob([code], { type: "text/javascript" });

  ort.env.wasm.numThreads = 1;   // ※ 1スレッドで動かす（特別なサーバー設定が不要）

  ort.env.wasm.wasmPaths = {
    mjs:  URL.createObjectURL(blob),                          // ※ 読み込み用の部品
    wasm: libFolder + "ort-wasm-simd-threaded.wasm",          // ※ 本体
  };
}



// ------------------------------------------------------------
// モデルを読み込む
// ------------------------------------------------------------
export async function loadModel() {

  // ※ ONNX Runtime の設定
  await prepareRuntime();

  // ※ モデルファイルをダウンロードする
  const response = await fetch(MODEL.PATH);

  if (!response.ok) {
    throw new Error(`モデルファイルが見つかりません（${MODEL.PATH}）。model フォルダに last.onnx を置いてください。`);
  }

  const arrayBuffer = await response.arrayBuffer();


  // ※ クラス名と画像サイズを読み取る
  const meta = readMetadata(arrayBuffer);

  classNames = meta.names ? meta.names : MODEL.FALLBACK_CLASS_NAMES;

  if (meta.imgsz) {
    inputWidth = meta.imgsz.width;
    inputHeight = meta.imgsz.height;
  }

  console.log("[モデル] クラス名:", classNames, meta.names ? "(ファイルから取得)" : "(config.js の予備リスト)");
  console.log("[モデル] 入力サイズ:", inputWidth, "x", inputHeight);


  // ※ 推論の準備をする
  session = await ort.InferenceSession.create(new Uint8Array(arrayBuffer), {
    executionProviders: ["wasm"],
  });


  // ※ 前処理用の作業画像を作る
  workCanvas = document.createElement("canvas");
  workCanvas.width = inputWidth;
  workCanvas.height = inputHeight;
  workContext = workCanvas.getContext("2d", { willReadFrequently: true });

  return { classNames, inputWidth, inputHeight };
}



// ------------------------------------------------------------
// 前処理：カメラ画像 → モデルに入れる数字の並び
//
// ※ 縦横比を保ったまま、灰色の余白(レターボックス)を付けて
//    正方形に収めます。YOLO の学習時と同じやり方です。
// ------------------------------------------------------------
function preprocess(video) {

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;

  // ※ 縮小の倍率（はみ出さないように小さい方に合わせる）
  const scale = Math.min(inputWidth / videoWidth, inputHeight / videoHeight);

  const drawWidth = Math.round(videoWidth * scale);
  const drawHeight = Math.round(videoHeight * scale);

  // ※ 余白の大きさ（左右・上下）
  const padX = (inputWidth - drawWidth) / 2;
  const padY = (inputHeight - drawHeight) / 2;


  // ※ 灰色で塗りつぶしてから、カメラ画像を縮小して描く
  workContext.fillStyle = "rgb(114,114,114)";
  workContext.fillRect(0, 0, inputWidth, inputHeight);
  workContext.drawImage(video, 0, 0, videoWidth, videoHeight, padX, padY, drawWidth, drawHeight);

  // ※ 画素の値を取り出す（R,G,B,A,R,G,B,A,... の並び）
  const pixels = workContext.getImageData(0, 0, inputWidth, inputHeight).data;


  // ※ モデルが欲しい並び（R全部 → G全部 → B全部、0〜1の小数）に直す
  const area = inputWidth * inputHeight;
  const input = new Float32Array(3 * area);

  for (let i = 0; i < area; i++) {
    input[i]            = pixels[i * 4]     / 255;   // R
    input[area + i]     = pixels[i * 4 + 1] / 255;   // G
    input[2 * area + i] = pixels[i * 4 + 2] / 255;   // B
  }

  return { input, scale, padX, padY, videoWidth, videoHeight };
}



// ------------------------------------------------------------
// 2つの枠の「重なり具合」(IoU) を計算する
// ------------------------------------------------------------
function iou(a, b) {

  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);

  const overlapWidth = Math.max(0, x2 - x1);
  const overlapHeight = Math.max(0, y2 - y1);
  const overlapArea = overlapWidth * overlapHeight;

  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);

  return overlapArea / (areaA + areaB - overlapArea + 1e-9);
}



// ------------------------------------------------------------
// NMS：同じ物に重なった枠を、自信度の高い1つだけ残す
// ------------------------------------------------------------
function nonMaxSuppression(boxes) {

  // ※ 自信度が高い順に並べる
  boxes.sort((a, b) => b.score - a.score);

  const kept = [];

  for (const box of boxes) {

    let overlapped = false;

    for (const k of kept) {
      // ※ 同じクラスどうしで、強く重なっていたら捨てる
      if (k.classId === box.classId && iou(k, box) > MODEL.IOU_THRESHOLD) {
        overlapped = true;
        break;
      }
    }

    if (!overlapped) {
      kept.push(box);
    }
  }

  return kept;
}



// ------------------------------------------------------------
// 後処理：モデルの出力 → 枠のリスト
// ------------------------------------------------------------
function postprocess(outputTensor, pre) {

  const data = outputTensor.data;
  const dims = outputTensor.dims;      // 例: [1, 12, 8400]  → 12 = 4(枠) + 8(クラス数)

  // ※ 出力の並びには2種類ある。数が少ない方が「項目数」
  const channelsFirst = dims[1] < dims[2];
  const featureCount = channelsFirst ? dims[1] : dims[2];
  const boxCount     = channelsFirst ? dims[2] : dims[1];
  const classCount   = featureCount - 4;

  // ※ クラスの数が合わないときは、分かりやすいエラーにする
  if (classCount !== classNames.length) {
    throw new Error(
      `モデルのクラス数(${classCount})と、クラス名の数(${classNames.length})が合いません。` +
      `config.js の FALLBACK_CLASS_NAMES を確認してください。`
    );
  }

  // ※ 「項目 f の n 番目の値」を取り出す小さな関数
  const value = channelsFirst
    ? (f, n) => data[f * boxCount + n]
    : (f, n) => data[n * featureCount + f];


  const candidates = [];

  for (let n = 0; n < boxCount; n++) {

    // ※ いちばん自信度の高いクラスを探す
    let bestClass = 0;
    let bestScore = 0;

    for (let c = 0; c < classCount; c++) {
      const s = value(4 + c, n);
      if (s > bestScore) {
        bestScore = s;
        bestClass = c;
      }
    }

    // ※ 自信度が低いものは捨てる
    if (bestScore < MODEL.CONF_THRESHOLD) {
      continue;
    }

    // ※ 枠は「中心x, 中心y, 幅, 高さ」で出てくる（モデル入力画像の座標）
    const cx = value(0, n);
    const cy = value(1, n);
    const w  = value(2, n);
    const h  = value(3, n);

    // ※ モデル入力の座標 → 元のカメラ画像の座標に戻す（余白と縮小を取り消す）
    let x1 = (cx - w / 2 - pre.padX) / pre.scale;
    let y1 = (cy - h / 2 - pre.padY) / pre.scale;
    let x2 = (cx + w / 2 - pre.padX) / pre.scale;
    let y2 = (cy + h / 2 - pre.padY) / pre.scale;

    // ※ 画像の外にはみ出した部分は切り取る
    x1 = Math.max(0, Math.min(pre.videoWidth, x1));
    x2 = Math.max(0, Math.min(pre.videoWidth, x2));
    y1 = Math.max(0, Math.min(pre.videoHeight, y1));
    y2 = Math.max(0, Math.min(pre.videoHeight, y2));

    if (x2 - x1 < 2 || y2 - y1 < 2) {
      continue;
    }

    candidates.push({ classId: bestClass, score: bestScore, x1, y1, x2, y2 });
  }


  // ※ 候補が多すぎると重いので、自信度の高い 100 個までにする
  candidates.sort((a, b) => b.score - a.score);
  const limited = candidates.slice(0, 100);

  const kept = nonMaxSuppression(limited);


  // ※ 使いやすいように、名前・中心・意味(info)を付け足す
  return kept.map((box) => {
    const name = classNames[box.classId];
    return {
      classId: box.classId,
      name: name,
      score: box.score,
      x1: box.x1,
      y1: box.y1,
      x2: box.x2,
      y2: box.y2,
      cx: (box.x1 + box.x2) / 2,
      cy: (box.y1 + box.y2) / 2,
      info: describeClass(name),
    };
  });
}



// ------------------------------------------------------------
// カメラ映像 1 コマ分を検出する（app.js から呼ばれる）
//   戻り値: { detections, frameWidth, frameHeight, ms }
// ------------------------------------------------------------
export async function detect(video) {

  const startTime = performance.now();

  const pre = preprocess(video);

  // ※ モデルに入れる形（1枚, 3色, 高さ, 幅）にする
  const tensor = new ort.Tensor("float32", pre.input, [1, 3, inputHeight, inputWidth]);

  // ※ 推論を実行する
  const inputName = session.inputNames[0];
  const outputs = await session.run({ [inputName]: tensor });
  const outputTensor = outputs[session.outputNames[0]];

  const detections = postprocess(outputTensor, pre);

  return {
    detections,
    frameWidth: pre.videoWidth,
    frameHeight: pre.videoHeight,
    ms: Math.round(performance.now() - startTime),
  };
}
