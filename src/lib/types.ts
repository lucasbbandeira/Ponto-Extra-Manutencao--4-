export type Role = 'admin' | 'supervisor' | 'maintainer'
export type Status = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  approval_status: 'pending' | 'approved' | 'rejected'
  can_approve: boolean
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

export interface Entry {
  id: string
  worker_id: string
  work_date: string
  normal_entry: string | null
  point_exit: string
  final_exit: string
  final_exit_next_day: boolean
  minutes: number
  note: string
  status: Status
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  submitted_at: string
  updated_at: string
}

export interface EntryInput {
  work_date: string
  normal_entry: string | null
  point_exit: string
  final_exit: string
  final_exit_next_day: boolean
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
  profiles: Profile[]
  entries: Entry[]
  invitations: Invitation[]
}
