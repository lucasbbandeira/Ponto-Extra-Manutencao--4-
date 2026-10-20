import type { Profile } from './types.ts'

export function permissions(profile: Profile) {
  const enabled = profile.active && profile.approval_status === 'approved'
  return {
    manager: profile.role !== 'maintainer',
    canApprove: enabled && (profile.role === 'admin' || (profile.role === 'supervisor' && profile.can_approve)),
    canExport: enabled && (profile.role === 'admin' || profile.role === 'analyst' || (profile.role === 'supervisor' && profile.can_export)),
    canManageUsers: enabled && profile.role === 'admin',
    canSubmit: enabled && profile.role === 'maintainer',
    canDelete: enabled && profile.role === 'admin',
  }
}
