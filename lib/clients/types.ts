/**
 * クライアントレコード(企業所有)の型定義
 *
 * ハイブリッド設計:
 *   - 企業が管理する「クライアント情報」は求職者本人のMairaアカウントとは別物
 *   - メール一致 + 求職者オプトインで link_status='linked' に遷移する
 */

import { z } from "zod";

export type ClientLinkStatus = "unlinked" | "invited" | "linked" | "revoked";

export type ClientStatus =
  | "initial_meeting"
  | "job_matching"
  | "in_screening"
  | "offer"
  | "completed"
  | "declined";

export const clientStatusLabels: Record<ClientStatus, string> = {
  initial_meeting: "初回面談",
  job_matching: "求人紹介中",
  in_screening: "選考中",
  offer: "内定",
  completed: "転職完了",
  declined: "見送り",
};

export const clientLinkStatusLabels: Record<ClientLinkStatus, string> = {
  unlinked: "未連携",
  invited: "招待済み",
  linked: "連携済み",
  revoked: "連携解除",
};

export type ClientRecord = {
  id: string;
  organizationId: string;
  assignedMemberId: string | null;
  name: string;
  email: string;
  phone: string | null;
  status: ClientStatus;
  linkStatus: ClientLinkStatus;
  linkedUserId: string | null;
  linkedAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

// クライアント登録リクエスト
export const createClientRequestSchema = z.object({
  name: z.string().min(1, "氏名を入力してください").max(100),
  email: z.string().email("正しいメールアドレスを入力してください"),
  phone: z.string().max(20).optional().or(z.literal("")),
  status: z
    .enum(["initial_meeting", "job_matching", "in_screening", "offer", "completed", "declined"])
    .default("initial_meeting"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

// クライアント更新リクエスト
export const updateClientRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional().or(z.literal("")),
  status: z
    .enum(["initial_meeting", "job_matching", "in_screening", "offer", "completed", "declined"])
    .optional(),
  assigned_member_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
