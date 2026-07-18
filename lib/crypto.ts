// AES-256-GCM encryption for merchant payment credentials stored in project_secrets.
// Key: SECRETS_ENCRYPTION_KEY env var — 32 bytes, base64 or hex encoded.
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'

function getKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) return null
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must decode to 32 bytes')
  return buf
}

export function isEncryptionConfigured(): boolean {
  return !!process.env.SECRETS_ENCRYPTION_KEY
}

export function encryptSecret(plain: string): string {
  const key = getKey()
  if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is not configured')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

// Values without the enc: prefix are legacy plaintext and pass through unchanged.
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith(PREFIX)) return value
  const key = getKey()
  if (!key) throw new Error('SECRETS_ENCRYPTION_KEY is not configured — cannot decrypt stored secret')
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
