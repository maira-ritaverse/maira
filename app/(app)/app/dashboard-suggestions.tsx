import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Suggestion } from "@/lib/dashboard/suggestions";

type Props = {
  suggestions: Suggestion[];
  maxDisplay?: number;
};

/**
 * 「Myairaからの提案」セクション。
 *
 * generateSuggestions が返した配列を、優先度順に上位数件表示する。
 * 配列が空のときは何も描画しない(セクション見出しも出ない)。
 */
export function DashboardSuggestions({ suggestions, maxDisplay = 3 }: Props) {
  if (suggestions.length === 0) return null;

  const displayed = suggestions.slice(0, maxDisplay);

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">Myairaからの提案</h2>
      <div className="space-y-2">
        {displayed.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  // variant ごとの配色。warning は期限関連、primary はポジティブ/重要、info は軽い案内。
  const variantClasses: Record<Suggestion["variant"], string> = {
    primary: "border-primary/40 bg-primary/5",
    warning: "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30",
    info: "border-muted-foreground/20 bg-muted/30",
  };

  return (
    <Card className={`p-4 ${variantClasses[suggestion.variant]}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl">{suggestion.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{suggestion.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{suggestion.description}</p>
        </div>
        <Button
          render={<Link href={suggestion.actionHref} />}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          {suggestion.actionLabel}
        </Button>
      </div>
    </Card>
  );
}
