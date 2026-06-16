import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import {
  createSavedViewRequestSchema,
  type SavedView,
  type SavedViewResource,
} from "@/lib/saved-views/types";

/**
 * /api/agency/saved-views
 *   GET  ?resource=clients … 自分が保存したビューの一覧(降順 updated_at)
 *   POST { resource, name, filters } … 新規作成
 *
 * 認可:
 *   - organization_member のみ
 *   - RLS で user_id = auth.uid() を強制(ここでも明示)
 *
 * 同名(user_id × resource × name)は DB のユニーク制約で 409。
 * UI 側は「上書きしますか?」を聞くか、別名で保存する。
 */

const ALLOWED_RESOURCES: SavedViewResource[] = ["clients"];

type SavedViewRow = {
  id: string;
  user_id: string;
  organization_id: string;
  resource: string;
  name: string;
  filters: unknown;
  created_at: string;
  updated_at: string;
};

function rowToSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    resource: row.resource as SavedViewResource,
    name: row.name,
    filters: (row.filters ?? {}) as SavedView["filters"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authorize() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };
  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return { error: "Forbidden" as const, status: 403 };
  }
  return { supabase, userId: user.id, organizationId: role.organization.id };
}

export async function GET(request: Request) {
  const auth = await authorize();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  const url = new URL(request.url);
  const resource = (url.searchParams.get("resource") ?? "clients") as SavedViewResource;
  if (!ALLOWED_RESOURCES.includes(resource)) {
    return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
  }

  // RLS が user_id = auth.uid() を強制するが、明示的にも絞って高速化。
  const { data, error } = await supabase
    .from("saved_views")
    .select("*")
    .eq("user_id", userId)
    .eq("resource", resource)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load", message: error.message }, { status: 500 });
  }

  const views = ((data ?? []) as SavedViewRow[]).map(rowToSavedView);
  return NextResponse.json({ views });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, userId, organizationId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSavedViewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { resource, name, filters } = parsed.data;
  const { data, error } = await supabase
    .from("saved_views")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      resource,
      name: name.trim(),
      filters,
    })
    .select("*")
    .single();

  if (error || !data) {
    // 23505 = unique violation(同名)
    if (error?.code === "23505") {
      return NextResponse.json(
        {
          error:
            "同じ名前のビューが既に存在します。別名で保存するか、削除してから再作成してください。",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ view: rowToSavedView(data as SavedViewRow) }, { status: 201 });
}
