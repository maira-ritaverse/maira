/**
 * 音声 / 動画ファイルのクライアント側プリフライトチェック
 *
 * サーバー処理を呼び出す前に、ブラウザで素早く判定して無駄なアップロードを防ぐ。
 * - サイズ上限
 * - MIME / 拡張子の対応確認
 * - メタデータ読み込みで推定再生時間を取得
 * - 推奨範囲(60 秒以上、25 MiB 未満)外なら警告
 *
 * 注意:duration の取得は HTMLMediaElement のメタデータ読み込みに依存し、
 * 一部の MP4 / WebM では失敗する。失敗時は duration=null を返し、
 * 呼び出し側は「警告のみで先に進める」フォールバックを取れるようにする。
 */

export const PREFLIGHT_MAX_BYTES = 25 * 1024 * 1024;
export const PREFLIGHT_MIN_DURATION_SECONDS = 30;
export const PREFLIGHT_RECOMMENDED_MIN_DURATION_SECONDS = 60;

export const PREFLIGHT_ALLOWED_MIME = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const PREFLIGHT_ALLOWED_EXT = [
  "mp3",
  "wav",
  "webm",
  "m4a",
  "mp4",
  "ogg",
  "flac",
  "mov",
] as const;

export type PreflightLevel = "blocking" | "warning";

export type PreflightIssue = {
  level: PreflightLevel;
  code:
    | "too_large"
    | "unsupported_format"
    | "too_short"
    | "below_recommended_duration"
    | "duration_unknown";
  message: string;
};

export type PreflightResult = {
  ok: boolean; // blocking issue なし
  durationSeconds: number | null;
  issues: PreflightIssue[];
};

/**
 * 同期的にチェック:サイズ / MIME / 拡張子。
 */
function quickCheck(file: File): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (file.size > PREFLIGHT_MAX_BYTES) {
    issues.push({
      level: "blocking",
      code: "too_large",
      message: `ファイルが大きすぎます(最大 ${PREFLIGHT_MAX_BYTES / 1024 / 1024} MiB)`,
    });
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const mimeOk = file.type
    ? PREFLIGHT_ALLOWED_MIME.includes(file.type as (typeof PREFLIGHT_ALLOWED_MIME)[number])
    : false;
  const extOk = PREFLIGHT_ALLOWED_EXT.includes(ext as (typeof PREFLIGHT_ALLOWED_EXT)[number]);
  // ブラウザによっては file.type が空(特に Safari の MOV)。拡張子で救う。
  if (!mimeOk && !extOk) {
    issues.push({
      level: "blocking",
      code: "unsupported_format",
      message: `非対応のファイル形式です(MIME: ${file.type || "不明"} / 拡張子: ${ext})`,
    });
  }
  return issues;
}

/**
 * 推定再生時間を取得(できれば)。
 * SSR / Node 環境では使えないので、呼び出し側はブラウザ環境で呼ぶこと。
 */
async function probeDuration(file: File): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const isVideo = (file.type ?? "").startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
    const el = document.createElement(isVideo ? "video" : "audio") as
      | HTMLAudioElement
      | HTMLVideoElement;
    el.preload = "metadata";
    return await new Promise<number | null>((resolve) => {
      const onMetadata = () => {
        const d = el.duration;
        resolve(Number.isFinite(d) ? d : null);
      };
      const onError = () => resolve(null);
      el.addEventListener("loadedmetadata", onMetadata, { once: true });
      el.addEventListener("error", onError, { once: true });
      // 一部ブラウザは load() を明示しないと metadata が来ない
      el.src = url;
      el.load();
      // セーフティネット:5 秒で諦める
      setTimeout(() => resolve(null), 5000);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * メイン:File に対してプリフライトチェックを実行。
 * 結果には blocking / warning レベルの issues が含まれる。
 */
export async function preflightAudioFile(file: File): Promise<PreflightResult> {
  const issues = quickCheck(file);

  // blocking が無ければ duration も見る
  let durationSeconds: number | null = null;
  if (!issues.some((i) => i.level === "blocking")) {
    durationSeconds = await probeDuration(file);
    if (durationSeconds === null) {
      issues.push({
        level: "warning",
        code: "duration_unknown",
        message:
          "ファイルの再生時間が判定できませんでした。" +
          "短すぎる音声は精度が落ちる場合があります。",
      });
    } else if (durationSeconds < PREFLIGHT_MIN_DURATION_SECONDS) {
      issues.push({
        level: "blocking",
        code: "too_short",
        message: `音声が短すぎます(${Math.round(durationSeconds)} 秒、最低 ${PREFLIGHT_MIN_DURATION_SECONDS} 秒)`,
      });
    } else if (durationSeconds < PREFLIGHT_RECOMMENDED_MIN_DURATION_SECONDS) {
      issues.push({
        level: "warning",
        code: "below_recommended_duration",
        message: `音声が短めです(${Math.round(durationSeconds)} 秒)。${PREFLIGHT_RECOMMENDED_MIN_DURATION_SECONDS} 秒以上を推奨します。`,
      });
    }
  }

  return {
    ok: !issues.some((i) => i.level === "blocking"),
    durationSeconds,
    issues,
  };
}
