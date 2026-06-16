# 0005. API ヘルパパターン

- ステータス:採用
- 決定日:2026-06-15

## 文脈

`/api/agency/*` 以下に多数の Next.js Route Handler を実装。各ルートで以下のパターンが繰り返されていた:

```ts
const supabase = await createClient();
const {
  data: { user },
} = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const role = await getUserRole(user.id);
if (role.accountType !== "organization_member" || !role.organization || !role.member) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
if (role.member.role !== "admin") {
  return NextResponse.json({ error: "Admin only" }, { status: 403 });
}

let body: unknown;
try {
  body = await request.json();
} catch {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}
```

問題:

- 認証ロジックが各ルートで重複(15〜20 行 × 数十ルート)
- 一箇所で書き間違えると静かに認可漏れする
- 型の絞り込みが各ルートで手書きになる(`role.member` が non-null か等)

## 決定

`lib/api/auth-guards.ts` に Discriminated Union パターンで認可ヘルパを抽出。

```ts
const guard = await requireOrgAdmin();
if (!guard.ok) return guard.response;
const { supabase, organization, member } = guard;
```

提供関数:

- `requireOrgMember()` — admin / advisor どちらでも OK
- `requireOrgAdmin()` — admin 限定
- `requireUser()` — 認証のみ(seeker / member 問わず)
- `readJsonBody(request)` — JSON パース失敗を 400

Discriminated Union の利点:

- `if (!guard.ok) return guard.response` の後、TS が `user / organization / member` を non-null に narrow
- 早期 return で深いネストを避けられる
- 失敗 response の形が統一される

クライアント側にも対応ヘルパ:

- `apiFetch<T>(url, { json, ... })` — fetch + JSON シリアライズ + エラー throw
- `ApiClientError` — `status` + `serverError` を保持
- `getErrorMessage(err)` — UI 表示用統一抽出

## 結果

得たもの:

- ルート 1 本あたり 12〜18 行削減
- 認可漏れリスクの集中管理(`lib/api/auth-guards.ts` のテストで担保)
- フェッチエラーの表示が UI 全体で統一される

諦めたもの / 課題:

- 既存ルート全てを一度に書き換えるのは現実的でない(段階移行)
- ヘルパに含まれない特殊な認可(例:本人 user_id チェックのみ)は別途実装

## 移行方針

新規ルートは必ずヘルパ採用、既存ルートは修正の機会に合わせて段階移行。

## 関連実装

- [lib/api/auth-guards.ts](../../lib/api/auth-guards.ts)
- [lib/api/client-fetch.ts](../../lib/api/client-fetch.ts)
- [lib/api/client-fetch.test.ts](../../lib/api/client-fetch.test.ts)
- 採用済みルート例:
  - [/api/agency/announcements](../../app/api/agency/announcements/route.ts)
  - [/api/agency/email-templates](../../app/api/agency/email-templates/route.ts)
  - [/api/agency/me/notification-prefs](../../app/api/agency/me/notification-prefs/route.ts)
