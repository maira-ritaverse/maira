/**
 * クライアントの重複検出(純関数)
 *
 * CRM の運用で発生する「同じ人物を別レコードで登録」を機械的に発見する。
 * 検出シグナル(優先順):
 *   1) email 完全一致(大文字小文字を無視) — 最も強い
 *   2) 正規化電話番号の完全一致(数字以外を除去) — 強い
 *   3) 氏名 + 生年月日 の完全一致 — 同姓同名の弱い区別あり
 *   4) 氏名カナの完全一致(前後空白トリム) — 弱い(注意喚起用)
 *
 * 同じグループは Union-Find で連結成分にまとめる。
 * 例えば A↔B が email 一致、B↔C が phone 一致 なら {A,B,C} を 1 グループにする。
 *
 * 出力は MatchReason 付きで、UI 側で「なぜ重複と判定されたか」を表示できる。
 */

export type DuplicateMatchReason = "email" | "phone" | "name_birthdate" | "name_kana";

/** 検出に必要な最小フィールド(ClientRecord の Pick 派生型) */
export type ClientForDuplicateDetection = {
  id: string;
  name: string;
  /** LINE 由来 で 未 入力 の 場合 は null。 null は dedup キー から 除外 する。 */
  email: string | null;
  phone: string | null;
  nameKana: string | null;
  birthDate: string | null;
};

export type DuplicateGroup = {
  /** 連結成分の代表 ID(ソート時の安定性のため最も古いものを使う想定だが、入力順依存) */
  members: ClientForDuplicateDetection[];
  reasons: DuplicateMatchReason[];
};

/** 電話番号を「数字のみ」に正規化する。null / 空文字は null を返す。 */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

/** 氏名カナを「前後空白除去 + NFKC 正規化」する。空文字は null。 */
function normalizeKana(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().normalize("NFKC");
  return trimmed === "" ? null : trimmed;
}

/** 氏名を「前後空白除去 + 内部空白の半角化 + NFKC」する。 */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").normalize("NFKC");
}

/** Union-Find(disjoint set union)の最小実装 */
class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] === x) return x;
    this.parent[x] = this.find(this.parent[x]); // 経路圧縮
    return this.parent[x];
  }
  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent[rx] = ry;
  }
}

/**
 * 重複候補のグループを検出する。
 * - 1 件のクライアントしかいない / 0 件のグループは出力しない。
 * - 大文字小文字差・全半角差・余分な空白の差は吸収する。
 * - 暗号化フィールドはここでは扱わない(平文のみで判定)。
 */
export function findDuplicateClientGroups<T extends ClientForDuplicateDetection>(
  clients: ReadonlyArray<T>,
): DuplicateGroup[] {
  const n = clients.length;
  if (n < 2) return [];

  const uf = new UnionFind(n);

  // インデックス Map を 4 種類作る。各キーで同一値の最初のインデックスを覚えておき、
  // 後続の同値があれば union する。
  const emailIndex = new Map<string, number>();
  const phoneIndex = new Map<string, number>();
  const nameBdayIndex = new Map<string, number>();
  const kanaIndex = new Map<string, number>();

  // group ごとの reasons を集めるための補助 Map(代表 index → Set<reason>)
  // union 操作のタイミングで union 元・先の reasons をマージするため、
  // 最終的にもう一度 representative ごとに再集計する。
  const indexReasons = new Map<number, Set<DuplicateMatchReason>>();

  const addReason = (i: number, reason: DuplicateMatchReason) => {
    const set = indexReasons.get(i) ?? new Set<DuplicateMatchReason>();
    set.add(reason);
    indexReasons.set(i, set);
  };

  for (let i = 0; i < n; i++) {
    const c = clients[i];

    // (1) email。 null は dedup 対象 外 (LINE 由来 で 未 入力 の 顧客 が 全員 同じ グループ
    // に なる 事故 を 避ける)。
    const emailKey = c.email?.trim().toLowerCase() ?? "";
    if (emailKey) {
      const prev = emailIndex.get(emailKey);
      if (prev !== undefined) {
        uf.union(prev, i);
        addReason(prev, "email");
        addReason(i, "email");
      } else {
        emailIndex.set(emailKey, i);
      }
    }

    // (2) phone(正規化済み)
    const phoneKey = normalizePhone(c.phone);
    if (phoneKey) {
      const prev = phoneIndex.get(phoneKey);
      if (prev !== undefined) {
        uf.union(prev, i);
        addReason(prev, "phone");
        addReason(i, "phone");
      } else {
        phoneIndex.set(phoneKey, i);
      }
    }

    // (3) 氏名 + 生年月日(両方ある時のみ採用)
    if (c.birthDate) {
      const nameBdayKey = `${normalizeName(c.name)}|${c.birthDate}`;
      const prev = nameBdayIndex.get(nameBdayKey);
      if (prev !== undefined) {
        uf.union(prev, i);
        addReason(prev, "name_birthdate");
        addReason(i, "name_birthdate");
      } else {
        nameBdayIndex.set(nameBdayKey, i);
      }
    }

    // (4) 氏名カナ
    const kanaKey = normalizeKana(c.nameKana);
    if (kanaKey) {
      const prev = kanaIndex.get(kanaKey);
      if (prev !== undefined) {
        uf.union(prev, i);
        addReason(prev, "name_kana");
        addReason(i, "name_kana");
      } else {
        kanaIndex.set(kanaKey, i);
      }
    }
  }

  // 連結成分ごとに集約
  const groupMap = new Map<number, { members: T[]; reasons: Set<DuplicateMatchReason> }>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    let g = groupMap.get(root);
    if (!g) {
      g = { members: [], reasons: new Set() };
      groupMap.set(root, g);
    }
    g.members.push(clients[i]);
    const reasons = indexReasons.get(i);
    if (reasons) for (const r of reasons) g.reasons.add(r);
  }

  // 2 件以上のメンバーがあるグループのみ採用。理由順は固定で並べる。
  const reasonOrder: DuplicateMatchReason[] = ["email", "phone", "name_birthdate", "name_kana"];
  const result: DuplicateGroup[] = [];
  for (const g of groupMap.values()) {
    if (g.members.length < 2) continue;
    result.push({
      members: g.members,
      reasons: reasonOrder.filter((r) => g.reasons.has(r)),
    });
  }
  return result;
}
