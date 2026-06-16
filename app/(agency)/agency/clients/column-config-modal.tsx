"use client";

import { Button } from "@/components/ui/button";
import {
  ALL_COLUMN_IDS,
  COLUMN_LABELS,
  defaultColumnConfig,
  toggleColumnVisible,
  type ColumnConfig,
  type ColumnId,
} from "@/lib/clients/column-config";

type Props = {
  open: boolean;
  config: ColumnConfig;
  onChange: (next: ColumnConfig) => void;
  onClose: () => void;
};

/**
 * クライアント一覧テーブルの「列の表示」設定モーダル。
 *
 * - チェックボックスで表示/非表示を切替
 * - 並び替えは **テーブルヘッダを直接ドラッグ**(本モーダルでは扱わない)
 * - 「デフォルトに戻す」+「閉じる」
 *
 * 設計判断:
 *   並び替えは ClientsTable の TableHead に直接 DnD で乗っているため、
 *   モーダルは「表示する列の選択」専用にして UI を簡素化した。
 *   非表示にした列はモーダルで再度チェックを入れるとテーブルに復帰する。
 */
export function ColumnConfigModal({ open, config, onChange, onClose }: Props) {
  if (!open) return null;

  // 最後の 1 列は非表示にできない安全装置
  const visibleCount = ALL_COLUMN_IDS.filter((id) => config.visible.has(id)).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="列の表示設定"
    >
      <div className="bg-background w-full max-w-md space-y-4 rounded-lg border p-5 shadow-lg">
        <div>
          <h2 className="text-lg font-semibold">列の表示</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            一覧テーブルに表示する列を選んでください。
            <br />
            並び替えは <strong>テーブルの列見出しを直接ドラッグ</strong> してください。
            設定はブラウザに保存されます。
          </p>
        </div>

        <ul className="divide-foreground/10 max-h-96 divide-y overflow-y-auto rounded-md border">
          {config.order.map((id) => {
            const visible = config.visible.has(id);
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => {
                    if (visible && visibleCount <= 1) return;
                    onChange(toggleColumnVisible(config, id));
                  }}
                  aria-label={`${COLUMN_LABELS[id]} を表示`}
                  disabled={visible && visibleCount <= 1}
                  className="cursor-pointer"
                />
                <span className="flex-1 text-sm">{COLUMN_LABELS[id]}</span>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={() => onChange(defaultColumnConfig())}>
            デフォルトに戻す
          </Button>
          <Button onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </div>
  );
}

/** 表示中の列だけを返す(親が render の filter として使う) */
export function visibleColumns(config: ColumnConfig): ColumnId[] {
  return config.order.filter((id) => config.visible.has(id));
}
