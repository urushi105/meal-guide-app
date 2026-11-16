// ============================================================
// logger.js ： 動作の記録（ログ）を残して、ファイルに保存するファイル
//
// 記録するもの（種類）
//   speech  : 読み上げた文章
//   gesture : ジェスチャーの待機・実行・キャンセル
//   state   : 状態の変化（待機中 → 案内中 など）
//   button  : 手動ボタンの操作
//   detect  : 検出結果（1コマごと）。検出精度の評価に使えます
//   error   : エラー
//
// ※ 記録はスマホのメモリ上に置かれます。「データを保存する」を押すと
//    CSVファイルとして保存（共有）できます。
// ============================================================


const MAX_ROWS = 20000;       // ※ これ以上たまったら古いものから消す
const rows = [];              // ※ 記録の一覧
const startTime = Date.now(); // ※ アプリを開いた時刻



// ------------------------------------------------------------
// 1件記録する
// ------------------------------------------------------------
export function log(type, text) {

  rows.push({ time: Date.now(), type: type, text: text });

  if (rows.length > MAX_ROWS) {
    rows.shift();
  }
}


// ------------------------------------------------------------
// 記録が何件あるか
// ------------------------------------------------------------
export function logCount() {
  return rows.length;
}



// ------------------------------------------------------------
// 2桁にそろえる（5 → "05"）
// ------------------------------------------------------------
function pad(number, length = 2) {
  return String(number).padStart(length, "0");
}


// ------------------------------------------------------------
// 時刻を「2025-01-31 12:34:56.789」の形にする
// ------------------------------------------------------------
function formatTime(milliseconds) {

  const d = new Date(milliseconds);

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}


// ------------------------------------------------------------
// CSV の1マスぶんの文字にする（「"」や「,」があっても壊れないように）
// ------------------------------------------------------------
function csvCell(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}


// ------------------------------------------------------------
// ログ全体を CSV の文字にする
// ------------------------------------------------------------
function buildCsv() {

  const lines = ["日時,経過秒,種類,内容"];

  for (const row of rows) {

    const elapsed = ((row.time - startTime) / 1000).toFixed(2);

    lines.push([
      csvCell(formatTime(row.time)),
      elapsed,
      csvCell(row.type),
      csvCell(row.text),
    ].join(","));
  }

  // ※ 先頭の \uFEFF は、Excel で日本語が文字化けしないためのおまじない
  return "\uFEFF" + lines.join("\r\n");
}



// ------------------------------------------------------------
// ログをファイルとして保存する（「データを保存する」ボタンから呼ばれる）
//
//   戻り値: { count: 件数, result: "shared" / "downloaded" / "cancelled" }
// ------------------------------------------------------------
export async function saveLogFile() {

  const count = rows.length;
  const now = new Date();

  const fileName =
    `meal-guide-log-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;

  const blob = new Blob([buildCsv()], { type: "text/csv" });
  const file = new File([blob], fileName, { type: "text/csv" });


  // (1) iPhone などでは「共有シート」から「ファイルに保存」できる（こちらを優先）
  if (navigator.canShare && navigator.canShare({ files: [file] })) {

    try {
      await navigator.share({ files: [file], title: fileName });
      return { count, result: "shared" };

    } catch (error) {

      // ※ 共有シートを閉じた（キャンセルした）だけなら、エラーではない
      if (error && error.name === "AbortError") {
        return { count, result: "cancelled" };
      }

      console.warn("[ログ] 共有に失敗。ダウンロードに切り替えます:", error);
    }
  }


  // (2) 共有が使えないときは、ダウンロードリンクで保存する
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { count, result: "downloaded" };
}
