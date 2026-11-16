// ============================================================
// gesture.js ： 指数字ジェスチャーを判定するファイル
//
// 動き方
//   1. ジェスチャーが見つかる（数フレーム続けて）
//   2. 動作ごとに決めた時間（config.js の GESTURE.HOLD_MS）だけ見え続けたら実行
//        案内開始・案内終了 … 3秒。「3秒後に○○します」と知らせて数え始める
//        再検出           … 0秒。見つけたらすぐ実行（開始から終了まで何回でも使える）
//   3. 数えている途中で見えなくなったら（1秒以上）
//        → キャンセルする
//   4. 実行したら、いったん手を下ろすまで同じジェスチャーは受け付けない
//
// ※ このファイルは「画面」や「音声」には関係しません。
//    結果は onPending / onCancel / onFire という「お知らせ関数」で
//    app.js に伝えます。
// ============================================================

import { GESTURE } from "./config.js";


// ------------------------------------------------------------
// ジェスチャー判定のしくみを作る
//
//   isAllowed(action) : 今の状態で、その動作を受け付けてよいか
//   onPending(info)   : 3秒の待機が始まったとき
//   onCancel(info, reason) : キャンセルされたとき（reason = "lost" か "changed"）
//   onFire(info)      : 3秒たって実行するとき
// ------------------------------------------------------------
export function createGestureEngine({ isAllowed, onPending, onCancel, onFire }) {

  let candidate = null;    // ※ 見え始めたが、まだ確定していないもの
  let pending = null;      // ※ 確定して、3秒待っているもの
  let cooldownUntil = 0;   // ※ この時刻までは新しいジェスチャーを受け付けない

  // ※ 実行したジェスチャー。手を下ろすまで、同じジェスチャーは受け付けない
  //    （手を上げっぱなしで、何度も実行されてしまうのを防ぐ）
  let waitingRelease = null;
  let releaseFrames = 0;     // ※ ジェスチャーが連続で見えなかったフレーム数


  // ----------------------------------------------------------
  // 検出結果の中から「いちばん自信度の高いジェスチャー」を探す
  // ----------------------------------------------------------
  function findBestGesture(detections) {

    let best = null;

    for (const det of detections) {

      // ※ ジェスチャー以外、自信度が低いもの、動作が未定義のもの（4本・5本など）は無視
      if (det.info.kind !== "gesture") continue;
      if (det.score < GESTURE.CONF_THRESHOLD) continue;
      if (det.info.action === null) continue;

      if (best === null || det.score > best.score) {
        best = {
          action: det.info.action,
          number: det.info.gestureNumber,
          score: det.score,
        };
      }
    }

    return best;
  }


  // ----------------------------------------------------------
  // 検出結果が届くたびに呼ばれる（now は現在時刻・ミリ秒）
  // ----------------------------------------------------------
  function update(detections, now) {

    // ※ 実行した直後は、しばらくジェスチャーを受け付けない
    if (now < cooldownUntil) {
      candidate = null;
      return;
    }

    const seen = findBestGesture(detections);


    // ========== 実行した直後：手を下ろすのを待っている ==========
    if (waitingRelease !== null) {

      if (seen === null) {

        // ※ ジェスチャーが見えない状態が続いたら「手を下ろした」とみなす
        releaseFrames += 1;

        if (releaseFrames >= GESTURE.RELEASE_FRAMES) {
          waitingRelease = null;
          releaseFrames = 0;
        }

        candidate = null;
        return;
      }

      releaseFrames = 0;

      // ※ まだ同じジェスチャーを出したまま → 無視する
      if (seen.action === waitingRelease) {
        candidate = null;
        return;
      }

      // ※ 別のジェスチャーに変わった → 受け付ける
      waitingRelease = null;
    }


    // ========== 3秒待っている最中 ==========
    if (pending !== null) {

      if (seen !== null && seen.action === pending.action) {

        // ※ 同じジェスチャーが見えている → 見えた時刻を更新
        pending.lastSeenAt = now;

        // ※ 3秒たったら実行する
        if (now - pending.startedAt >= pending.holdMs) {

          const fired = pending;

          pending = null;
          candidate = null;
          cooldownUntil = now + GESTURE.COOLDOWN_MS;
          waitingRelease = fired.action;
          releaseFrames = 0;

          onFire(fired);
        }

      } else if (seen !== null && seen.action !== pending.action) {

        // ※ 別のジェスチャーに変わった → 前のものはキャンセル
        const old = pending;

        pending = null;
        candidate = { action: seen.action, frames: 1 };

        onCancel(old, "changed");

      } else if (now - pending.lastSeenAt > GESTURE.LOST_MS) {

        // ※ ジェスチャーが見えなくなって1秒以上たった → キャンセル
        const old = pending;

        pending = null;
        candidate = null;

        onCancel(old, "lost");
      }

      return;
    }


    // ========== まだ待っていないとき ==========
    if (seen === null) {
      candidate = null;
      return;
    }

    // ※ 同じジェスチャーが何フレーム続けて見えたか数える
    if (candidate !== null && candidate.action === seen.action) {
      candidate.frames += 1;
    } else {
      candidate = { action: seen.action, frames: 1 };
    }

    // ※ 規定のフレーム数続いて、いまの状態で受け付けてよい動作なら、実行（または待機）へ進む
    if (candidate.frames >= GESTURE.START_FRAMES && isAllowed(seen.action)) {

      // ※ この動作を、何ミリ秒見せ続けたら実行するか（決まっていなければ3秒）
      const holdMs = GESTURE.HOLD_MS[seen.action] !== undefined ? GESTURE.HOLD_MS[seen.action] : 3000;

      // --- 待たずに、すぐ実行する動作（再検出） ---
      if (holdMs <= 0) {

        candidate = null;
        cooldownUntil = now + GESTURE.COOLDOWN_MS;
        waitingRelease = seen.action;    // ※ 手を下ろすまで、同じものは受け付けない
        releaseFrames = 0;

        onFire({ action: seen.action, number: seen.number, startedAt: now, lastSeenAt: now });
        return;
      }

      // --- 数秒見せ続けてから実行する動作（案内開始・案内終了） ---
      pending = {
        action: seen.action,
        number: seen.number,
        holdMs: holdMs,
        startedAt: now,
        lastSeenAt: now,
      };

      onPending(pending);
    }
  }


  // ----------------------------------------------------------
  // 待機中の状態をすべて消す（ボタンで操作したときなどに使う）
  // ----------------------------------------------------------
  function reset() {
    candidate = null;
    pending = null;
  }


  // ※ 外から使う関数をまとめて返す
  return { update, reset };
}
