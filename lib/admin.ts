// Single admin gate for every admin route/page. Server-only.
//
// An admin is a signed-in Clerk user whose PRIMARY email address is VERIFIED and listed in
// ADMIN_EMAILS (comma-separated). Never use `emailAddresses[0]`: Clerk does not guarantee
// array order and unverified addresses can sit on a user object, so matching the first
// entry would let someone who merely *added* an admin's address pass the gate.
// Fails closed: an unset/empty ADMIN_EMAILS means nobody is an admin.

import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'

type ClerkEmail = { id: string; emailAddress: string; verification: { status: string } | null }
type ClerkUserLike = { primaryEmailAddressId: string | null; emailAddresses: ClerkEmail[] }

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** The user's primary email, lower-cased, only if Clerk has verified it; otherwise null. */
export function getVerifiedPrimaryEmail(user: ClerkUserLike | null | undefined): string | null {
  if (!user?.primaryEmailAddressId) return null
  const primary = user.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId)
  if (!primary || primary.verification?.status !== 'verified') return null
  return primary.emailAddress.trim().toLowerCase() || null
}

export function isAdminClerkUser(user: ClerkUserLike | null | undefined): boolean {
  const admins = getAdminEmails()
  if (admins.length === 0) return false // fail closed when ADMIN_EMAILS is unset
  const email = getVerifiedPrimaryEmail(user)
  return !!email && admins.includes(email)
}

/** Returns the calling admin's Clerk userId, or null if the caller is not an admin. */
export async function requireAdmin(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null
  const user = await currentUser()
  if (!user || user.id !== userId) return null
  return isAdminClerkUser(user) ? userId : null
}

/** Admin check for an arbitrary Clerk userId (e.g. outside a request's own session). */
export async function isAdminUserId(userId: string): Promise<boolean> {
  if (!userId) return false
  if (getAdminEmails().length === 0) return false
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    return isAdminClerkUser(user)
  } catch {
    return false // fail closed on lookup errors
  }
}
