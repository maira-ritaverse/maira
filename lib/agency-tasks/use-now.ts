/**
 * 現在時刻を 5 分ごとに更新する React hook。
 *
 * 期限色分け・期限超過バッジなど「時間と共に判定が変わる UI」用の共通時計。
 *
 * useSyncExternalStore を使う理由:
 *   - SSR の null と マウント直後の Date の差し替えを React が正しく扱える
 *     (hydration mismatch を回避)
 *   - useEffect 内で同期 setState を呼ぶ react-hooks/set-state-in-effect 警告を避ける
 *
 * 仕様:
 *   - SSR 時:null(server snapshot)→ 呼び出し側は「色なし/バッジなし」で描画
 *   - マウント後:Date が返る(client snapshot)
 *   - 5 分(300_000ms)ごとに更新。タスク超過の境界を分単位で検知できれば十分
 *
 * clientNow をモジュールスコープで保持して getSnapshot の参照同一性を担保する。
 * (毎回 new Date() を返すと useSyncExternalStore が無限ループ警告を出す)
 */

import { useSyncExternalStore } from "react";

let clientNow: Date = new Date();

function subscribeNow(callback: () => void): () => void {
  const id = setInterval(
    () => {
      clientNow = new Date();
      callback();
    },
    5 * 60 * 1000,
  );
  return () => clearInterval(id);
}

function getClientSnapshot(): Date {
  return clientNow;
}

function getServerSnapshot(): null {
  return null;
}

export function useNow(): Date | null {
  return useSyncExternalStore(subscribeNow, getClientSnapshot, getServerSnapshot);
}
