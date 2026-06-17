/**
 * サイドバーのナビアイコン解決
 *
 * 既存の ItemDescriptor.icon は `string` 型で、当初は絵文字を入れていた。
 * UI を白黒で統一するため、絵文字をやめて lucide-react アイコンに置き換える。
 * ItemDescriptor の型は変えずに「文字列キー → JSX」の解決マップで対応する。
 *
 * 使い方:
 *   <NavIcon name={item.icon} />
 *
 * 未知のキーが来た場合は CircleDashed(プレースホルダ)を返す。
 * 後方互換のため、絵文字文字列はそのまま `<span>` で出す。
 */
import {
  Award,
  Bell,
  Bot,
  Briefcase,
  Calendar,
  ClipboardList,
  Clipboard,
  FileText,
  Files,
  Inbox,
  LayoutDashboard,
  Link2,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Mic,
  ScrollText,
  Settings,
  Sparkles,
  Target,
  UserCog,
  Users,
  Video,
} from "lucide-react";

/** 文字列キー → lucide コンポーネント */
const ICON_MAP: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  briefcase: Briefcase,
  calendar: Calendar,
  video: Video,
  megaphone: Megaphone,
  bell: Bell,
  reports: ClipboardList,
  settings: Settings,
  "user-cog": UserCog,
  diagnosis: Target,
  message: MessageSquare,
  resume: FileText,
  cv: Files,
  document: FileText,
  inbox: Inbox,
  sparkles: Sparkles,
  applications: Clipboard,
  tasks: ScrollText,
  mic: Mic,
  link: Link2,
  bot: Bot,
  award: Award,
};

type Props = {
  /** ItemDescriptor.icon の値。ICON_MAP のキー、もしくは絵文字 */
  name: string;
  className?: string;
};

/**
 * 絵文字判定の単純化:1 文字目が ASCII letter / digit / "_" / "-" でなければ絵文字とみなす。
 * すべての絵文字を網羅する厳密な判定ではないが、ICON_MAP に登録済みのキーとは
 * 衝突しない設計。
 */
function isEmoji(s: string): boolean {
  if (!s) return false;
  const code = s.charCodeAt(0);
  // ASCII letters / digits / "-" / "_" は ICON_MAP のキー
  return !(
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 95 // _
  );
}

export function NavIcon({ name, className = "size-4" }: Props) {
  if (isEmoji(name)) {
    // 後方互換:絵文字はそのまま出す(将来的に全部キーに移行できれば不要)
    return <span aria-hidden>{name}</span>;
  }
  const Icon = ICON_MAP[name];
  if (!Icon) {
    return <span aria-hidden className={className} />;
  }
  return <Icon className={className} aria-hidden />;
}
