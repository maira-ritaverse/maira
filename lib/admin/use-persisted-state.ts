"use client";

import { useEffect, useRef, useState } from "react";

/**
 * localStorage に状態を永続化する React hook。
 *
 * 用途:
 *   運営ダッシュボードのフィルタ / ソート / 検索条件など、画面遷移しても保持したい状態。
 *
 * 設計:
 *   - SSR / 初回 client render は常に defaultValue を返す
 *     → hydration mismatch を避けるため、localStorage は useEffect で非同期に読む
 *   - 値の更新ごとに自動で localStorage に書き戻し
 *   - JSON.parse 失敗・localStorage 不可(private mode 等)は静かにフォールバック
 *
 * 使い方:
 *   const [query, setQuery] = usePersistedState("admin-users-q", "");
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    // setState を effect 内で直接呼ばないために microtask に追い出す。
    // (react-hooks/set-state-in-effect 回避。プロジェクト共通パターン)
    void Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          setValue(JSON.parse(raw) as T);
        }
      } catch {
        // 破損 JSON / private mode 等。サイレントにフォールバック。
      }
    });
  }, [key]);

  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };

  return [value, set];
}
