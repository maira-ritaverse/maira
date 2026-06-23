/**
 * LP の ROI 試算 ページ で 使う 計算 ロジック + 前提 定数。
 *
 * - 数値 は LP の 「導入 効果」 セクション の 記述 と 整合 性 を 取って いる
 * - 前提 を 透明 に コード で 定数 化 し、 ヒアリング 等 で 後 から 調整 可能 に
 */

// マーケティング 用 リード 情報 ( 提出 時 のみ 必要 )
export type RoiContact = {
  companyName: string;
  contactName: string;
  email: string;
  role?: string | null; // 役職 ( 任意 )
  phone?: string | null;
  industry?: string | null;
};

export type RoiInput = {
  advisorCount: number; // アドバイザー 数 (名)
  monthlyClients: number; // 月間 で 対応 中 の 求職者 数 (名 / 月)
  docMinutesPerCase: number; // 履歴 書 / 職経 1 件 あたり 作成 時間 (分)
  monthlyDeals: number; // 月間 成約 件数 (件 / 月)
  avgFeeManYen: number; // 平均 紹介 料 単価 (万円 / 件)
  monthlyLostLeads: number; // 連絡 漏れ で 取りこぼし て いる 案件 (件 / 月)
  advisorHourlyYen: number; // アドバイザー 平均 時給 (円)
};

// 計算 前提。 LP の マーケ メッセージ と 整合 する 形 で 設定。
const ASSUMPTIONS = {
  docsPerClient: 0.5, // 求職者 1 名 あたり 平均 0.5 件 の 履歴 書 / 職経 を 作成
  docMinutesAfterMaira: 5, // Maira AI 生成 で 1 件 5 分 に
  outreachLostReductionRate: 0.8, // Daily ダイジェスト + 沈黙 アラート で 連絡 漏れ 80% 削減
  dealUpliftRate: 0.05, // 面談 リマインダー で 成約 率 5% UP
  lineCapacityMultiplier: 2, // 公式 LINE 効率 化 で 1 人 あたり 対応 数 2 倍 (= 50 → 100 名)。
  // 過去 は 4 倍 (200 名) と 案内 して いた が、 現実 的 な 負荷 観点 から 2 倍 に 補正。
};

export type RoiResult = {
  yearly: {
    total: number; // 年間 効果 額 (円)
    docTimeSavings: number; // 書類 作成 時間 削減 (円)
    leadRecovery: number; // 連絡 漏れ 防止 (円)
    dealUplift: number; // 成約 率 UP (円)
  };
  monthly: {
    docHoursBefore: number;
    docHoursAfter: number;
    docHoursSaved: number;
    leadRecoveryYen: number;
    dealUpliftYen: number;
  };
  capacity: {
    currentPerAdvisor: number;
    afterMairaPerAdvisor: number;
  };
};

export function calculateRoi(input: RoiInput): RoiResult {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const advisorCount = safe(input.advisorCount);
  const monthlyClients = safe(input.monthlyClients);
  const docMinutesPerCase = safe(input.docMinutesPerCase);
  const monthlyDeals = safe(input.monthlyDeals);
  const avgFeeYen = safe(input.avgFeeManYen) * 10000;
  const monthlyLostLeads = safe(input.monthlyLostLeads);
  const advisorHourlyYen = safe(input.advisorHourlyYen);

  // 書類 作成 時間 削減
  const docsPerMonth = monthlyClients * ASSUMPTIONS.docsPerClient;
  const docMinutesBefore = docsPerMonth * docMinutesPerCase;
  const docMinutesAfter = docsPerMonth * ASSUMPTIONS.docMinutesAfterMaira;
  const docMinutesSaved = Math.max(0, docMinutesBefore - docMinutesAfter);
  const docHoursSaved = docMinutesSaved / 60;
  const monthlyDocSavingsYen = docHoursSaved * advisorHourlyYen;

  // 連絡 漏れ 防止 効果
  const monthlyLeadRecoveryYen =
    monthlyLostLeads * ASSUMPTIONS.outreachLostReductionRate * avgFeeYen;

  // 面談 リマインダー で 成約 率 UP
  const monthlyDealUpliftYen = monthlyDeals * ASSUMPTIONS.dealUpliftRate * avgFeeYen;

  const yearly = {
    docTimeSavings: monthlyDocSavingsYen * 12,
    leadRecovery: monthlyLeadRecoveryYen * 12,
    dealUplift: monthlyDealUpliftYen * 12,
    total: 0,
  };
  yearly.total = yearly.docTimeSavings + yearly.leadRecovery + yearly.dealUplift;

  const currentPerAdvisor = advisorCount > 0 ? monthlyClients / advisorCount : 0;
  const afterMairaPerAdvisor = currentPerAdvisor * ASSUMPTIONS.lineCapacityMultiplier;

  return {
    yearly,
    monthly: {
      docHoursBefore: docMinutesBefore / 60,
      docHoursAfter: docMinutesAfter / 60,
      docHoursSaved,
      leadRecoveryYen: monthlyLeadRecoveryYen,
      dealUpliftYen: monthlyDealUpliftYen,
    },
    capacity: {
      currentPerAdvisor,
      afterMairaPerAdvisor,
    },
  };
}

export const ROI_ASSUMPTIONS_DESCRIPTION = [
  "求職者1名あたり平均0.5件の履歴書/職経を作成する前提",
  "MairaのAI自動生成で書類作成時間が1件5分に短縮",
  "Dailyダイジェスト+沈黙アラートで連絡漏れを80%削減",
  "面談リマインダーで成約率が5% UP",
  "公式LINE効率化で1人あたり対応数が2倍(= 50→100名想定)",
] as const;

// デフォルト 入力 値 (= 中堅 エージェント の 典型 想定)
export const DEFAULT_ROI_INPUT: RoiInput = {
  advisorCount: 5,
  monthlyClients: 100,
  docMinutesPerCase: 30,
  monthlyDeals: 8,
  avgFeeManYen: 80,
  monthlyLostLeads: 2,
  advisorHourlyYen: 3000,
};
