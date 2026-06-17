import type { ReactNode } from "react";

import { Card } from "./card";

type Props = {
  /** lucide-react のアイコンノード(例:<MessageSquare className="h-10 w-10" />)。絵文字は禁止。 */
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

/**
 * 汎用の空状態表示
 *
 * 使用例:
 *   <EmptyState
 *     icon={<Clipboard className="h-10 w-10" />}
 *     title="応募がまだ登録されていません"
 *     description="「新規追加」ボタンから応募を追加できます"
 *     action={<Button>新規追加</Button>}
 *   />
 */
export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <Card className="p-12 text-center">
      {icon && (
        <div className="text-muted-foreground mb-3 flex justify-center" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-lg font-medium">{title}</p>
      {description && <p className="text-muted-foreground mt-2 text-sm">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}
