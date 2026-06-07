import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * エージェントに開示する career_profile の限定フィールド
 *
 * 開示フロー Phase 5。career_profile はキャリア棚卸しの「内面的自己分析」を
 * すべて含む単一暗号化ブロブだが、エージェントに見せるのは「マッチングに必要な
 * 客観事実」だけに絞る。
 *
 * 含めるもの(本人の希望条件 + プロフィール事実):
 *   - wants.industries     : 希望業界(複数)
 *   - wants.role_types     : 希望職種/役割(複数)
 *   - wants.company_sizes  : 希望会社規模(複数)
 *   - user_facts.current_role        : 現職
 *   - user_facts.years_of_experience : 実務経験年数
 *   - user_facts.industry            : 現在の業界
 *
 * 含めないもの(恒久非開示。型レベルで漏らさない):
 *   - user_facts.company_size  : 現職会社の規模(本 Phase の方針で除外)
 *   - strengths / values / concerns / summary / diagnosis : 内面的自己分析
 *
 * 注意: user_facts.company_size(現職会社の規模)と wants.company_sizes
 * (希望会社規模)は別物。前者は除外、後者は開示する。
 *
 * 将来移行(案3):
 *   本フェーズは案1(単一ブロブから限定抽出)で実装している。将来 career_profile
 *   から開示用の派生テーブルを分ける案3 に移行する場合は、データ源
 *   (extractDisclosableProfile の引数)を差し替えるだけで型・呼び出し側を変えずに
 *   済むよう、本ファイルを「開示用データの唯一の定義」として独立させている。
 */

export type DisclosableProfile = {
  wants: {
    industries: string[];
    role_types: string[];
    company_sizes: string[];
  };
  user_facts: {
    current_role: string | null;
    years_of_experience: number | null;
    industry: string | null;
  };
};

/**
 * career_profile から開示可能なフィールドのみを抽出する純粋関数。
 *
 * 「型に含まれていないフィールドはコピーしない」のが本関数の責務。runtime でも
 * オブジェクトリテラルで明示的にプロパティを列挙し、内面フィールドが
 * スプレッド構文で混ざる事故を防ぐ。
 *
 * テストしやすさのために pure に保つ(IO なし)。
 */
export function extractDisclosableProfile(profile: CareerProfile): DisclosableProfile {
  return {
    wants: {
      industries: profile.wants.industries,
      role_types: profile.wants.role_types,
      company_sizes: profile.wants.company_sizes,
    },
    user_facts: {
      current_role: profile.user_facts.current_role,
      years_of_experience: profile.user_facts.years_of_experience,
      industry: profile.user_facts.industry,
    },
  };
}
