// ============================================================
// overlay.js ： カメラ映像の上に「検出した枠」を描くファイル
//
// ※ 枠は確認・デモ用です。音声案内には関係ありません。
// ============================================================


// ※ 種類ごとの枠の色
const COLORS = {
  item:    "#3b82f6",   // 料理              : 青
  hot:     "#ff9f0a",   // 熱い物            : だいだい色
  inedible:"#ff453a",   // 食べてはいけない物 : 赤
  tray:    "#bf5af2",   // お盆              : 紫
  gesture: "#ffd60a",   // ジェスチャー      : 黄色
  other:   "#8e8e93",   // その他            : 灰色
};


// ※ 検出結果に合わせた枠の色を返す
function colorOf(info) {

  if (info.hot) return COLORS.hot;
  if (info.inedible) return COLORS.inedible;

  return COLORS[info.kind] || COLORS.other;
}


// ------------------------------------------------------------
// 検出結果を描く
//   canvas     : 映像の上に重ねてある <canvas>
//   video      : カメラの <video>
//   detections : 検出結果の一覧
// ------------------------------------------------------------
export function drawDetections(canvas, video, detections) {

  // ※ 画面の大きさに合わせて canvas の解像度を決める（くっきり描くため devicePixelRatio をかける）
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;

  if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
  }

  const ctx = canvas.getContext("2d");

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);   // ※ 以降は CSS ピクセルで描ける
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!video.videoWidth || !video.videoHeight) {
    return;
  }


  // ※ 映像を「全体が見えるように」表示しているので、その縮尺と余白を計算する
  //    （CSS の object-fit: contain と同じ計算）
  const scale = Math.min(cssWidth / video.videoWidth, cssHeight / video.videoHeight);
  const offsetX = (cssWidth - video.videoWidth * scale) / 2;
  const offsetY = (cssHeight - video.videoHeight * scale) / 2;


  ctx.lineWidth = 2;
  ctx.font = "bold 13px -apple-system, sans-serif";
  ctx.textBaseline = "top";

  for (const det of detections) {

    const color = colorOf(det.info);

    // ※ 映像の座標 → 画面の座標
    const x = det.x1 * scale + offsetX;
    const y = det.y1 * scale + offsetY;
    const w = (det.x2 - det.x1) * scale;
    const h = (det.y2 - det.y1) * scale;

    // --- 枠 ---
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    // --- ラベル（名前と自信度） ---
    const label = `${det.info.ja} ${Math.round(det.score * 100)}%`;
    const labelWidth = ctx.measureText(label).width + 8;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, labelWidth, 18);

    ctx.fillStyle = "#000000";
    ctx.fillText(label, x + 4, y + 2);
  }
}
