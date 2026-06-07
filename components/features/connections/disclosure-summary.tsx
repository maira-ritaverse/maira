/**
 * 「連携すると何が開示されるか」を本人に示す共通テキスト
 *
 * 承認ダイアログ(connection-actions の AlertDialog)と、連携中カードの
 * 「開示中の情報」リストで同じ内容を出す。文言が UI 2 箇所で食い違わない
 * よう、ここを唯一の出典にしている。
 *
 * 本 Phase(Phase 3)時点では、resumes/cvs への RLS は Phase 4、wants/user_facts
 * の限定開示関数は Phase 5 で実装する予定で、まだ「実際の開示」は始まっていない。
 * ただし求職者には「連携を承諾すると最終的にこれが見える状態になる」前提を
 * 説明する必要があるため、最終形に基づく開示範囲を書く。
 *
 * 開示しないもの(求職者の安心材料として明示):
 *   - キャリア棚卸しの内面(強み・価値観・懸念・人物総評)
 *   - キャリア診断結果(軸・適性)
 */

export const DISCLOSURE_ITEMS = [
  "履歴書",
  "職務経歴書",
  "希望条件(希望業界・職種・会社規模)",
  "プロフィール(現職・経験年数・業界)",
] as const;

export const NOT_DISCLOSED_ITEMS = [
  "キャリア棚卸しの内面的な内容(強み・価値観・懸念・人物総評)",
  "キャリア診断の結果",
] as const;

/**
 * 開示範囲の説明ブロック。
 * AlertDialog の説明・linked カードの「開示中」セクション両方で使う。
 */
export function DisclosureSummary() {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">エージェントに開示する情報</p>
        <ul className="text-muted-foreground mt-1 list-inside list-disc space-y-0.5">
          {DISCLOSURE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium">開示しない情報</p>
        <ul className="text-muted-foreground mt-1 list-inside list-disc space-y-0.5">
          {NOT_DISCLOSED_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
