import { Card } from "@/components/ui/card";
import type { CareerProfile } from "@/lib/career/profile-schema";

type Props = {
  profile: CareerProfile;
  updatedAt?: string;
  version?: number;
};

/**
 * キャリア棚卸し結果の表示
 *
 * Server / Client どちらからも利用できるよう "use client" は付けない。
 * 表示要素は構造化スキーマ(profile-schema.ts)と1対1対応。
 */
export function CareerProfileDisplay({ profile, updatedAt, version }: Props) {
  return (
    <div className="space-y-6">
      {updatedAt && (
        <div className="text-muted-foreground text-xs">
          最終更新: {new Date(updatedAt).toLocaleString("ja-JP")}
          {version !== undefined && ` ・ v${version}`}
        </div>
      )}

      {/* サマリー */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-bold">サマリー</h2>
        <p className="leading-relaxed">{profile.summary}</p>
      </Card>

      {/* 基本情報 */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-bold">基本情報</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">現在の職種</dt>
          <dd>{profile.user_facts.current_role ?? "—"}</dd>

          <dt className="text-muted-foreground">経験年数</dt>
          <dd>
            {profile.user_facts.years_of_experience !== null
              ? `${profile.user_facts.years_of_experience}年`
              : "—"}
          </dd>

          <dt className="text-muted-foreground">業界</dt>
          <dd>{profile.user_facts.industry ?? "—"}</dd>

          <dt className="text-muted-foreground">会社規模</dt>
          <dd>{profile.user_facts.company_size ?? "—"}</dd>
        </dl>
      </Card>

      {/* 強み */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-bold">
          強み{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({profile.strengths.length}個)
          </span>
        </h2>
        {profile.strengths.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            会話からは強みを抽出できませんでした。もう少し具体的な経験を話してみてください。
          </p>
        ) : (
          <div className="space-y-4">
            {profile.strengths.map((strength, index) => (
              <div key={index} className="border-primary border-l-2 pl-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{strength.label}</span>
                  <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                    {categoryLabel(strength.category)}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">{strength.evidence}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 価値観 */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-bold">大切にしている価値観</h2>
        {profile.values.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {profile.values.map((value, index) => (
              <li key={index}>・ {value}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* 希望 */}
      <Card className="p-6">
        <h2 className="mb-3 text-lg font-bold">次のキャリアで求めること</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">業界</dt>
            <dd className="text-muted-foreground">
              {profile.wants.industries.length > 0 ? profile.wants.industries.join(" / ") : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">職種・役割</dt>
            <dd className="text-muted-foreground">
              {profile.wants.role_types.length > 0 ? profile.wants.role_types.join(" / ") : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">会社規模</dt>
            <dd className="text-muted-foreground">
              {profile.wants.company_sizes.length > 0
                ? profile.wants.company_sizes.join(" / ")
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      {/* 懸念(あるときのみ表示) */}
      {profile.concerns.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-bold">気にしている点</h2>
          <ul className="space-y-1 text-sm">
            {profile.concerns.map((concern, index) => (
              <li key={index}>・ {concern}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function categoryLabel(category: "hard_skill" | "soft_skill" | "experience"): string {
  const labels = {
    hard_skill: "技術スキル",
    soft_skill: "ソフトスキル",
    experience: "経験",
  };
  return labels[category];
}
