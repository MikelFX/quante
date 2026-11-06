// Wallet ownership proof for Qbox services: the seller signs our challenge (lib/qbox/services/
// model.ts walletChallenge) with its wallet key, EIP-191 personal_sign, and we recover the address.
// We never see or store a key. Plain externally-owned accounts only (smart-contract wallets would need
// an on-chain EIP-1271 call; not supported yet). Pure, tested in __tests__/qbox-services.test.mjs.

import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

const enc = new TextEncoder()

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** keccak256("\x19Ethereum Signed Message:\n" + len + message) */
export function personalHash(message: string): Uint8Array {
  const m = enc.encode(message)
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${m.length}`)
  const all = new Uint8Array(prefix.length + m.length)
  all.set(prefix)
  all.set(m, prefix.length)
  return keccak_256(all)
}

/** Uncompressed public key (65 bytes, 0x04…) → 0x address, lowercase. */
export function addressOf(publicKey: Uint8Array): string {
  return '0x' + hex(keccak_256(publicKey.slice(1)).slice(12))
}

/** The address that signed `message` (65-byte hex signature, v = 27/28 or 0/1), or null. */
export function recoverSigner(message: string, signature: unknown): string | null {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null
  try {
    const bytes = Uint8Array.from(signature.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))
    let v = bytes[64]
    if (v >= 27) v -= 27
    if (v !== 0 && v !== 1) return null
    const sig = secp256k1.Signature.fromCompact(bytes.slice(0, 64)).addRecoveryBit(v)
    if (sig.hasHighS()) return null
    const pub = sig.recoverPublicKey(personalHash(message)).toRawBytes(false)
    return addressOf(pub)
  } catch {
    return null
  }
}

/** Did `address` sign `message`? */
export function signedBy(message: string, signature: unknown, address: string): boolean {
  const who = recoverSigner(message, signature)
  return !!who && who === address.toLowerCase()
}
