/**
 * LIFF (LINE Front-end Framework) SDK の 型 定義 (使用部分集合)。
 *
 * 公式: https://developers.line.biz/ja/reference/liff/
 *
 * 全 LIFF 仕様 を 型化 する のは 重い ので、 Myaira で 使う 関数 だけ を 定義。
 * window.liff グローバル を 複数 コンポーネント で 共有する ため、
 * 型 宣言 を 1 箇所 に 集約 (重複 declare global 警告 を 防ぐ)。
 */

export type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};

export type LiffGlobal = {
  init: (config: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (opts?: { redirectUri?: string }) => void;
  logout: () => void;
  getProfile: () => Promise<LiffProfile>;
  getIDToken: () => string | null;
  isInClient: () => boolean;
  closeWindow: () => void;
};

declare global {
  interface Window {
    liff?: LiffGlobal;
  }
}
