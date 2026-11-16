// ============================================================
// camera.js ： カメラを動かすファイル
//
// やること
//   ・背面カメラを起動して <video> に映す
//   ・倍率（0.5〜1.0）を変える
//
// ※ 倍率の変え方は端末によって違うため、次の順番で試します
//     (1) ハードウェアズーム（対応している端末のみ）
//     (2) 超広角レンズ ⇔ 通常レンズ の切り替え
//     (3) どちらもできない → 倍率は変えられない
// ============================================================


let videoElement = null;       // 映像を表示する <video>
let stream = null;             // カメラの映像そのもの
let currentDeviceId = null;    // いま使っているカメラの ID
let zoomMode = "unknown";      // "hardware" / "lens" / "unsupported" / "unknown"
let switching = false;         // カメラ切り替え中かどうか



// ------------------------------------------------------------
// カメラの映像を開く（内部用）
// ------------------------------------------------------------
async function openStream(videoConstraints) {

  // ※ 前の映像が残っていたら止める
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints,
  });

  videoElement.srcObject = stream;
  await videoElement.play();

  const track = stream.getVideoTracks()[0];
  currentDeviceId = track.getSettings().deviceId || null;
}


// ※ 解像度のお願い（実際の大きさは端末が決めます）
function baseConstraints() {
  return {
    width:  { ideal: 1280 },
    height: { ideal: 720 },
  };
}



// ------------------------------------------------------------
// カメラを起動する
// ------------------------------------------------------------
export async function startCamera(video) {

  videoElement = video;

  // ※ 背面カメラ（environment）をお願いする
  await openStream({
    facingMode: { ideal: "environment" },
    ...baseConstraints(),
  });
}


// ------------------------------------------------------------
// カメラを起動し直す（アプリを閉じて戻ったときなどに使う）
// ------------------------------------------------------------
export async function restartCamera() {
  await openStream({
    facingMode: { ideal: "environment" },
    ...baseConstraints(),
  });
}


// ------------------------------------------------------------
// 映像が使える状態かどうか
// ------------------------------------------------------------
export function isReady() {

  return (
    videoElement !== null &&
    !switching &&
    videoElement.readyState >= 2 &&
    videoElement.videoWidth > 0
  );
}


// ------------------------------------------------------------
// 倍率の変え方（"hardware" / "lens" / "unsupported"）を返す
// ------------------------------------------------------------
export function getZoomMode() {
  return zoomMode;
}



// ------------------------------------------------------------
// レンズを切り替える（超広角 ⇔ 通常）
//   wantUltra = true なら超広角、false なら通常レンズ
//   戻り値: 切り替えできた(または既にそのレンズ)なら true
// ------------------------------------------------------------
async function switchLens(wantUltra) {

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === "videoinput");

  console.log("[カメラ一覧]", cameras.map((c) => c.label));

  // ※ カメラ名（label）から、レンズの種類を推測する
  const isUltra = (label) => /ultra|超広角/i.test(label);
  const isTele  = (label) => /tele|望遠/i.test(label);
  const isFront = (label) => /front|user|前面|フロント/i.test(label);

  let target = null;

  if (wantUltra) {

    target = cameras.find((c) => isUltra(c.label));

  } else {

    // ※ まず「Back Camera」「背面カメラ」という名前ぴったりのものを探す
    target = cameras.find((c) => /^(back camera|背面カメラ)$/i.test(c.label.trim()));

    // ※ なければ、超広角・望遠・前面以外の背面カメラを探す
    if (!target) {
      target = cameras.find((c) =>
        /back|rear|背面|environment/i.test(c.label) &&
        !isUltra(c.label) && !isTele(c.label) && !isFront(c.label)
      );
    }
  }

  // ※ 目的のレンズが見つからなかった
  if (!target) {
    return false;
  }

  // ※ すでにそのレンズを使っているなら何もしない
  if (target.deviceId === currentDeviceId) {
    return true;
  }

  // ※ カメラを開き直す（この間、検出は止まる）
  switching = true;

  try {
    await openStream({
      deviceId: { exact: target.deviceId },
      ...baseConstraints(),
    });
  } finally {
    switching = false;
  }

  return true;
}



// ------------------------------------------------------------
// 倍率を設定する（0.5〜1.0）
//   戻り値: どの方法で変えられたか（"hardware" / "lens" / "unsupported"）
// ------------------------------------------------------------
export async function setZoom(value) {

  if (!stream) {
    return zoomMode;
  }

  const track = stream.getVideoTracks()[0];
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};


  // (1) ハードウェアズーム
  //     ※ 端末が「zoom」に対応していて、希望の倍率が範囲内のとき
  if (capabilities.zoom && value >= capabilities.zoom.min - 0.001) {

    const zoom = Math.min(Math.max(value, capabilities.zoom.min), capabilities.zoom.max);

    try {
      await track.applyConstraints({ advanced: [{ zoom: zoom }] });
      zoomMode = "hardware";
      return zoomMode;
    } catch (error) {
      console.warn("[カメラ] ズームの設定に失敗:", error);
    }
  }


  // (2) レンズの切り替え
  //     ※ 0.75 より小さい倍率なら超広角、それ以外は通常レンズ
  try {
    const switched = await switchLens(value < 0.75);
    zoomMode = switched ? "lens" : "unsupported";
  } catch (error) {
    console.warn("[カメラ] レンズの切り替えに失敗:", error);
    zoomMode = "unsupported";
  }

  return zoomMode;
}
