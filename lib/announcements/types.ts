import { z } from "zod";

export type Announcement = {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  isPinned: boolean;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementWithRead = Announcement & {
  isRead: boolean;
};

type AnnouncementRow = {
  id: string;
  organization_id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  isPinned: z.boolean().default(false),
});
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  isPinned: z.boolean().optional(),
});
export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementSchema>;
