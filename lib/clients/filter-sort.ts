/**
 * クライアント一覧の絞り込み + 並び替えの純関数。
 *
 * ClientsTable コンポーネントから抽出し、副作用ゼロでテスト可能に。
 * 検索・ステータス・エントリーサイトの 3 軸絞り込みと、3 列ソートをサポート。
 *
 * 設計方針:
 *   - 入力配列は破壊しない(slice してから sort)
 *   - 部分一致検索は大文字小文字を無視(toLowerCase 比較)
 *   - エントリーサイトの "unset" は entrySite が null / 空 / 空白のみのレコードに一致
 *   - 名前ソートは "ja" ロケールで自然順(漢字 / かな / カナ混在に対応)
 */

import type { ClientEmploymentType, ClientStatus } from "./types";

/**
 * ソート対応カラム(全 13 列)。column-config の SORTABLE_COLUMNS と同期。
 * 並び替えは applyClientsFilterSort の compareByColumn で実装。
 */
export type SortColumn =
  | "name"
  | "nameKana"
  | "email"
  | "phone"
  | "prefecture"
  | "employmentType"
  | "status"
  | "applicationStatus"
  | "linkStatus"
  | "maStatus"
  | "assignee"
  | "nextMeeting"
  | "receivedAt"
  | "createdAt";
export type SortDirection = "asc" | "desc";
export type StatusFilter = ClientStatus | "all";

/**
 * 絞り込み + 並び替えに必要な最小フィールド。
 *
 * EMPRO 拡張(マイグレーション 20260615100001)で nameKana / prefecture /
 * currentEmploymentType の 3 フィールドを追加した。検索 / 絞り込みのキーになる
 * ため、ここに含める。テスト fixture も追従。
 */
export type ClientForFilterSort = {
  name: string;
  email: string | null;
  status: ClientStatus;
  createdAt: string;
  entrySite: string | null;
  // EMPRO 拡張
  nameKana: string | null;
  prefecture: string | null;
  currentEmploymentType: ClientEmploymentType | null;
  // 沈黙顧客アラート用(最後に client_interactions に占めた occurred_at の最大)。
  // null = まだ対応履歴なし。lastInteractionAt ?? createdAt を「最終アクション」とみなす。
  lastInteractionAt: string | null;
  /** 次の Web 面談予約(meeting_schedules.starts_at の最小値)。null = 予約なし。 */
  nextMeetingAt?: string | null;
  // CRM 自由タグ(20260615140001)。空配列で「タグ無し」、null は無い契約。
  crmTags: string[];
  // ── 全列ソート対応のため拡張(optional + null 許容で既存テスト互換) ─────
  /** 電話番号(ソート用、列表示にも使用) */
  phone?: string | null;
  /** 連携状態 */
  linkStatus?: string;
  /** MA(メール配信)許可フラグ */
  emailDistributionEnabled?: boolean;
  /** 担当者表示名 */
  assigneeName?: string | null;
  /** 受付日(intake_date) */
  intakeDate?: string | null;
  /** 推薦進捗(referralBreakdown)— 合計件数を比較に使う */
  referralBreakdown?: { total: number };
};

/**
 * 沈黙(対応からの経過日数)フィルタ。"all" は絞らない。
 * 値は閾値(日数)で、lastInteractionAt ?? createdAt から N 日以上経過しているレコードを残す。
 * "never" は lastInteractionAt が null の(一度も対応していない)レコードのみ残す。
 */
export type SilenceFilter = "all" | "14d" | "30d" | "60d" | "90d" | "never";

