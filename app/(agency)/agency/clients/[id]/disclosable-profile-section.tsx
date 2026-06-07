import { Card } from "@/components/ui/card";
import { getDisclosableProfileForLinkedClient } from "@/lib/connections/agency-queries";

/**
 * linked クライアントの希望条件・プロフィール表示セクション(エージェント側)
 *
 * 取得は getDisclosableProfileForLinkedClient(SECURITY DEFINER RPC + 復号 + 抽出)。
 * 戻り値型は DisclosableProfile(wants + user_facts の限定フィールドのみ)で、
 * 内面(strengths / values / concerns / summary / diagnosis)は型レベルで含まれない。
 *
 * 失敗時の方針:
 *   - 認可エラー throw → クライアント詳細ページの条件分岐(linked のときだけ
 *     レンダリングする)を経ているので通常は発生しない。発生したらフォールバック
 *     UI に倒し他セクションを巻き込まない。
 *   - 復号失敗 / 未作成 → null:「未登録」のフォールバック表示。
 */

type Props = {
  clientRecordId: string;
};

export async function DisclosableProfileSection({ clientRecordId }: Props) {
  let profile = null;
  let hasError = false;

  try {
    profile = await getDisclosableProfileForLinkedClient(clientRecordId);
  } catch {
    hasError = true;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">希望条件・プロフィール</h2>
        <p className="text-muted-foreground text-xs">
          求職者が共有を許可した転職希望条件と、現職・経験のプロフィールです。
          内面的な棚卸し(強み・価値観・懸念)や診断結果は開示されません。
        </p>
      </div>

      {hasError ? (
        <Card className="p-4">
          <p className="text-sm text-red-600">
            希望条件の取得に失敗しました。時間をおいて再度お試しください。
          </p>
        </Card>
      ) : !profile ? (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">
            このクライアントの希望条件はまだ登録されていません。
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {/* 希望条件 */}
          <Card className="p-4">
            <h3 className="mb-3 text-base font-semibold">希望条件</h3>
            <dl className="space-y-2 text-sm">
              <FieldRow label="希望業界" values={profile.wants.industries} />
              <FieldRow label="希望職種・役割" values={profile.wants.role_types} />
              <FieldRow label="希望会社規模" values={profile.wants.company_sizes} />
            </dl>
          </Card>

          {/* 現職・プロフィール */}
          <Card className="p-4">
            <h3 className="mb-3 text-base font-semibold">プロフィール</h3>
            <dl className="space-y-2 text-sm">
              <FieldRow
                label="現職"
                values={profile.user_facts.current_role ? [profile.user_facts.current_role] : []}
              />
              <FieldRow
                label="経験年数"
                values={
                  profile.user_facts.years_of_experience !== null
                    ? [`${profile.user_facts.years_of_experience}年`]
                    : []
                }
              />
              <FieldRow
                label="現在の業界"
                values={profile.user_facts.industry ? [profile.user_facts.industry] : []}
              />
            </dl>
          </Card>
        </div>
      )}
    </section>
  );
}

/**
 * 「ラベル / 値 or 未登録」を 1 行で出すヘルパー。
 * 配列で来る希望条件(industries 等)はカンマ区切り、単値もリスト化して渡す。
 */
function FieldRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-baseline gap-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">
        {values.length === 0 ? (
          <span className="text-muted-foreground">未登録</span>
        ) : (
          values.join("、")
        )}
      </dd>
    </div>
  );
}
