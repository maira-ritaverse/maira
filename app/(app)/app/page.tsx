import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // layoutでもチェックしているが、TypeScript的にuserがnullでないことを保証するため
  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          おかえりなさい、{profile?.display_name ?? "ゲスト"}さん
        </h1>
        <p className="text-muted-foreground mt-2">
          Mairaへようこそ。ここからあなたの転職活動が始まります。
        </p>
      </div>

      <div className="bg-card rounded-lg border p-8 text-center">
        <p className="text-lg">🚧 開発中</p>
        <p className="text-muted-foreground mt-2 text-sm">
          各モジュールは現在実装中です。順次リリースしていきます。
        </p>
      </div>
    </div>
  );
}
