/**
 * /admin/roi-leads
 *
 * LP の /roi 試算 フォーム から 集まった マーケ リード を 一覧 表示。
 * service_role で 直接 SELECT し、 表 で 全 件 を 表示。
 *
 * 表示 項目:
 *   ・送信 日時 / 会社 名 / 担当 者 / メアド / 役職 / 年間 効果 額 (= 試算 結果)
 *   ・各 入力 値 ( アドバイザー 数 / 月間 求職者 数 等 ) は 折りたたみ で 詳細 表示
 *
 * /admin/* レイアウト側 で isMairaAdmin ガード済み。
 */
import { Card } from "@/components/ui/card";
import { createServiceClient } from "@/lib/supabase/service";

type RoiLead = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  role: string | null;
  phone: string | null;
  industry: string | null;
  advisor_count: number;
  monthly_clients: number;
  monthly_deals: number;
  avg_fee_man_yen: number;
  doc_minutes_per_case: number;
  monthly_lost_leads: number | null;
  advisor_hourly_yen: number | null;
  calculated_yearly_total_yen: number;
  calculated_yearly_doc_savings_yen: number;
  calculated_yearly_lead_recovery_yen: number;
  calculated_yearly_deal_uplift_yen: number;
  created_at: string;
};

const yen = (n: number | null | undefined) => "¥" + Math.round(n ?? 0).toLocaleString("ja-JP");

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default async function AdminRoiLeadsPage() {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("roi_simulations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  const leads: RoiLead[] = error ? [] : ((data ?? []) as unknown as RoiLead[]);

  const totalYearly = leads.reduce((acc, l) => acc + (l.calculated_yearly_total_yen ?? 0), 0);
  const avgYearly = leads.length > 0 ? totalYearly / leads.length : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">ROI 試算 リード</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          LP の /roi ページ から 送信 された マーケ リード。 各 行 を 開く と 入力 値 の 詳細 が
          見られます。
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          データ 取得 で エラー が 発生 しました: {error.message}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="リード 件数" value={`${leads.length} 件`} />
        <SummaryCard label="平均 年間 効果 額" value={yen(avgYearly)} />
        <SummaryCard label="累計 試算 額" value={yen(totalYearly)} />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">送信 日時</th>
              <th className="px-4 py-3 font-medium">会社 名</th>
              <th className="px-4 py-3 font-medium">担当 者</th>
              <th className="px-4 py-3 font-medium">役職</th>
              <th className="px-4 py-3 font-medium">業種</th>
              <th className="px-4 py-3 text-right font-medium">年間 効果 額</th>
              <th className="px-4 py-3 font-medium">詳細</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                  まだ リード は ありません
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-600">
                    {fmtDate(l.created_at)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{l.company_name}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-900">{l.contact_name}</div>
                    <a href={`mailto:${l.email}`} className="text-xs text-blue-600 hover:underline">
                      {l.email}
                    </a>
                    {l.phone && <div className="text-xs text-slate-500">{l.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{l.role ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{l.industry ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-orange-600 tabular-nums">
                    {yen(l.calculated_yearly_total_yen)}
                  </td>
                  <td className="px-4 py-3">
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                        開く
                      </summary>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700">
                        <Field label="アドバイザー" value={`${l.advisor_count} 名`} />
                        <Field label="月間 求職者" value={`${l.monthly_clients} 名`} />
                        <Field label="月間 成約" value={`${l.monthly_deals} 件`} />
                        <Field label="紹介 料" value={`${l.avg_fee_man_yen} 万円`} />
                        <Field label="書類 時間" value={`${l.doc_minutes_per_case} 分`} />
                        <Field
                          label="連絡 漏れ"
                          value={l.monthly_lost_leads != null ? `${l.monthly_lost_leads} 件` : "—"}
                        />
                        <Field
                          label="時給"
                          value={l.advisor_hourly_yen != null ? `${l.advisor_hourly_yen} 円` : "—"}
                        />
                      </dl>
                      <div className="mt-3 border-t border-slate-100 pt-2 text-slate-700">
                        <p>内訳 (年間):</p>
                        <ul className="mt-1 ml-3 list-disc space-y-0.5">
                          <li>書類 削減: {yen(l.calculated_yearly_doc_savings_yen)}</li>
                          <li>連絡 漏れ 防止: {yen(l.calculated_yearly_lead_recovery_yen)}</li>
                          <li>成約 UP: {yen(l.calculated_yearly_deal_uplift_yen)}</li>
                        </ul>
                      </div>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </>
  );
}
