export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      advisor_messages: {
        Row: {
          created_at: string;
          encrypted_content: string;
          id: string;
          read_at: string | null;
          sender_kind: string;
          sender_user_id: string;
          thread_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_content: string;
          id?: string;
          read_at?: string | null;
          sender_kind: string;
          sender_user_id: string;
          thread_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_content?: string;
          id?: string;
          read_at?: string | null;
          sender_kind?: string;
          sender_user_id?: string;
          thread_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "advisor_messages_thread_id_fkey";
            columns: ["thread_id"];
            isOneToOne: false;
            referencedRelation: "advisor_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      advisor_threads: {
        Row: {
          client_record_id: string;
          created_at: string;
          id: string;
          last_message_at: string | null;
          organization_id: string;
          seeker_user_id: string;
          unread_for_agency: number;
          unread_for_seeker: number;
          updated_at: string;
        };
        Insert: {
          client_record_id: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          organization_id: string;
          seeker_user_id: string;
          unread_for_agency?: number;
          unread_for_seeker?: number;
          updated_at?: string;
        };
        Update: {
          client_record_id?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          organization_id?: string;
          seeker_user_id?: string;
          unread_for_agency?: number;
          unread_for_seeker?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "advisor_threads_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "advisor_threads_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_applications: {
        Row: {
          applied_at: string;
          applied_by_member_id: string | null;
          client_record_id: string;
          created_at: string;
          encrypted_details: string;
          id: string;
          organization_id: string;
          referral_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          applied_at?: string;
          applied_by_member_id?: string | null;
          client_record_id: string;
          created_at?: string;
          encrypted_details: string;
          id?: string;
          organization_id: string;
          referral_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          applied_at?: string;
          applied_by_member_id?: string | null;
          client_record_id?: string;
          created_at?: string;
          encrypted_details?: string;
          id?: string;
          organization_id?: string;
          referral_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agency_applications_applied_by_member_id_fkey";
            columns: ["applied_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_applications_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_applications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_applications_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: true;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_client_cvs: {
        Row: {
          client_record_id: string;
          created_at: string;
          created_by_member_id: string | null;
          document_date: string | null;
          encrypted_body: string;
          id: string;
          organization_id: string;
          pushed_to_draft_id: string | null;
          related_resume_id: string | null;
          source_hearing_sheet_id: string | null;
          source_recording_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          client_record_id: string;
          created_at?: string;
          created_by_member_id?: string | null;
          document_date?: string | null;
          encrypted_body: string;
          id?: string;
          organization_id: string;
          pushed_to_draft_id?: string | null;
          related_resume_id?: string | null;
          source_hearing_sheet_id?: string | null;
          source_recording_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          client_record_id?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          document_date?: string | null;
          encrypted_body?: string;
          id?: string;
          organization_id?: string;
          pushed_to_draft_id?: string | null;
          related_resume_id?: string | null;
          source_hearing_sheet_id?: string | null;
          source_recording_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agency_client_cvs_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_pushed_to_draft_id_fkey";
            columns: ["pushed_to_draft_id"];
            isOneToOne: false;
            referencedRelation: "document_drafts_from_agency";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_related_resume_id_fkey";
            columns: ["related_resume_id"];
            isOneToOne: false;
            referencedRelation: "agency_client_resumes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_source_hearing_sheet_fk";
            columns: ["source_hearing_sheet_id"];
            isOneToOne: false;
            referencedRelation: "hearing_sheets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_cvs_source_recording_id_fkey";
            columns: ["source_recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_client_photos: {
        Row: {
          bytes: number | null;
          client_record_id: string;
          created_at: string;
          height: number | null;
          id: string;
          organization_id: string;
          storage_path: string;
          uploaded_by_member_id: string | null;
          width: number | null;
        };
        Insert: {
          bytes?: number | null;
          client_record_id: string;
          created_at?: string;
          height?: number | null;
          id?: string;
          organization_id: string;
          storage_path: string;
          uploaded_by_member_id?: string | null;
          width?: number | null;
        };
        Update: {
          bytes?: number | null;
          client_record_id?: string;
          created_at?: string;
          height?: number | null;
          id?: string;
          organization_id?: string;
          storage_path?: string;
          uploaded_by_member_id?: string | null;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agency_client_photos_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_photos_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_photos_uploaded_by_member_id_fkey";
            columns: ["uploaded_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_client_resumes: {
        Row: {
          client_record_id: string;
          created_at: string;
          created_by_member_id: string | null;
          document_date: string | null;
          education_history: Json;
          encrypted_pii: string;
          id: string;
          licenses: Json;
          organization_id: string;
          photo_storage_path: string | null;
          pushed_to_draft_id: string | null;
          source_hearing_sheet_id: string | null;
          source_recording_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          client_record_id: string;
          created_at?: string;
          created_by_member_id?: string | null;
          document_date?: string | null;
          education_history?: Json;
          encrypted_pii: string;
          id?: string;
          licenses?: Json;
          organization_id: string;
          photo_storage_path?: string | null;
          pushed_to_draft_id?: string | null;
          source_hearing_sheet_id?: string | null;
          source_recording_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          client_record_id?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          document_date?: string | null;
          education_history?: Json;
          encrypted_pii?: string;
          id?: string;
          licenses?: Json;
          organization_id?: string;
          photo_storage_path?: string | null;
          pushed_to_draft_id?: string | null;
          source_hearing_sheet_id?: string | null;
          source_recording_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agency_client_resumes_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_resumes_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_resumes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_resumes_pushed_to_draft_id_fkey";
            columns: ["pushed_to_draft_id"];
            isOneToOne: false;
            referencedRelation: "document_drafts_from_agency";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_resumes_source_hearing_sheet_fk";
            columns: ["source_hearing_sheet_id"];
            isOneToOne: false;
            referencedRelation: "hearing_sheets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_client_resumes_source_recording_id_fkey";
            columns: ["source_recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      agency_tasks: {
        Row: {
          assigned_member_id: string;
          client_record_id: string;
          completed_at: string | null;
          created_at: string;
          due_at: string | null;
          id: string;
          organization_id: string;
          priority: string | null;
          referral_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_member_id: string;
          client_record_id: string;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          organization_id: string;
          priority?: string | null;
          referral_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_member_id?: string;
          client_record_id?: string;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          organization_id?: string;
          priority?: string | null;
          referral_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agency_tasks_assigned_member_id_fkey";
            columns: ["assigned_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_tasks_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agency_tasks_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage_events: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          metadata: Json | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          metadata?: Json | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          metadata?: Json | null;
          user_id?: string;
        };
        Relationships: [];
      };
      announcement_reads: {
        Row: {
          announcement_id: string;
          member_id: string;
          read_at: string;
        };
        Insert: {
          announcement_id: string;
          member_id: string;
          read_at?: string;
        };
        Update: {
          announcement_id?: string;
          member_id?: string;
          read_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey";
            columns: ["announcement_id"];
            isOneToOne: false;
            referencedRelation: "announcements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcement_reads_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: {
          body: string;
          created_at: string;
          created_by_member_id: string | null;
          id: string;
          is_pinned: boolean;
          organization_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          is_pinned?: boolean;
          organization_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          is_pinned?: boolean;
          organization_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      application_pr_customizations: {
        Row: {
          application_id: string;
          base_cv_id: string | null;
          base_resume_id: string | null;
          created_at: string;
          encrypted_overrides: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id: string;
          base_cv_id?: string | null;
          base_resume_id?: string | null;
          created_at?: string;
          encrypted_overrides: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          application_id?: string;
          base_cv_id?: string | null;
          base_resume_id?: string | null;
          created_at?: string;
          encrypted_overrides?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_pr_customizations_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: true;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          applied_at: string | null;
          created_at: string;
          encrypted_details: string | null;
          encrypted_details_v2: string | null;
          encryption_iv: string | null;
          id: string;
          is_archived: boolean;
          next_action_at: string | null;
          status: Database["public"]["Enums"]["application_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          applied_at?: string | null;
          created_at?: string;
          encrypted_details?: string | null;
          encrypted_details_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          is_archived?: boolean;
          next_action_at?: string | null;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          applied_at?: string | null;
          created_at?: string;
          encrypted_details?: string | null;
          encrypted_details_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          is_archived?: boolean;
          next_action_at?: string | null;
          status?: Database["public"]["Enums"]["application_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "applications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"];
          created_at: string;
          id: string;
          ip_address: unknown;
          metadata: Json | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["audit_action"];
          created_at?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["audit_action"];
          created_at?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_feed_tokens: {
        Row: {
          created_at: string;
          id: string;
          last_accessed_at: string | null;
          revoked_at: string | null;
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          revoked_at?: string | null;
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          revoked_at?: string | null;
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      career_intake_recordings: {
        Row: {
          client_record_id: string | null;
          created_at: string;
          duration_seconds: number | null;
          encrypted_extraction: string | null;
          encrypted_transcript: string | null;
          external_download_url: string | null;
          external_meeting_id: string | null;
          external_recording_id: string | null;
          external_source: string | null;
          id: string;
          meeting_schedule_id: string | null;
          original_filename: string;
          processing_lease_until: string | null;
          processing_started_at: string | null;
          retry_count: number;
          size_bytes: number;
          status: string;
          status_message: string | null;
          storage_path: string | null;
          transcript_purpose: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_record_id?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          encrypted_extraction?: string | null;
          encrypted_transcript?: string | null;
          external_download_url?: string | null;
          external_meeting_id?: string | null;
          external_recording_id?: string | null;
          external_source?: string | null;
          id?: string;
          meeting_schedule_id?: string | null;
          original_filename: string;
          processing_lease_until?: string | null;
          processing_started_at?: string | null;
          retry_count?: number;
          size_bytes: number;
          status?: string;
          status_message?: string | null;
          storage_path?: string | null;
          transcript_purpose?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_record_id?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          encrypted_extraction?: string | null;
          encrypted_transcript?: string | null;
          external_download_url?: string | null;
          external_meeting_id?: string | null;
          external_recording_id?: string | null;
          external_source?: string | null;
          id?: string;
          meeting_schedule_id?: string | null;
          original_filename?: string;
          processing_lease_until?: string | null;
          processing_started_at?: string | null;
          retry_count?: number;
          size_bytes?: number;
          status?: string;
          status_message?: string | null;
          storage_path?: string | null;
          transcript_purpose?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "career_intake_recordings_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "career_intake_recordings_meeting_schedule_id_fkey";
            columns: ["meeting_schedule_id"];
            isOneToOne: false;
            referencedRelation: "meeting_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      career_intake_shares: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          label: string | null;
          recording_id: string;
          revoked_at: string | null;
          token: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          label?: string | null;
          recording_id: string;
          revoked_at?: string | null;
          token?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          label?: string | null;
          recording_id?: string;
          revoked_at?: string | null;
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "career_intake_shares_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      career_profiles: {
        Row: {
          created_at: string;
          encrypted_data: string | null;
          id: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          encrypted_data?: string | null;
          id?: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          encrypted_data?: string | null;
          id?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "career_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      client_audit_log: {
        Row: {
          action: string;
          actor_member_id: string | null;
          client_record_id: string;
          created_at: string;
          field_name: string;
          id: string;
          new_value: string | null;
          old_value: string | null;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_member_id?: string | null;
          client_record_id: string;
          created_at?: string;
          field_name: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          organization_id: string;
        };
        Update: {
          action?: string;
          actor_member_id?: string | null;
          client_record_id?: string;
          created_at?: string;
          field_name?: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_audit_log_actor_member_id_fkey";
            columns: ["actor_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_audit_log_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_audit_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_custom_field_definitions: {
        Row: {
          created_at: string;
          display_order: number;
          field_type: string;
          id: string;
          is_required: boolean;
          key: string;
          label: string;
          options: string[];
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_order?: number;
          field_type: string;
          id?: string;
          is_required?: boolean;
          key: string;
          label: string;
          options?: string[];
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_order?: number;
          field_type?: string;
          id?: string;
          is_required?: boolean;
          key?: string;
          label?: string;
          options?: string[];
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_custom_field_definitions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_interactions: {
        Row: {
          author_member_id: string | null;
          body: string | null;
          client_record_id: string;
          created_at: string;
          id: string;
          interaction_type: string;
          occurred_at: string;
          organization_id: string;
          referral_id: string | null;
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          author_member_id?: string | null;
          body?: string | null;
          client_record_id: string;
          created_at?: string;
          id?: string;
          interaction_type: string;
          occurred_at?: string;
          organization_id: string;
          referral_id?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          author_member_id?: string | null;
          body?: string | null;
          client_record_id?: string;
          created_at?: string;
          id?: string;
          interaction_type?: string;
          occurred_at?: string;
          organization_id?: string;
          referral_id?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_interactions_author_member_id_fkey";
            columns: ["author_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_interactions_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_interactions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_interactions_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      client_invitations: {
        Row: {
          accepted_at: string | null;
          client_record_id: string;
          created_at: string;
          created_by_member_id: string | null;
          email: string;
          expires_at: string;
          id: string;
          organization_id: string;
          revoked_at: string | null;
          sent_at: string;
          status: string;
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          client_record_id: string;
          created_at?: string;
          created_by_member_id?: string | null;
          email: string;
          expires_at: string;
          id?: string;
          organization_id: string;
          revoked_at?: string | null;
          sent_at?: string;
          status?: string;
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          client_record_id?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          email?: string;
          expires_at?: string;
          id?: string;
          organization_id?: string;
          revoked_at?: string | null;
          sent_at?: string;
          status?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_invitations_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_invitations_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_job_ai_recommendations: {
        Row: {
          client_record_id: string;
          encrypted_rankings: string;
          generated_at: string;
          id: string;
          inputs_hash: string;
          organization_id: string;
        };
        Insert: {
          client_record_id: string;
          encrypted_rankings: string;
          generated_at?: string;
          id?: string;
          inputs_hash: string;
          organization_id: string;
        };
        Update: {
          client_record_id?: string;
          encrypted_rankings?: string;
          generated_at?: string;
          id?: string;
          inputs_hash?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_job_ai_recommendations_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: true;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_job_ai_recommendations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_record_collaborators: {
        Row: {
          added_at: string;
          added_by_member_id: string | null;
          client_record_id: string;
          member_id: string;
        };
        Insert: {
          added_at?: string;
          added_by_member_id?: string | null;
          client_record_id: string;
          member_id: string;
        };
        Update: {
          added_at?: string;
          added_by_member_id?: string | null;
          client_record_id?: string;
          member_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_record_collaborators_added_by_member_id_fkey";
            columns: ["added_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_record_collaborators_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_record_collaborators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      client_records: {
        Row: {
          assigned_member_id: string | null;
          birth_date: string | null;
          building: string | null;
          city: string | null;
          close_reason: string | null;
          created_at: string;
          crm_tags: string[];
          current_annual_income: number | null;
          current_employment_type: string | null;
          custom_fields: Json;
          desired_annual_income: number | null;
          desired_industries: string[] | null;
          desired_locations: string[] | null;
          desired_occupations: string[] | null;
          email: string;
          email_distribution_enabled: boolean;
          email2: string | null;
          encrypted_contact_method_preference: string | null;
          encrypted_desired_conditions: string | null;
          encrypted_education_detail: string | null;
          encrypted_job_change_reason: string | null;
          encrypted_meeting_notes: string | null;
          encrypted_other_agency_status: string | null;
          encrypted_recommendation_comment: string | null;
          encrypted_skills: string | null;
          encrypted_status_memo: string | null;
          entry_site: string | null;
          experience_industries: string[] | null;
          experience_occupations: string[] | null;
          final_education: string | null;
          first_meeting_date: string | null;
          gender: string | null;
          id: string;
          intake_date: string | null;
          job_change_timing: string | null;
          link_status: string;
          linked_at: string | null;
          linked_user_id: string | null;
          marital_status: string | null;
          name: string;
          name_kana: string | null;
          nationality: string | null;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          phone2: string | null;
          postal_code: string | null;
          prefecture: string | null;
          revoke_confirmed_via: string | null;
          revoke_deadline: string | null;
          revoke_requested_at: string | null;
          revoked_at: string | null;
          status: string;
          street: string | null;
          updated_at: string;
        };
        Insert: {
          assigned_member_id?: string | null;
          birth_date?: string | null;
          building?: string | null;
          city?: string | null;
          close_reason?: string | null;
          created_at?: string;
          crm_tags?: string[];
          current_annual_income?: number | null;
          current_employment_type?: string | null;
          custom_fields?: Json;
          desired_annual_income?: number | null;
          desired_industries?: string[] | null;
          desired_locations?: string[] | null;
          desired_occupations?: string[] | null;
          email: string;
          email_distribution_enabled?: boolean;
          email2?: string | null;
          encrypted_contact_method_preference?: string | null;
          encrypted_desired_conditions?: string | null;
          encrypted_education_detail?: string | null;
          encrypted_job_change_reason?: string | null;
          encrypted_meeting_notes?: string | null;
          encrypted_other_agency_status?: string | null;
          encrypted_recommendation_comment?: string | null;
          encrypted_skills?: string | null;
          encrypted_status_memo?: string | null;
          entry_site?: string | null;
          experience_industries?: string[] | null;
          experience_occupations?: string[] | null;
          final_education?: string | null;
          first_meeting_date?: string | null;
          gender?: string | null;
          id?: string;
          intake_date?: string | null;
          job_change_timing?: string | null;
          link_status?: string;
          linked_at?: string | null;
          linked_user_id?: string | null;
          marital_status?: string | null;
          name: string;
          name_kana?: string | null;
          nationality?: string | null;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          phone2?: string | null;
          postal_code?: string | null;
          prefecture?: string | null;
          revoke_confirmed_via?: string | null;
          revoke_deadline?: string | null;
          revoke_requested_at?: string | null;
          revoked_at?: string | null;
          status?: string;
          street?: string | null;
          updated_at?: string;
        };
        Update: {
          assigned_member_id?: string | null;
          birth_date?: string | null;
          building?: string | null;
          city?: string | null;
          close_reason?: string | null;
          created_at?: string;
          crm_tags?: string[];
          current_annual_income?: number | null;
          current_employment_type?: string | null;
          custom_fields?: Json;
          desired_annual_income?: number | null;
          desired_industries?: string[] | null;
          desired_locations?: string[] | null;
          desired_occupations?: string[] | null;
          email?: string;
          email_distribution_enabled?: boolean;
          email2?: string | null;
          encrypted_contact_method_preference?: string | null;
          encrypted_desired_conditions?: string | null;
          encrypted_education_detail?: string | null;
          encrypted_job_change_reason?: string | null;
          encrypted_meeting_notes?: string | null;
          encrypted_other_agency_status?: string | null;
          encrypted_recommendation_comment?: string | null;
          encrypted_skills?: string | null;
          encrypted_status_memo?: string | null;
          entry_site?: string | null;
          experience_industries?: string[] | null;
          experience_occupations?: string[] | null;
          final_education?: string | null;
          first_meeting_date?: string | null;
          gender?: string | null;
          id?: string;
          intake_date?: string | null;
          job_change_timing?: string | null;
          link_status?: string;
          linked_at?: string | null;
          linked_user_id?: string | null;
          marital_status?: string | null;
          name?: string;
          name_kana?: string | null;
          nationality?: string | null;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          phone2?: string | null;
          postal_code?: string | null;
          prefecture?: string | null;
          revoke_confirmed_via?: string | null;
          revoke_deadline?: string | null;
          revoke_requested_at?: string | null;
          revoked_at?: string | null;
          status?: string;
          street?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_records_assigned_member_id_fkey";
            columns: ["assigned_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_records_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_view_states: {
        Row: {
          client_record_id: string;
          last_viewed_at: string;
          organization_id: string;
          user_id: string;
        };
        Insert: {
          client_record_id: string;
          last_viewed_at?: string;
          organization_id: string;
          user_id: string;
        };
        Update: {
          client_record_id?: string;
          last_viewed_at?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_view_states_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_view_states_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_messages: {
        Row: {
          company: string;
          created_at: string;
          email: string;
          id: string;
          ip_address: unknown;
          message: string;
          name: string;
          notes: string | null;
          read_at: string | null;
          user_agent: string | null;
        };
        Insert: {
          company: string;
          created_at?: string;
          email: string;
          id?: string;
          ip_address?: unknown;
          message: string;
          name: string;
          notes?: string | null;
          read_at?: string | null;
          user_agent?: string | null;
        };
        Update: {
          company?: string;
          created_at?: string;
          email?: string;
          id?: string;
          ip_address?: unknown;
          message?: string;
          name?: string;
          notes?: string | null;
          read_at?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          created_at: string;
          encrypted_title: string | null;
          id: string;
          is_archived: boolean;
          last_message_at: string;
          message_count: number;
          metadata: Json | null;
          module: Database["public"]["Enums"]["module_type"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_title?: string | null;
          id?: string;
          is_archived?: boolean;
          last_message_at?: string;
          message_count?: number;
          metadata?: Json | null;
          module: Database["public"]["Enums"]["module_type"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_title?: string | null;
          id?: string;
          is_archived?: boolean;
          last_message_at?: string;
          message_count?: number;
          metadata?: Json | null;
          module?: Database["public"]["Enums"]["module_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cvs: {
        Row: {
          created_at: string;
          document_date: string | null;
          encrypted_body: string;
          id: string;
          license_resume_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          document_date?: string | null;
          encrypted_body: string;
          id?: string;
          license_resume_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          document_date?: string | null;
          encrypted_body?: string;
          id?: string;
          license_resume_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cvs_license_resume_id_fkey";
            columns: ["license_resume_id"];
            isOneToOne: false;
            referencedRelation: "resumes";
            referencedColumns: ["id"];
          },
        ];
      };
      document_drafts_from_agency: {
        Row: {
          accepted_at: string | null;
          accepted_into_id: string | null;
          client_record_id: string;
          created_at: string;
          created_by_user_id: string;
          document_type: string;
          encrypted_payload: string;
          id: string;
          message: string | null;
          organization_id: string;
          rejected_at: string | null;
          rescinded_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_into_id?: string | null;
          client_record_id: string;
          created_at?: string;
          created_by_user_id: string;
          document_type: string;
          encrypted_payload: string;
          id?: string;
          message?: string | null;
          organization_id: string;
          rejected_at?: string | null;
          rescinded_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_into_id?: string | null;
          client_record_id?: string;
          created_at?: string;
          created_by_user_id?: string;
          document_type?: string;
          encrypted_payload?: string;
          id?: string;
          message?: string | null;
          organization_id?: string;
          rejected_at?: string | null;
          rescinded_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_drafts_from_agency_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_drafts_from_agency_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      email_templates: {
        Row: {
          body: string;
          created_at: string;
          created_by_member_id: string | null;
          id: string;
          name: string;
          organization_id: string;
          subject: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          subject: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          subject?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      google_connections: {
        Row: {
          created_at: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          google_email: string | null;
          google_sub: string | null;
          id: string;
          last_drive_poll_at: string | null;
          scope: string | null;
          scopes_granted: string[];
          token_expires_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          google_email?: string | null;
          google_sub?: string | null;
          id?: string;
          last_drive_poll_at?: string | null;
          scope?: string | null;
          scopes_granted?: string[];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_access_token?: string;
          encrypted_refresh_token?: string;
          google_email?: string | null;
          google_sub?: string | null;
          id?: string;
          last_drive_poll_at?: string | null;
          scope?: string | null;
          scopes_granted?: string[];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      hearing_sheets: {
        Row: {
          ai_extracted_at: string | null;
          client_record_id: string;
          created_at: string;
          created_by_member_id: string | null;
          encrypted_content: string;
          human_reviewed_at: string | null;
          id: string;
          meeting_schedule_id: string | null;
          organization_id: string;
          source_recording_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          ai_extracted_at?: string | null;
          client_record_id: string;
          created_at?: string;
          created_by_member_id?: string | null;
          encrypted_content: string;
          human_reviewed_at?: string | null;
          id?: string;
          meeting_schedule_id?: string | null;
          organization_id: string;
          source_recording_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          ai_extracted_at?: string | null;
          client_record_id?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          encrypted_content?: string;
          human_reviewed_at?: string | null;
          id?: string;
          meeting_schedule_id?: string | null;
          organization_id?: string;
          source_recording_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hearing_sheets_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hearing_sheets_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hearing_sheets_meeting_schedule_id_fkey";
            columns: ["meeting_schedule_id"];
            isOneToOne: false;
            referencedRelation: "meeting_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hearing_sheets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hearing_sheets_source_recording_id_fkey";
            columns: ["source_recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      intake_forms: {
        Row: {
          created_at: string;
          created_by_member_id: string | null;
          entry_site: string | null;
          id: string;
          is_active: boolean;
          name: string;
          organization_id: string;
          token: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_member_id?: string | null;
          entry_site?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          organization_id: string;
          token?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_member_id?: string | null;
          entry_site?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          organization_id?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "intake_forms_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intake_forms_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_messages: {
        Row: {
          created_at: string;
          encrypted_content: string;
          id: string;
          role: string;
          session_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_content: string;
          id?: string;
          role: string;
          session_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_content?: string;
          id?: string;
          role?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interview_messages_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "interview_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      interview_sessions: {
        Row: {
          completed_at: string | null;
          created_at: string;
          encrypted_summary: string | null;
          id: string;
          position_context: Json;
          started_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          encrypted_summary?: string | null;
          id?: string;
          position_context?: Json;
          started_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          encrypted_summary?: string | null;
          id?: string;
          position_context?: Json;
          started_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      interviews: {
        Row: {
          created_at: string;
          created_by_user_id: string | null;
          id: string;
          kind: string;
          notes: string | null;
          organization_id: string;
          referral_id: string;
          result: string;
          scheduled_at: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string | null;
          id?: string;
          kind: string;
          notes?: string | null;
          organization_id: string;
          referral_id: string;
          result?: string;
          scheduled_at: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          organization_id?: string;
          referral_id?: string;
          result?: string;
          scheduled_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interviews_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interviews_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      job_postings: {
        Row: {
          application_qualifications: string | null;
          break_time: string | null;
          company_name: string;
          created_at: string;
          created_by_member_id: string | null;
          description: string | null;
          employment_type: string | null;
          hero_image_path: string | null;
          holidays: string | null;
          id: string;
          line_share_image_path: string | null;
          location: string | null;
          location_change_scope: string | null;
          organization_id: string;
          position: string;
          preferred_skills: string | null;
          probation_period: string | null;
          required_skills: string | null;
          salary_max: number | null;
          salary_min: number | null;
          smoking_prevention_measure: string | null;
          status: string;
          updated_at: string;
          work_change_scope: string | null;
          work_hours: string | null;
        };
        Insert: {
          application_qualifications?: string | null;
          break_time?: string | null;
          company_name: string;
          created_at?: string;
          created_by_member_id?: string | null;
          description?: string | null;
          employment_type?: string | null;
          hero_image_path?: string | null;
          holidays?: string | null;
          id?: string;
          line_share_image_path?: string | null;
          location?: string | null;
          location_change_scope?: string | null;
          organization_id: string;
          position: string;
          preferred_skills?: string | null;
          probation_period?: string | null;
          required_skills?: string | null;
          salary_max?: number | null;
          salary_min?: number | null;
          smoking_prevention_measure?: string | null;
          status?: string;
          updated_at?: string;
          work_change_scope?: string | null;
          work_hours?: string | null;
        };
        Update: {
          application_qualifications?: string | null;
          break_time?: string | null;
          company_name?: string;
          created_at?: string;
          created_by_member_id?: string | null;
          description?: string | null;
          employment_type?: string | null;
          hero_image_path?: string | null;
          holidays?: string | null;
          id?: string;
          line_share_image_path?: string | null;
          location?: string | null;
          location_change_scope?: string | null;
          organization_id?: string;
          position?: string;
          preferred_skills?: string | null;
          probation_period?: string | null;
          required_skills?: string | null;
          salary_max?: number | null;
          salary_min?: number | null;
          smoking_prevention_measure?: string | null;
          status?: string;
          updated_at?: string;
          work_change_scope?: string | null;
          work_hours?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_postings_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_postings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_broadcasts: {
        Row: {
          created_at: string;
          created_by_user_id: string;
          encrypted_content: string;
          error_message: string | null;
          failed_count: number;
          id: string;
          message_type: Database["public"]["Enums"]["line_message_type"];
          organization_id: string;
          scheduled_for: string | null;
          sent_at: string | null;
          sent_count: number;
          status: string;
          target_count: number;
          target_filter: Json;
        };
        Insert: {
          created_at?: string;
          created_by_user_id: string;
          encrypted_content: string;
          error_message?: string | null;
          failed_count?: number;
          id?: string;
          message_type: Database["public"]["Enums"]["line_message_type"];
          organization_id: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          status?: string;
          target_count: number;
          target_filter: Json;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string;
          encrypted_content?: string;
          error_message?: string | null;
          failed_count?: number;
          id?: string;
          message_type?: Database["public"]["Enums"]["line_message_type"];
          organization_id?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          status?: string;
          target_count?: number;
          target_filter?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "line_broadcasts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_channels: {
        Row: {
          created_at: string;
          default_rich_menu_id: string | null;
          is_active: boolean;
          last_verified_at: string | null;
          liff_id: string | null;
          line_bot_user_id: string | null;
          line_channel_access_token_encrypted: string;
          line_channel_id: string;
          line_channel_secret_encrypted: string;
          line_plan: string | null;
          linked_rich_menu_id: string | null;
          monthly_message_quota: number | null;
          organization_id: string;
          updated_at: string;
          webhook_token: string;
          welcome_message_enabled: boolean;
          welcome_message_encrypted: string | null;
        };
        Insert: {
          created_at?: string;
          default_rich_menu_id?: string | null;
          is_active?: boolean;
          last_verified_at?: string | null;
          liff_id?: string | null;
          line_bot_user_id?: string | null;
          line_channel_access_token_encrypted: string;
          line_channel_id: string;
          line_channel_secret_encrypted: string;
          line_plan?: string | null;
          linked_rich_menu_id?: string | null;
          monthly_message_quota?: number | null;
          organization_id: string;
          updated_at?: string;
          webhook_token: string;
          welcome_message_enabled?: boolean;
          welcome_message_encrypted?: string | null;
        };
        Update: {
          created_at?: string;
          default_rich_menu_id?: string | null;
          is_active?: boolean;
          last_verified_at?: string | null;
          liff_id?: string | null;
          line_bot_user_id?: string | null;
          line_channel_access_token_encrypted?: string;
          line_channel_id?: string;
          line_channel_secret_encrypted?: string;
          line_plan?: string | null;
          linked_rich_menu_id?: string | null;
          monthly_message_quota?: number | null;
          organization_id?: string;
          updated_at?: string;
          webhook_token?: string;
          welcome_message_enabled?: boolean;
          welcome_message_encrypted?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "line_channels_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_conversation_notes: {
        Row: {
          created_at: string;
          created_by_user_id: string | null;
          encrypted_content: string;
          id: string;
          line_user_id: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string | null;
          encrypted_content: string;
          id?: string;
          line_user_id: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string | null;
          encrypted_content?: string;
          id?: string;
          line_user_id?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_conversation_notes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_conversation_tag_assignments: {
        Row: {
          assigned_at: string;
          assigned_by_user_id: string | null;
          line_user_id: string;
          organization_id: string;
          tag_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by_user_id?: string | null;
          line_user_id: string;
          organization_id: string;
          tag_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by_user_id?: string | null;
          line_user_id?: string;
          organization_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_conversation_tag_assignments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_conversation_tag_assignments_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "line_conversation_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      line_conversation_tags: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_conversation_tags_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_link_codes: {
        Row: {
          client_record_id: string;
          code: string;
          consumed_at: string | null;
          consumed_by_line_user_id: string | null;
          created_at: string;
          expires_at: string;
          issued_by_user_id: string | null;
          organization_id: string;
        };
        Insert: {
          client_record_id: string;
          code: string;
          consumed_at?: string | null;
          consumed_by_line_user_id?: string | null;
          created_at?: string;
          expires_at: string;
          issued_by_user_id?: string | null;
          organization_id: string;
        };
        Update: {
          client_record_id?: string;
          code?: string;
          consumed_at?: string | null;
          consumed_by_line_user_id?: string | null;
          created_at?: string;
          expires_at?: string;
          issued_by_user_id?: string | null;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_link_codes_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_link_codes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_meeting_proposals: {
        Row: {
          candidates: Json;
          client_record_id: string | null;
          consumed_at: string | null;
          consumed_meeting_schedule_id: string | null;
          consumed_slot_index: number | null;
          created_at: string;
          created_by_user_id: string;
          duration_minutes: number;
          encrypted_agenda: string | null;
          expires_at: string;
          id: string;
          line_user_id: string;
          organization_id: string;
          provider: string;
          title: string;
        };
        Insert: {
          candidates: Json;
          client_record_id?: string | null;
          consumed_at?: string | null;
          consumed_meeting_schedule_id?: string | null;
          consumed_slot_index?: number | null;
          created_at?: string;
          created_by_user_id: string;
          duration_minutes?: number;
          encrypted_agenda?: string | null;
          expires_at: string;
          id?: string;
          line_user_id: string;
          organization_id: string;
          provider?: string;
          title: string;
        };
        Update: {
          candidates?: Json;
          client_record_id?: string | null;
          consumed_at?: string | null;
          consumed_meeting_schedule_id?: string | null;
          consumed_slot_index?: number | null;
          created_at?: string;
          created_by_user_id?: string;
          duration_minutes?: number;
          encrypted_agenda?: string | null;
          expires_at?: string;
          id?: string;
          line_user_id?: string;
          organization_id?: string;
          provider?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_meeting_proposals_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_meeting_proposals_consumed_meeting_schedule_id_fkey";
            columns: ["consumed_meeting_schedule_id"];
            isOneToOne: false;
            referencedRelation: "meeting_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_meeting_proposals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      line_messages: {
        Row: {
          attachment_storage_path: string | null;
          client_record_id: string | null;
          created_at: string;
          direction: Database["public"]["Enums"]["line_message_direction"];
          encrypted_content: string | null;
          id: string;
          line_message_id: string | null;
          line_user_id: string;
          message_type: Database["public"]["Enums"]["line_message_type"];
          organization_id: string;
          read_at: string | null;
          related_job_id: string | null;
          related_meeting_schedule_id: string | null;
          reply_token: string | null;
          reply_token_expires_at: string | null;
          send_error: string | null;
          send_method: string | null;
          send_status: string | null;
          sticker_id: string | null;
          sticker_package_id: string | null;
        };
        Insert: {
          attachment_storage_path?: string | null;
          client_record_id?: string | null;
          created_at?: string;
          direction: Database["public"]["Enums"]["line_message_direction"];
          encrypted_content?: string | null;
          id?: string;
          line_message_id?: string | null;
          line_user_id: string;
          message_type: Database["public"]["Enums"]["line_message_type"];
          organization_id: string;
          read_at?: string | null;
          related_job_id?: string | null;
          related_meeting_schedule_id?: string | null;
          reply_token?: string | null;
          reply_token_expires_at?: string | null;
          send_error?: string | null;
          send_method?: string | null;
          send_status?: string | null;
          sticker_id?: string | null;
          sticker_package_id?: string | null;
        };
        Update: {
          attachment_storage_path?: string | null;
          client_record_id?: string | null;
          created_at?: string;
          direction?: Database["public"]["Enums"]["line_message_direction"];
          encrypted_content?: string | null;
          id?: string;
          line_message_id?: string | null;
          line_user_id?: string;
          message_type?: Database["public"]["Enums"]["line_message_type"];
          organization_id?: string;
          read_at?: string | null;
          related_job_id?: string | null;
          related_meeting_schedule_id?: string | null;
          reply_token?: string | null;
          reply_token_expires_at?: string | null;
          send_error?: string | null;
          send_method?: string | null;
          send_status?: string | null;
          sticker_id?: string | null;
          sticker_package_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "line_messages_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_messages_related_job_id_fkey";
            columns: ["related_job_id"];
            isOneToOne: false;
            referencedRelation: "job_postings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_messages_related_meeting_schedule_id_fkey";
            columns: ["related_meeting_schedule_id"];
            isOneToOne: false;
            referencedRelation: "meeting_schedules";
            referencedColumns: ["id"];
          },
        ];
      };
      line_user_links: {
        Row: {
          assigned_at: string | null;
          assigned_by_user_id: string | null;
          assigned_to_user_id: string | null;
          client_record_id: string | null;
          created_at: string;
          custom_name: string | null;
          display_name: string | null;
          handled_at: string | null;
          handled_by_user_id: string | null;
          id: string;
          line_user_id: string;
          link_method: string | null;
          linked_at: string | null;
          organization_id: string;
          picture_url: string | null;
          status_message: string | null;
          unfollowed_at: string | null;
          updated_at: string;
        };
        Insert: {
          assigned_at?: string | null;
          assigned_by_user_id?: string | null;
          assigned_to_user_id?: string | null;
          client_record_id?: string | null;
          created_at?: string;
          custom_name?: string | null;
          display_name?: string | null;
          handled_at?: string | null;
          handled_by_user_id?: string | null;
          id?: string;
          line_user_id: string;
          link_method?: string | null;
          linked_at?: string | null;
          organization_id: string;
          picture_url?: string | null;
          status_message?: string | null;
          unfollowed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          assigned_at?: string | null;
          assigned_by_user_id?: string | null;
          assigned_to_user_id?: string | null;
          client_record_id?: string | null;
          created_at?: string;
          custom_name?: string | null;
          display_name?: string | null;
          handled_at?: string | null;
          handled_by_user_id?: string | null;
          id?: string;
          line_user_id?: string;
          link_method?: string | null;
          linked_at?: string | null;
          organization_id?: string;
          picture_url?: string | null;
          status_message?: string | null;
          unfollowed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "line_user_links_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "line_user_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ma_click_links: {
        Row: {
          click_count: number;
          created_at: string;
          id: string;
          last_clicked_at: string | null;
          organization_id: string;
          original_url: string;
          send_log_id: string | null;
        };
        Insert: {
          click_count?: number;
          created_at?: string;
          id?: string;
          last_clicked_at?: string | null;
          organization_id: string;
          original_url: string;
          send_log_id?: string | null;
        };
        Update: {
          click_count?: number;
          created_at?: string;
          id?: string;
          last_clicked_at?: string | null;
          organization_id?: string;
          original_url?: string;
          send_log_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ma_click_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_click_links_send_log_id_fkey";
            columns: ["send_log_id"];
            isOneToOne: false;
            referencedRelation: "ma_send_logs";
            referencedColumns: ["id"];
          },
        ];
      };
      ma_consent_log: {
        Row: {
          accepted_at: string;
          accepted_by_member_id: string;
          consent_version: string;
          created_at: string;
          feature: string;
          id: string;
          organization_id: string;
          revoked_at: string | null;
          revoked_by_member_id: string | null;
        };
        Insert: {
          accepted_at?: string;
          accepted_by_member_id: string;
          consent_version: string;
          created_at?: string;
          feature: string;
          id?: string;
          organization_id: string;
          revoked_at?: string | null;
          revoked_by_member_id?: string | null;
        };
        Update: {
          accepted_at?: string;
          accepted_by_member_id?: string;
          consent_version?: string;
          created_at?: string;
          feature?: string;
          id?: string;
          organization_id?: string;
          revoked_at?: string | null;
          revoked_by_member_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ma_consent_log_accepted_by_member_id_fkey";
            columns: ["accepted_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_consent_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_consent_log_revoked_by_member_id_fkey";
            columns: ["revoked_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      ma_scenario_presets: {
        Row: {
          audience: string;
          channel: string;
          created_at: string;
          default_trigger_days: number;
          description: string;
          id: string;
          key: string;
          name: string;
          sort_order: number;
          trigger_event: string;
        };
        Insert: {
          audience: string;
          channel: string;
          created_at?: string;
          default_trigger_days: number;
          description: string;
          id?: string;
          key: string;
          name: string;
          sort_order?: number;
          trigger_event: string;
        };
        Update: {
          audience?: string;
          channel?: string;
          created_at?: string;
          default_trigger_days?: number;
          description?: string;
          id?: string;
          key?: string;
          name?: string;
          sort_order?: number;
          trigger_event?: string;
        };
        Relationships: [];
      };
      ma_scenarios: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          organization_id: string;
          preset_id: string;
          trigger_days_override: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          organization_id: string;
          preset_id: string;
          trigger_days_override?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          organization_id?: string;
          preset_id?: string;
          trigger_days_override?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ma_scenarios_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_scenarios_preset_id_fkey";
            columns: ["preset_id"];
            isOneToOne: false;
            referencedRelation: "ma_scenario_presets";
            referencedColumns: ["id"];
          },
        ];
      };
      ma_send_logs: {
        Row: {
          created_at: string;
          encrypted_body: string;
          encrypted_subject: string;
          error_message: string | null;
          id: string;
          organization_id: string;
          recipient_client_record_id: string | null;
          recipient_email: string | null;
          recipient_line_user_id: string | null;
          resend_message_id: string | null;
          scenario_id: string;
          sent_at: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          encrypted_body: string;
          encrypted_subject: string;
          error_message?: string | null;
          id?: string;
          organization_id: string;
          recipient_client_record_id?: string | null;
          recipient_email?: string | null;
          recipient_line_user_id?: string | null;
          resend_message_id?: string | null;
          scenario_id: string;
          sent_at?: string;
          status: string;
        };
        Update: {
          created_at?: string;
          encrypted_body?: string;
          encrypted_subject?: string;
          error_message?: string | null;
          id?: string;
          organization_id?: string;
          recipient_client_record_id?: string | null;
          recipient_email?: string | null;
          recipient_line_user_id?: string | null;
          resend_message_id?: string | null;
          scenario_id?: string;
          sent_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ma_send_logs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_send_logs_recipient_client_record_id_fkey";
            columns: ["recipient_client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_send_logs_scenario_id_fkey";
            columns: ["scenario_id"];
            isOneToOne: false;
            referencedRelation: "ma_scenarios";
            referencedColumns: ["id"];
          },
        ];
      };
      ma_templates: {
        Row: {
          created_at: string;
          encrypted_body: string | null;
          encrypted_subject: string | null;
          id: string;
          organization_id: string;
          scenario_id: string;
          updated_at: string;
          updated_by_member_id: string | null;
        };
        Insert: {
          created_at?: string;
          encrypted_body?: string | null;
          encrypted_subject?: string | null;
          id?: string;
          organization_id: string;
          scenario_id: string;
          updated_at?: string;
          updated_by_member_id?: string | null;
        };
        Update: {
          created_at?: string;
          encrypted_body?: string | null;
          encrypted_subject?: string | null;
          id?: string;
          organization_id?: string;
          scenario_id?: string;
          updated_at?: string;
          updated_by_member_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ma_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_templates_scenario_id_fkey";
            columns: ["scenario_id"];
            isOneToOne: true;
            referencedRelation: "ma_scenarios";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ma_templates_updated_by_member_id_fkey";
            columns: ["updated_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      meeting_interview_shares: {
        Row: {
          applied_to_career_profile_at: string | null;
          created_at: string;
          encrypted_review_message: string | null;
          expires_at: string;
          id: string;
          meeting_schedule_id: string | null;
          recording_id: string;
          responded_at: string | null;
          seeker_user_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          applied_to_career_profile_at?: string | null;
          created_at?: string;
          encrypted_review_message?: string | null;
          expires_at?: string;
          id?: string;
          meeting_schedule_id?: string | null;
          recording_id: string;
          responded_at?: string | null;
          seeker_user_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          applied_to_career_profile_at?: string | null;
          created_at?: string;
          encrypted_review_message?: string | null;
          expires_at?: string;
          id?: string;
          meeting_schedule_id?: string | null;
          recording_id?: string;
          responded_at?: string | null;
          seeker_user_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_interview_shares_meeting_schedule_id_fkey";
            columns: ["meeting_schedule_id"];
            isOneToOne: false;
            referencedRelation: "meeting_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_interview_shares_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      meeting_schedules: {
        Row: {
          client_record_id: string | null;
          created_at: string;
          encrypted_agenda: string | null;
          ends_at: string;
          external_meeting_id: string;
          host_url: string | null;
          host_user_id: string;
          id: string;
          invited_at: string | null;
          invitee_email: string | null;
          invitee_name: string | null;
          join_url: string;
          organization_id: string | null;
          passcode: string | null;
          provider: string;
          recording_id: string | null;
          reminder_1h_sent_at: string | null;
          reminder_24h_sent_at: string | null;
          seeker_user_id: string | null;
          starts_at: string;
          status: string;
          timezone: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          client_record_id?: string | null;
          created_at?: string;
          encrypted_agenda?: string | null;
          ends_at: string;
          external_meeting_id: string;
          host_url?: string | null;
          host_user_id: string;
          id?: string;
          invited_at?: string | null;
          invitee_email?: string | null;
          invitee_name?: string | null;
          join_url: string;
          organization_id?: string | null;
          passcode?: string | null;
          provider: string;
          recording_id?: string | null;
          reminder_1h_sent_at?: string | null;
          reminder_24h_sent_at?: string | null;
          seeker_user_id?: string | null;
          starts_at: string;
          status?: string;
          timezone?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          client_record_id?: string | null;
          created_at?: string;
          encrypted_agenda?: string | null;
          ends_at?: string;
          external_meeting_id?: string;
          host_url?: string | null;
          host_user_id?: string;
          id?: string;
          invited_at?: string | null;
          invitee_email?: string | null;
          invitee_name?: string | null;
          join_url?: string;
          organization_id?: string | null;
          passcode?: string | null;
          provider?: string;
          recording_id?: string | null;
          reminder_1h_sent_at?: string | null;
          reminder_24h_sent_at?: string | null;
          seeker_user_id?: string | null;
          starts_at?: string;
          status?: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_schedules_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_schedules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_schedules_recording_id_fkey";
            columns: ["recording_id"];
            isOneToOne: false;
            referencedRelation: "career_intake_recordings";
            referencedColumns: ["id"];
          },
        ];
      };
      member_audit_log: {
        Row: {
          action: string;
          changed_at: string;
          changed_by_member_id: string | null;
          created_at: string;
          detail: Json | null;
          id: string;
          organization_id: string;
          target_member_id: string | null;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by_member_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          organization_id: string;
          target_member_id?: string | null;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by_member_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          id?: string;
          organization_id?: string;
          target_member_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "member_audit_log_changed_by_member_id_fkey";
            columns: ["changed_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_audit_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_audit_log_target_member_id_fkey";
            columns: ["target_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      member_permissions: {
        Row: {
          created_at: string;
          granted: boolean;
          granted_by_member_id: string | null;
          id: string;
          member_id: string;
          organization_id: string;
          permission_key: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          granted?: boolean;
          granted_by_member_id?: string | null;
          id?: string;
          member_id: string;
          organization_id: string;
          permission_key: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          granted?: boolean;
          granted_by_member_id?: string | null;
          id?: string;
          member_id?: string;
          organization_id?: string;
          permission_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_permissions_granted_by_member_id_fkey";
            columns: ["granted_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_permissions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_permissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          conversation_id: string;
          created_at: string;
          encrypted_content: string | null;
          encrypted_content_v2: string | null;
          encryption_iv: string | null;
          id: string;
          input_tokens: number | null;
          model_used: string | null;
          output_tokens: number | null;
          role: Database["public"]["Enums"]["message_role"];
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          encrypted_content?: string | null;
          encrypted_content_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          input_tokens?: number | null;
          model_used?: string | null;
          output_tokens?: number | null;
          role: Database["public"]["Enums"]["message_role"];
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          encrypted_content?: string | null;
          encrypted_content_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          input_tokens?: number | null;
          model_used?: string | null;
          output_tokens?: number | null;
          role?: Database["public"]["Enums"]["message_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at: string;
          encrypted_payload: string | null;
          error_message: string | null;
          id: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          read_at: string | null;
          scheduled_at: string;
          sent_at: string | null;
          user_id: string;
        };
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          encrypted_payload?: string | null;
          error_message?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["notification_kind"];
          read_at?: string | null;
          scheduled_at?: string;
          sent_at?: string | null;
          user_id: string;
        };
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"];
          created_at?: string;
          encrypted_payload?: string | null;
          error_message?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["notification_kind"];
          read_at?: string | null;
          scheduled_at?: string;
          sent_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_ai_quotas: {
        Row: {
          kind: string;
          monthly_limit: number | null;
          organization_id: string;
          updated_at: string;
          updated_by_member_id: string | null;
        };
        Insert: {
          kind: string;
          monthly_limit?: number | null;
          organization_id: string;
          updated_at?: string;
          updated_by_member_id?: string | null;
        };
        Update: {
          kind?: string;
          monthly_limit?: number | null;
          organization_id?: string;
          updated_at?: string;
          updated_by_member_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organization_ai_quotas_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_ai_quotas_updated_by_member_id_fkey";
            columns: ["updated_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by_member_id: string | null;
          organization_id: string;
          role: string;
          status: string;
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by_member_id?: string | null;
          organization_id: string;
          role: string;
          status?: string;
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by_member_id?: string | null;
          organization_id?: string;
          role?: string;
          status?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_member_id_fkey";
            columns: ["invited_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          notification_prefs: Json;
          organization_id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notification_prefs?: Json;
          organization_id: string;
          role?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notification_prefs?: Json;
          organization_id?: string;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_plans: {
        Row: {
          ai_boost_enabled: boolean;
          billing_exempt_reason: string | null;
          billing_exempt_set_at: string | null;
          billing_exempt_set_by_user_id: string | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_stripe_event_id: string | null;
          last_synced_at: string | null;
          next_billed_at: string | null;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_subscription_item_id_ai_boost: string | null;
          stripe_subscription_item_id_base: string | null;
          stripe_subscription_item_id_extra_seat: string | null;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string | null;
          trial_started_at: string | null;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at: string;
        };
        Insert: {
          ai_boost_enabled?: boolean;
          billing_exempt_reason?: string | null;
          billing_exempt_set_at?: string | null;
          billing_exempt_set_by_user_id?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          cycle?: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt?: boolean;
          last_stripe_event_id?: string | null;
          last_synced_at?: string | null;
          next_billed_at?: string | null;
          organization_id: string;
          seat_count?: number;
          status?: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_subscription_item_id_ai_boost?: string | null;
          stripe_subscription_item_id_base?: string | null;
          stripe_subscription_item_id_extra_seat?: string | null;
          tier?: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at?: string | null;
          trial_started_at?: string | null;
          trial_upgrade_choice?: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at?: string;
        };
        Update: {
          ai_boost_enabled?: boolean;
          billing_exempt_reason?: string | null;
          billing_exempt_set_at?: string | null;
          billing_exempt_set_by_user_id?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          cycle?: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt?: boolean;
          last_stripe_event_id?: string | null;
          last_synced_at?: string | null;
          next_billed_at?: string | null;
          organization_id?: string;
          seat_count?: number;
          status?: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          stripe_subscription_item_id_ai_boost?: string | null;
          stripe_subscription_item_id_base?: string | null;
          stripe_subscription_item_id_extra_seat?: string | null;
          tier?: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at?: string | null;
          trial_started_at?: string | null;
          trial_upgrade_choice?: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_plans_billing_exempt_set_by_user_id_fkey";
            columns: ["billing_exempt_set_by_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          archived_at: string | null;
          archived_reason: string | null;
          created_at: string;
          id: string;
          name: string;
          revoke_grace_days: number;
          slack_webhook_url: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          archived_reason?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          revoke_grace_days?: number;
          slack_webhook_url?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          archived_reason?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          revoke_grace_days?: number;
          slack_webhook_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      placements: {
        Row: {
          amount: number | null;
          commission_rate: number | null;
          created_at: string;
          created_by_member_id: string | null;
          event_date: string;
          event_type: string;
          expected_salary: number | null;
          id: string;
          notes: string | null;
          organization_id: string;
          payment_status: string | null;
          reason: string | null;
          referral_id: string;
          updated_at: string;
        };
        Insert: {
          amount?: number | null;
          commission_rate?: number | null;
          created_at?: string;
          created_by_member_id?: string | null;
          event_date: string;
          event_type: string;
          expected_salary?: number | null;
          id?: string;
          notes?: string | null;
          organization_id: string;
          payment_status?: string | null;
          reason?: string | null;
          referral_id: string;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          commission_rate?: number | null;
          created_at?: string;
          created_by_member_id?: string | null;
          event_date?: string;
          event_type?: string;
          expected_salary?: number | null;
          id?: string;
          notes?: string | null;
          organization_id?: string;
          payment_status?: string | null;
          reason?: string | null;
          referral_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "placements_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_ai_quotas: {
        Row: {
          created_at: string;
          kind: string;
          monthly_limit: number;
          notes: string | null;
          organization_id: string;
          set_by: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          kind: string;
          monthly_limit: number;
          notes?: string | null;
          organization_id: string;
          set_by?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          kind?: string;
          monthly_limit?: number;
          notes?: string | null;
          organization_id?: string;
          set_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_ai_quotas_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_ai_total_quotas: {
        Row: {
          created_at: string;
          monthly_limit: number;
          notes: string | null;
          organization_id: string;
          set_by: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          monthly_limit: number;
          notes?: string | null;
          organization_id: string;
          set_by?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          monthly_limit?: number;
          notes?: string | null;
          organization_id?: string;
          set_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_ai_total_quotas_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_announcement_reads: {
        Row: {
          acknowledged_at: string | null;
          announcement_id: string;
          read_at: string;
          user_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          announcement_id: string;
          read_at?: string;
          user_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          announcement_id?: string;
          read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_announcement_reads_announcement_id_fkey";
            columns: ["announcement_id"];
            isOneToOne: false;
            referencedRelation: "platform_announcements";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_announcements: {
        Row: {
          body: string;
          category: string;
          created_at: string;
          created_by: string | null;
          cta_label: string | null;
          cta_url: string | null;
          expires_at: string | null;
          id: string;
          is_pinned: boolean;
          published_at: string;
          require_ack: boolean;
          target_organization_ids: string[];
          target_type: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          expires_at?: string | null;
          id?: string;
          is_pinned?: boolean;
          published_at?: string;
          require_ack?: boolean;
          target_organization_ids?: string[];
          target_type?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          cta_url?: string | null;
          expires_at?: string | null;
          id?: string;
          is_pinned?: boolean;
          published_at?: string;
          require_ack?: boolean;
          target_organization_ids?: string[];
          target_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          account_type: string;
          archived_at: string | null;
          archived_reason: string | null;
          avatar_storage_path: string | null;
          created_at: string;
          display_name: string | null;
          encrypted_master_key: string;
          encrypted_master_key_by_recovery: string;
          id: string;
          is_maira_admin: boolean;
          onboarded_at: string | null;
          onboarding_completed: boolean;
          password_salt: string;
          preferred_industry: string | null;
          privacy_policy_accepted_at: string | null;
          privacy_policy_version: string | null;
          recovery_key_created_at: string;
          recovery_key_hint: string | null;
          updated_at: string;
        };
        Insert: {
          account_type?: string;
          archived_at?: string | null;
          archived_reason?: string | null;
          avatar_storage_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          encrypted_master_key?: string;
          encrypted_master_key_by_recovery?: string;
          id: string;
          is_maira_admin?: boolean;
          onboarded_at?: string | null;
          onboarding_completed?: boolean;
          password_salt?: string;
          preferred_industry?: string | null;
          privacy_policy_accepted_at?: string | null;
          privacy_policy_version?: string | null;
          recovery_key_created_at?: string;
          recovery_key_hint?: string | null;
          updated_at?: string;
        };
        Update: {
          account_type?: string;
          archived_at?: string | null;
          archived_reason?: string | null;
          avatar_storage_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          encrypted_master_key?: string;
          encrypted_master_key_by_recovery?: string;
          id?: string;
          is_maira_admin?: boolean;
          onboarded_at?: string | null;
          onboarding_completed?: boolean;
          password_salt?: string;
          preferred_industry?: string | null;
          privacy_policy_accepted_at?: string | null;
          privacy_policy_version?: string | null;
          recovery_key_created_at?: string;
          recovery_key_hint?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      recommendation_letter_templates: {
        Row: {
          created_at: string;
          created_by_member_id: string | null;
          id: string;
          name: string;
          organization_id: string;
          prefix_body: string;
          suffix_body: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          prefix_body: string;
          suffix_body: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by_member_id?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          prefix_body?: string;
          suffix_body?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_letter_templates_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_letter_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      recommendation_letters: {
        Row: {
          created_at: string;
          created_by_member_id: string | null;
          encrypted_body: string;
          encrypted_headline: string;
          finalized_at: string | null;
          id: string;
          organization_id: string;
          referral_id: string;
          status: string;
          template_id: string | null;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by_member_id?: string | null;
          encrypted_body: string;
          encrypted_headline: string;
          finalized_at?: string | null;
          id?: string;
          organization_id: string;
          referral_id: string;
          status?: string;
          template_id?: string | null;
          updated_at?: string;
          version: number;
        };
        Update: {
          created_at?: string;
          created_by_member_id?: string | null;
          encrypted_body?: string;
          encrypted_headline?: string;
          finalized_at?: string | null;
          id?: string;
          organization_id?: string;
          referral_id?: string;
          status?: string;
          template_id?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recommendation_letters_created_by_member_id_fkey";
            columns: ["created_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_letters_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_letters_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendation_letters_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "recommendation_letter_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_status_history: {
        Row: {
          changed_at: string;
          changed_by_member_id: string | null;
          created_at: string;
          from_status: string | null;
          id: string;
          memo: string | null;
          organization_id: string;
          referral_id: string;
          to_status: string;
        };
        Insert: {
          changed_at?: string;
          changed_by_member_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          memo?: string | null;
          organization_id: string;
          referral_id: string;
          to_status: string;
        };
        Update: {
          changed_at?: string;
          changed_by_member_id?: string | null;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          memo?: string | null;
          organization_id?: string;
          referral_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referral_status_history_changed_by_member_id_fkey";
            columns: ["changed_by_member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_status_history_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_status_history_referral_id_fkey";
            columns: ["referral_id"];
            isOneToOne: false;
            referencedRelation: "referrals";
            referencedColumns: ["id"];
          },
        ];
      };
      referrals: {
        Row: {
          client_record_id: string;
          created_at: string;
          id: string;
          job_posting_id: string;
          notes: string | null;
          organization_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          client_record_id: string;
          created_at?: string;
          id?: string;
          job_posting_id: string;
          notes?: string | null;
          organization_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          client_record_id?: string;
          created_at?: string;
          id?: string;
          job_posting_id?: string;
          notes?: string | null;
          organization_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referrals_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_job_posting_id_fkey";
            columns: ["job_posting_id"];
            isOneToOne: false;
            referencedRelation: "job_postings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      resumes: {
        Row: {
          created_at: string;
          document_date: string | null;
          encrypted_pii: string | null;
          id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          document_date?: string | null;
          encrypted_pii?: string | null;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          document_date?: string | null;
          encrypted_pii?: string | null;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      roi_simulations: {
        Row: {
          advisor_count: number;
          advisor_hourly_yen: number | null;
          avg_fee_man_yen: number;
          calculated_yearly_deal_uplift_yen: number;
          calculated_yearly_doc_savings_yen: number;
          calculated_yearly_lead_recovery_yen: number;
          calculated_yearly_total_yen: number;
          company_name: string;
          contact_name: string;
          created_at: string;
          doc_minutes_per_case: number;
          email: string;
          id: string;
          industry: string | null;
          ip_hash: string | null;
          monthly_clients: number;
          monthly_deals: number;
          monthly_lost_leads: number | null;
          phone: string | null;
          role: string | null;
          user_agent: string | null;
        };
        Insert: {
          advisor_count: number;
          advisor_hourly_yen?: number | null;
          avg_fee_man_yen: number;
          calculated_yearly_deal_uplift_yen?: number;
          calculated_yearly_doc_savings_yen?: number;
          calculated_yearly_lead_recovery_yen?: number;
          calculated_yearly_total_yen: number;
          company_name: string;
          contact_name: string;
          created_at?: string;
          doc_minutes_per_case: number;
          email: string;
          id?: string;
          industry?: string | null;
          ip_hash?: string | null;
          monthly_clients: number;
          monthly_deals: number;
          monthly_lost_leads?: number | null;
          phone?: string | null;
          role?: string | null;
          user_agent?: string | null;
        };
        Update: {
          advisor_count?: number;
          advisor_hourly_yen?: number | null;
          avg_fee_man_yen?: number;
          calculated_yearly_deal_uplift_yen?: number;
          calculated_yearly_doc_savings_yen?: number;
          calculated_yearly_lead_recovery_yen?: number;
          calculated_yearly_total_yen?: number;
          company_name?: string;
          contact_name?: string;
          created_at?: string;
          doc_minutes_per_case?: number;
          email?: string;
          id?: string;
          industry?: string | null;
          ip_hash?: string | null;
          monthly_clients?: number;
          monthly_deals?: number;
          monthly_lost_leads?: number | null;
          phone?: string | null;
          role?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      saved_views: {
        Row: {
          created_at: string;
          filters: Json;
          id: string;
          name: string;
          organization_id: string;
          resource: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          filters: Json;
          id?: string;
          name: string;
          organization_id: string;
          resource: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          filters?: Json;
          id?: string;
          name?: string;
          organization_id?: string;
          resource?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      seat_sync_failures: {
        Row: {
          created_at: string;
          error_message: string;
          id: string;
          next_retry_at: string;
          organization_id: string;
          resolved_at: string | null;
          retry_count: number;
          target_quantity: number;
        };
        Insert: {
          created_at?: string;
          error_message: string;
          id?: string;
          next_retry_at?: string;
          organization_id: string;
          resolved_at?: string | null;
          retry_count?: number;
          target_quantity: number;
        };
        Update: {
          created_at?: string;
          error_message?: string;
          id?: string;
          next_retry_at?: string;
          organization_id?: string;
          resolved_at?: string | null;
          retry_count?: number;
          target_quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "seat_sync_failures_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      seeker_doc_create_boosts: {
        Row: {
          effective_from: string;
          effective_until: string;
          id: string;
          multiplier_delta: number;
          purchased_at: string;
          refunded_at: string | null;
          stripe_session_id: string | null;
          user_id: string;
        };
        Insert: {
          effective_from: string;
          effective_until: string;
          id?: string;
          multiplier_delta?: number;
          purchased_at?: string;
          refunded_at?: string | null;
          stripe_session_id?: string | null;
          user_id: string;
        };
        Update: {
          effective_from?: string;
          effective_until?: string;
          id?: string;
          multiplier_delta?: number;
          purchased_at?: string;
          refunded_at?: string | null;
          stripe_session_id?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      seeker_job_interests: {
        Row: {
          client_record_id: string | null;
          created_at: string;
          encrypted_note: string | null;
          id: string;
          job_posting_id: string;
          user_id: string;
        };
        Insert: {
          client_record_id?: string | null;
          created_at?: string;
          encrypted_note?: string | null;
          id?: string;
          job_posting_id: string;
          user_id: string;
        };
        Update: {
          client_record_id?: string | null;
          created_at?: string;
          encrypted_note?: string | null;
          id?: string;
          job_posting_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seeker_job_interests_client_record_id_fkey";
            columns: ["client_record_id"];
            isOneToOne: false;
            referencedRelation: "client_records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "seeker_job_interests_job_posting_id_fkey";
            columns: ["job_posting_id"];
            isOneToOne: false;
            referencedRelation: "job_postings";
            referencedColumns: ["id"];
          },
        ];
      };
      seeker_job_recommendations: {
        Row: {
          encrypted_rankings: string;
          generated_at: string;
          id: string;
          inputs_hash: string;
          user_id: string;
        };
        Insert: {
          encrypted_rankings: string;
          generated_at?: string;
          id?: string;
          inputs_hash: string;
          user_id: string;
        };
        Update: {
          encrypted_rankings?: string;
          generated_at?: string;
          id?: string;
          inputs_hash?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      stripe_events: {
        Row: {
          error_message: string | null;
          id: string;
          processed_at: string | null;
          received_at: string;
          status: string;
          type: string;
        };
        Insert: {
          error_message?: string | null;
          id: string;
          processed_at?: string | null;
          received_at?: string;
          status?: string;
          type: string;
        };
        Update: {
          error_message?: string | null;
          id?: string;
          processed_at?: string | null;
          received_at?: string;
          status?: string;
          type?: string;
        };
        Relationships: [];
      };
      subscription_addons: {
        Row: {
          addon_key: string;
          created_at: string;
          current_period_end: string | null;
          id: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_item_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          addon_key: string;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          addon_key?: string;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_item_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          id: string;
          plan: Database["public"]["Enums"]["plan_type"];
          status: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id: string | null;
          stripe_price_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          plan?: Database["public"]["Enums"]["plan_type"];
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          id?: string;
          plan?: Database["public"]["Enums"]["plan_type"];
          status?: Database["public"]["Enums"]["subscription_status"];
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          application_id: string | null;
          created_at: string;
          due_at: string | null;
          encrypted_description: string | null;
          encrypted_description_v2: string | null;
          encrypted_title: string | null;
          encrypted_title_v2: string | null;
          encryption_iv: string | null;
          id: string;
          priority: number;
          reminded_at: string | null;
          status: Database["public"]["Enums"]["task_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          application_id?: string | null;
          created_at?: string;
          due_at?: string | null;
          encrypted_description?: string | null;
          encrypted_description_v2?: string | null;
          encrypted_title?: string | null;
          encrypted_title_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          priority?: number;
          reminded_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          application_id?: string | null;
          created_at?: string;
          due_at?: string | null;
          encrypted_description?: string | null;
          encrypted_description_v2?: string | null;
          encrypted_title?: string | null;
          encrypted_title_v2?: string | null;
          encryption_iv?: string | null;
          id?: string;
          priority?: number;
          reminded_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_logs: {
        Row: {
          amount: number;
          billing_period_start: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["usage_kind"];
          module: Database["public"]["Enums"]["module_type"] | null;
          user_id: string;
        };
        Insert: {
          amount?: number;
          billing_period_start: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["usage_kind"];
          module?: Database["public"]["Enums"]["module_type"] | null;
          user_id: string;
        };
        Update: {
          amount?: number;
          billing_period_start?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["usage_kind"];
          module?: Database["public"]["Enums"]["module_type"] | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      v_user_id: {
        Row: {
          id: string | null;
        };
        Insert: {
          id?: string | null;
        };
        Update: {
          id?: string | null;
        };
        Relationships: [];
      };
      zoom_connections: {
        Row: {
          created_at: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          id: string;
          scope: string | null;
          scopes_granted: string[];
          token_expires_at: string | null;
          updated_at: string;
          user_id: string;
          zoom_account_id: string | null;
          zoom_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          id?: string;
          scope?: string | null;
          scopes_granted?: string[];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id: string;
          zoom_account_id?: string | null;
          zoom_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          encrypted_access_token?: string;
          encrypted_refresh_token?: string;
          id?: string;
          scope?: string | null;
          scopes_granted?: string[];
          token_expires_at?: string | null;
          updated_at?: string;
          user_id?: string;
          zoom_account_id?: string | null;
          zoom_user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_client_invitation: { Args: never; Returns: string };
      accept_client_link: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      accept_invitation: { Args: { invitation_token: string }; Returns: string };
      admin_delete_platform_ai_quota: {
        Args: { p_kind: string; p_org_id: string };
        Returns: undefined;
      };
      admin_delete_platform_ai_total_quota: {
        Args: { p_org_id: string };
        Returns: undefined;
      };
      admin_get_platform_ai_total_quota: {
        Args: { p_org_id: string };
        Returns: {
          monthly_limit: number;
          notes: string;
          updated_at: string;
        }[];
      };
      admin_list_platform_ai_quotas: {
        Args: { p_org_id: string };
        Returns: {
          kind: string;
          monthly_limit: number;
          notes: string;
          updated_at: string;
        }[];
      };
      admin_set_organization_plan_tier: {
        Args: {
          p_organization_id: string;
          p_tier: Database["public"]["Enums"]["organization_plan_tier"];
        };
        Returns: {
          ai_boost_enabled: boolean;
          billing_exempt_reason: string | null;
          billing_exempt_set_at: string | null;
          billing_exempt_set_by_user_id: string | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_stripe_event_id: string | null;
          last_synced_at: string | null;
          next_billed_at: string | null;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_subscription_item_id_ai_boost: string | null;
          stripe_subscription_item_id_base: string | null;
          stripe_subscription_item_id_extra_seat: string | null;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string | null;
          trial_started_at: string | null;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_plans";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      admin_upsert_platform_ai_quota: {
        Args: {
          p_kind: string;
          p_monthly_limit: number;
          p_notes?: string;
          p_org_id: string;
        };
        Returns: undefined;
      };
      admin_upsert_platform_ai_total_quota: {
        Args: { p_monthly_limit: number; p_notes?: string; p_org_id: string };
        Returns: undefined;
      };
      apply_stripe_subscription_sync: {
        Args: {
          p_ai_boost_enabled: boolean;
          p_canceled_at: string;
          p_current_period_end: string;
          p_current_period_start: string;
          p_cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          p_event_created_at: string;
          p_event_id: string;
          p_next_billed_at: string;
          p_organization_id: string;
          p_seat_count: number;
          p_status: Database["public"]["Enums"]["organization_plan_status"];
          p_stripe_customer_id: string;
          p_stripe_item_ai_boost: string;
          p_stripe_item_base: string;
          p_stripe_item_extra_seat: string;
          p_stripe_subscription_id: string;
          p_tier: Database["public"]["Enums"]["organization_plan_tier"];
        };
        Returns: {
          ai_boost_enabled: boolean;
          billing_exempt_reason: string | null;
          billing_exempt_set_at: string | null;
          billing_exempt_set_by_user_id: string | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_stripe_event_id: string | null;
          last_synced_at: string | null;
          next_billed_at: string | null;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_subscription_item_id_ai_boost: string | null;
          stripe_subscription_item_id_base: string | null;
          stripe_subscription_item_id_extra_seat: string | null;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string | null;
          trial_started_at: string | null;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_plans";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      approve_revoke_client_link: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      auto_finalize_expired_revokes: { Args: never; Returns: number };
      cancel_client_invitation: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      change_member_permission: {
        Args: {
          granted: boolean;
          p_permission_key: string;
          target_member_id: string;
        };
        Returns: undefined;
      };
      change_member_role: {
        Args: { new_role: string; target_member_id: string };
        Returns: undefined;
      };
      consume_line_link_code: {
        Args: {
          p_code: string;
          p_line_user_id: string;
          p_organization_id: string;
        };
        Returns: string;
      };
      count_org_ai_usage_this_month: {
        Args: { p_kind: string; p_month_start: string };
        Returns: number;
      };
      count_org_ai_usage_total_this_month: {
        Args: { p_month_start: string };
        Returns: number;
      };
      current_user_email: { Args: never; Returns: string };
      current_user_organization_id: { Args: never; Returns: string };
      current_user_organization_role: { Args: never; Returns: string };
      deactivate_member: { Args: { target_member_id: string }; Returns: string };
      get_client_distribution_stats: {
        Args: { p_organization_id: string };
        Returns: {
          bucket_kind: string;
          bucket_value: string;
          cnt: number;
        }[];
      };
      get_job_for_seeker: {
        Args: { p_job_id: string };
        Returns: {
          application_qualifications: string;
          break_time: string;
          company_name: string;
          created_at: string;
          description: string;
          employment_type: string;
          holidays: string;
          id: string;
          job_position: string;
          location: string;
          location_change_scope: string;
          organization_id: string;
          organization_name: string;
          preferred_skills: string;
          probation_period: string;
          required_skills: string;
          salary_max: number;
          salary_min: number;
          smoking_prevention_measure: string;
          status: string;
          updated_at: string;
          work_change_scope: string;
          work_hours: string;
        }[];
      };
      get_linked_client_encrypted_career_profile: {
        Args: { p_client_record_id: string };
        Returns: string;
      };
      get_my_organization_plan: {
        Args: never;
        Returns: {
          ai_boost_enabled: boolean;
          canceled_at: string;
          created_at: string;
          current_period_end: string;
          current_period_start: string;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_synced_at: string;
          next_billed_at: string;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string;
          stripe_subscription_id: string;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string;
          trial_started_at: string;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"];
          updated_at: string;
        }[];
      };
      get_org_ai_usage_summary: {
        Args: { p_month_start: string };
        Returns: {
          display_name: string;
          email: string;
          event_count: number;
          kind: string;
          user_id: string;
        }[];
      };
      get_organization_ai_quotas: {
        Args: never;
        Returns: {
          kind: string;
          monthly_limit: number;
          updated_at: string;
          updated_by_member_id: string;
        }[];
      };
      get_platform_ai_quota_for_caller: {
        Args: { p_kind: string };
        Returns: number;
      };
      get_platform_ai_total_quota_for_caller: { Args: never; Returns: number };
      get_referral_kpi_by_member: {
        Args: {
          p_end_date: string;
          p_organization_id: string;
          p_start_date: string;
        };
        Returns: {
          member_email: string;
          member_id: string;
          member_name: string;
          placement_rate: number;
          total_interviews: number;
          total_placements: number;
          total_referrals: number;
        }[];
      };
      get_referral_kpi_summary: {
        Args: {
          p_end_date: string;
          p_organization_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      get_seeker_doc_create_boost_count: {
        Args: { p_month_start: string };
        Returns: number;
      };
      get_seeker_quota_for_kind: { Args: { p_kind: string }; Returns: number };
      increment_conversation_message_count: {
        Args: { conversation_id_param: string };
        Returns: undefined;
      };
      invite_client_record: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      issue_client_invitation: {
        Args: {
          p_client_record_id: string;
          p_expires_at: string;
          p_token: string;
        };
        Returns: string;
      };
      issue_invitation: {
        Args: {
          invitation_email: string;
          invitation_expires_at: string;
          invitation_role: string;
          invitation_token: string;
        };
        Returns: string;
      };
      issue_line_link_code: {
        Args: { p_client_record_id: string };
        Returns: string;
      };
      list_birthday_clients_today_for_org: {
        Args: { p_organization_id: string };
        Returns: {
          assigned_member_id: string;
          email: string;
          id: string;
          name: string;
        }[];
      };
      list_linked_clients_career_profile_updated_at: {
        Args: { p_client_record_ids: string[] };
        Returns: {
          client_record_id: string;
          updated_at: string;
        }[];
      };
      list_open_jobs_for_seeker: {
        Args: { p_limit?: number };
        Returns: {
          company_name: string;
          created_at: string;
          description: string;
          employment_type: string;
          id: string;
          job_position: string;
          location: string;
          organization_id: string;
          organization_name: string;
          preferred_skills: string;
          required_skills: string;
          salary_max: number;
          salary_min: number;
          status: string;
          updated_at: string;
        }[];
      };
      list_organization_member_avatars: {
        Args: { target_organization_id: string };
        Returns: {
          avatar_storage_path: string;
          member_id: string;
          user_id: string;
        }[];
      };
      list_organization_member_display_names: {
        Args: { target_organization_id: string };
        Returns: {
          display_name: string;
          member_id: string;
        }[];
      };
      list_organization_members_with_meta: {
        Args: { target_organization_id: string };
        Returns: {
          avatar_storage_path: string;
          created_at: string;
          display_name: string;
          email: string;
          member_id: string;
          role: string;
          user_id: string;
        }[];
      };
      list_seeker_referrals_with_jobs: {
        Args: never;
        Returns: {
          client_record_id: string;
          created_at: string;
          job_company_name: string;
          job_employment_type: string;
          job_location: string;
          job_position: string;
          job_posting_id: string;
          job_salary_max: number;
          job_salary_min: number;
          organization_id: string;
          organization_name: string;
          referral_id: string;
          status: string;
          updated_at: string;
        }[];
      };
      list_seeker_requested_job_ids: { Args: never; Returns: string[] };
      merge_client_records: {
        Args: { source_id: string; target_id: string };
        Returns: undefined;
      };
      reject_client_link: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      request_referral_as_seeker: {
        Args: { p_job_posting_id: string };
        Returns: string;
      };
      revoke_client_link: {
        Args: { p_client_record_id: string };
        Returns: undefined;
      };
      revoke_invitation: { Args: { invitation_id: string }; Returns: undefined };
      set_trial_upgrade_choice: {
        Args: {
          p_choice: Database["public"]["Enums"]["organization_plan_tier"];
        };
        Returns: {
          ai_boost_enabled: boolean;
          billing_exempt_reason: string | null;
          billing_exempt_set_at: string | null;
          billing_exempt_set_by_user_id: string | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_stripe_event_id: string | null;
          last_synced_at: string | null;
          next_billed_at: string | null;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_subscription_item_id_ai_boost: string | null;
          stripe_subscription_item_id_base: string | null;
          stripe_subscription_item_id_extra_seat: string | null;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string | null;
          trial_started_at: string | null;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_plans";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      start_organization_trial: {
        Args: { p_trial_days?: number };
        Returns: {
          ai_boost_enabled: boolean;
          billing_exempt_reason: string | null;
          billing_exempt_set_at: string | null;
          billing_exempt_set_by_user_id: string | null;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          cycle: Database["public"]["Enums"]["organization_billing_cycle"];
          is_billing_exempt: boolean;
          last_stripe_event_id: string | null;
          last_synced_at: string | null;
          next_billed_at: string | null;
          organization_id: string;
          seat_count: number;
          status: Database["public"]["Enums"]["organization_plan_status"];
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          stripe_subscription_item_id_ai_boost: string | null;
          stripe_subscription_item_id_base: string | null;
          stripe_subscription_item_id_extra_seat: string | null;
          tier: Database["public"]["Enums"]["organization_plan_tier"];
          trial_ends_at: string | null;
          trial_started_at: string | null;
          trial_upgrade_choice: Database["public"]["Enums"]["organization_plan_tier"] | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_plans";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      upsert_organization_ai_quota: {
        Args: { p_kind: string; p_monthly_limit: number };
        Returns: undefined;
      };
    };
    Enums: {
      application_status:
        | "considering"
        | "applied"
        | "document_review"
        | "interview"
        | "offer"
        | "rejected"
        | "declined"
        | "withdrawn";
      audit_action:
        | "login"
        | "logout"
        | "password_changed"
        | "recovery_key_regenerated"
        | "data_exported"
        | "account_deleted"
        | "subscription_changed"
        | "admin_force_deleted_user"
        | "account_export_requested"
        | "privacy_policy_accepted"
        | "admin_accessed_user";
      line_message_direction: "inbound" | "outbound";
      line_message_type:
        | "text"
        | "sticker"
        | "image"
        | "video"
        | "audio"
        | "file"
        | "location"
        | "flex"
        | "template"
        | "system";
      message_role: "user" | "assistant" | "system";
      module_type:
        | "career_inventory"
        | "document_writer"
        | "application_tracker"
        | "interview_simulator";
      notification_channel: "email" | "push" | "in_app";
      notification_kind:
        | "task_reminder"
        | "application_followup"
        | "milestone_check"
        | "subscription_event"
        | "system"
        | "advisor_message";
      organization_billing_cycle: "monthly" | "yearly";
      organization_plan_status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
      organization_plan_tier: "standard" | "standard_rec" | "standard_pro" | "standard_premium";
      plan_type: "free" | "standard" | "pro";
      subscription_status: "active" | "past_due" | "canceled" | "trialing" | "incomplete";
      task_status: "pending" | "done" | "skipped" | "overdue";
      usage_kind: "message_sent" | "interview_session" | "document_generated" | "voice_minutes";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      application_status: [
        "considering",
        "applied",
        "document_review",
        "interview",
        "offer",
        "rejected",
        "declined",
        "withdrawn",
      ],
      audit_action: [
        "login",
        "logout",
        "password_changed",
        "recovery_key_regenerated",
        "data_exported",
        "account_deleted",
        "subscription_changed",
        "admin_force_deleted_user",
        "account_export_requested",
        "privacy_policy_accepted",
        "admin_accessed_user",
      ],
      line_message_direction: ["inbound", "outbound"],
      line_message_type: [
        "text",
        "sticker",
        "image",
        "video",
        "audio",
        "file",
        "location",
        "flex",
        "template",
        "system",
      ],
      message_role: ["user", "assistant", "system"],
      module_type: [
        "career_inventory",
        "document_writer",
        "application_tracker",
        "interview_simulator",
      ],
      notification_channel: ["email", "push", "in_app"],
      notification_kind: [
        "task_reminder",
        "application_followup",
        "milestone_check",
        "subscription_event",
        "system",
        "advisor_message",
      ],
      organization_billing_cycle: ["monthly", "yearly"],
      organization_plan_status: ["trialing", "active", "past_due", "canceled", "incomplete"],
      organization_plan_tier: ["standard", "standard_rec", "standard_pro", "standard_premium"],
      plan_type: ["free", "standard", "pro"],
      subscription_status: ["active", "past_due", "canceled", "trialing", "incomplete"],
      task_status: ["pending", "done", "skipped", "overdue"],
      usage_kind: ["message_sent", "interview_session", "document_generated", "voice_minutes"],
    },
  },
} as const;