const SILENCE_DAYS: Record<Exclude<SilenceFilter, "all" | "never">, number> = {
  "14d": 14,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

export type FilterSortOptions = {
  searchQuery: string;
  statusFilter: StatusFilter;
  /** "all" は絞らない、"unset" は entrySite が null/空/空白扱い、その他は完全一致 */
  entrySiteFilter: string;
  /** EMPRO 拡張:"all" は絞らない、"unset" は prefecture が null/空、その他は完全一致 */
  prefectureFilter: string;
  /** EMPRO 拡張:"all" は絞らない、"unset" は null、その他は ClientEmploymentType の値で完全一致 */
  employmentTypeFilter: string;
  /**
   * 沈黙顧客アラート(CRM 機能)。"all" は絞らない。
   * "14d"/"30d"/"60d"/"90d" は (now - (lastInteractionAt ?? createdAt)) >= N 日 のレコードを残す。
   * "never" は lastInteractionAt が null のレコードのみ。
   */
  silenceFilter?: SilenceFilter;
  /**
   * 沈黙判定の現在時刻(epoch ms)。silenceFilter が "all" 以外なら必須。
   * テストで決定論性を保つために呼び出し側から渡す(Date.now を内部で呼ばない)。
   */
  now?: number;
  /**
   * CRM 自由タグでの絞り込み(AND 条件)。空配列または undefined は絞らない。
   * 指定された全タグを含むレコードのみ残す。
   */
  tagFilter?: string[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
};

/**
 * entrySite を「絞り込みキー」に正規化する。null / 空 / 空白のみは "unset"。
 * ここを純関数化することで、entrySiteOptions(件数集計)とフィルタ判定で
 * 同じキー導出ロジックを共有できる。
 */
export function normalizeEntrySiteKey(entrySite: string | null | undefined): string {
  if (!entrySite || entrySite.trim() === "") return "unset";
  return entrySite;
}

/**
 * 都道府県 / 雇用形態 のフィルタキー正規化(entrySite と同じパターン)。
 * null / 空白 は "unset"、それ以外は値そのまま。
 */
function normalizeNullableKey(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "unset";
  return value;
}

export function applyClientsFilterSort<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
  opts: FilterSortOptions,
): T[] {
  let result: ReadonlyArray<T> = clients;

  // 検索(氏名 / 氏名カナ / メールに部分一致、大文字小文字無視)。
  // 氏名カナは null 可なので存在確認してから includes。
  // 五十音検索が EMPRO 名簿の標準なので、name_kana も検索対象に含める。
  const q = opts.searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.email && c.email.toLowerCase().includes(q)) return true;
      if (c.nameKana && c.nameKana.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // ステータス絞り込み
  if (opts.statusFilter !== "all") {
    result = result.filter((c) => c.status === opts.statusFilter);
  }

  // エントリーサイト絞り込み("unset" は null/空/空白)
  if (opts.entrySiteFilter !== "all") {
    result = result.filter((c) => normalizeEntrySiteKey(c.entrySite) === opts.entrySiteFilter);
  }

  // 都道府県絞り込み(EMPRO 拡張)
  if (opts.prefectureFilter !== "all") {
    result = result.filter((c) => normalizeNullableKey(c.prefecture) === opts.prefectureFilter);
  }

  // 雇用形態絞り込み(EMPRO 拡張)
  if (opts.employmentTypeFilter !== "all") {
    result = result.filter(
      (c) => normalizeNullableKey(c.currentEmploymentType) === opts.employmentTypeFilter,
    );
  }

  // CRM 自由タグフィルタ(AND 条件)。
  // 指定された全てのタグを含むレコードのみ残す。空配列なら絞らない。
  if (opts.tagFilter && opts.tagFilter.length > 0) {
    const required = opts.tagFilter;
    result = result.filter((c) => required.every((t) => c.crmTags.includes(t)));
  }

  // 沈黙顧客フィルタ(CRM 機能)。silenceFilter が "all" なら何もしない。
  // "never" は最終対応が無いレコードのみ。"14d"〜"90d" は経過閾値で絞る。
  // 経過の起点は lastInteractionAt ?? createdAt(まだ対応していない顧客でも
  // 「受付から N 日以上動けていない」を沈黙とみなす業務ルール)。
  if (opts.silenceFilter && opts.silenceFilter !== "all") {
    if (opts.silenceFilter === "never") {
      result = result.filter((c) => c.lastInteractionAt === null);
    } else {
      const days = SILENCE_DAYS[opts.silenceFilter];
      // now が未指定なら判定不能なので素通り(呼び出し側のバグだが落とさない)
      if (opts.now !== undefined) {
        const thresholdMs = days * 24 * 60 * 60 * 1000;
        result = result.filter((c) => {
          const lastIso = c.lastInteractionAt ?? c.createdAt;
          const lastMs = Date.parse(lastIso);
          if (Number.isNaN(lastMs)) return false;
          return opts.now! - lastMs >= thresholdMs;
        });
      }
    }
  }

  // ソート(immutable: 元配列を破壊しないため slice してから sort)
  // 各列は「null は最後尾」+「日本語ロケール比較」のルールで揃える。
  const sorted = result.slice().sort((a, b) => {
    const cmp = compareByColumn(a, b, opts.sortColumn);
    return opts.sortDirection === "asc" ? cmp : -cmp;
  });

  return sorted;
}

/**
 * 列ごとの比較。null は常に「大きい」=末尾に並べる。
 * 全 13 列に対応。型に含まれない列(optional フィールド)は undefined → null と同等に末尾扱い。
 */
function compareByColumn<T extends ClientForFilterSort>(a: T, b: T, col: SortColumn): number {
  switch (col) {
    case "name":
      return a.name.localeCompare(b.name, "ja");
    case "nameKana":
      return nullableLocaleCompare(a.nameKana, b.nameKana);
    case "email":
      return nullableLocaleCompare(a.email, b.email);
    case "phone":
      return nullableLocaleCompare(a.phone ?? null, b.phone ?? null);
    case "prefecture":
      return nullableLocaleCompare(a.prefecture, b.prefecture);
    case "employmentType":
      return nullableLocaleCompare(a.currentEmploymentType, b.currentEmploymentType);
    case "status":
      return a.status.localeCompare(b.status);
    case "applicationStatus": {
      // 推薦合計件数(降順感覚で「多い順に上」が直感的だが、ここでは数値昇順を返し
      // UI 側で方向トグルする。多い順に見たいときは desc を選ぶ)
      const av = a.referralBreakdown?.total ?? 0;
      const bv = b.referralBreakdown?.total ?? 0;
      return av - bv;
    }
    case "linkStatus":
      return nullableLocaleCompare(a.linkStatus ?? null, b.linkStatus ?? null);
    case "maStatus": {
      // 許可(true)を先頭に並べたいなら desc 指定。ここでは false=0, true=1 で比較
      const av = a.emailDistributionEnabled ? 1 : 0;
      const bv = b.emailDistributionEnabled ? 1 : 0;
      return av - bv;
    }
    case "assignee":
      return nullableLocaleCompare(a.assigneeName ?? null, b.assigneeName ?? null);
    case "nextMeeting":
      // 早い順に並べたいときは asc。null(予約なし)は末尾。
      return nullableLocaleCompare(a.nextMeetingAt ?? null, b.nextMeetingAt ?? null);
    case "receivedAt":
      return nullableLocaleCompare(a.intakeDate ?? null, b.intakeDate ?? null);
    case "createdAt":
      return a.createdAt.localeCompare(b.createdAt);
  }
}

function nullableLocaleCompare(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null は末尾
  if (b === null) return -1;
  return a.localeCompare(b, "ja");
}

/**
 * 「現在の clients から実在するエントリーサイトを件数降順で並べたオプション配列」を返す。
 * UI のセレクトボックスに使う(空エントリ・件数 0 のオプションを出さないため)。
 * entrySite の正規化(unset 扱い)は normalizeEntrySiteKey と共有。
 */
export function buildEntrySiteOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeEntrySiteKey(c.entrySite);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * 都道府県のオプション配列(EMPRO 拡張、entrySite と同じパターン)。
 * 件数降順で並べる。null/空 は "unset" にまとめる。
 */
export function buildPrefectureOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeNullableKey(c.prefecture);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * 雇用形態のオプション配列(EMPRO 拡張)。
 * 件数降順。null は "unset"。値は ClientEmploymentType の enum 値。
 */
export function buildEmploymentTypeOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeNullableKey(c.currentEmploymentType);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * CRM 自由タグのオプション配列(タグ → 出現件数)。
 * 件数降順で並べる。組織内で実在するタグだけを返す
 * (タグは自由テキストなので、enum 化せず実データから集計)。
 */
export function buildCrmTagOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    for (const tag of c.crmTags) {
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
