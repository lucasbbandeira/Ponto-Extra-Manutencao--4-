export type Role = 'admin' | 'supervisor' | 'maintainer' | 'analyst'
export type Status = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  approval_status: 'pending' | 'approved' | 'rejected'
  can_approve: boolean
  he_reminder_delay_hours?: 24 | 48
  receive_he_reminders?: boolean
  can_export: boolean
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  email: string
  full_name: string
  role: Role
  status: 'pending' | 'claimed' | 'revoked'
  invited_by: string | null
  claimed_by: string | null
  created_at: string
  claimed_at: string | null
}

export interface ServiceActivity {
  start: string
  end: string
  start_next_day: boolean
  end_next_day: boolean
  description: string
}
export interface Attachment { path: string; name: string; mime: string; size: number }
export interface Participant { id: string; name: string }
export interface Coworker { id: string; full_name: string }

export interface Entry {
  id: string
  workflow_version?: number
  activities?: ServiceActivity[]
  participants?: Participant[]
  attachments?: Attachment[]
  worker_id: string
  work_date: string
  normal_entry: string | null
  point_exit: string | null
  is_holiday?: boolean
  overtime_start?: string | null
  final_exit: string
  final_exit_next_day: boolean
  minutes: number
  location?: string | null
  glpi?: string | null
  note: string
  status: Status
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  submitted_at: string
  updated_at: string
}

export interface EntryInput {
  request_id?: string
  activities?: ServiceActivity[]
  helper_ids?: string[]
  attachments?: Attachment[]
  is_holiday: boolean
  work_date: string
  normal_entry: string
  point_exit: string
  overtime_start: string
  final_exit: string
  final_exit_next_day: boolean
  location?: string | null
  glpi?: string | null
  note: string
}

export interface Event {
  id: number
  entry_id: string
  actor_id: string | null
  action: 'submitted' | 'approved' | 'rejected' | 'revised'
  snapshot: Entry
  created_at: string
}

export interface DataSet {
  coworkers?: Coworker[]
  profiles: Profile[]
  entries: Entry[]
  invitations: Invitation[]
}
