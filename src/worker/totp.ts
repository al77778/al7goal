// Minimal TOTP (RFC 6238) helpers using Web Crypto.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i])
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, msg)
  return new Uint8Array(sig)
}

export async function totpCode(secret: string, time: number = Date.now()): Promise<string> {
  const counter = Math.floor(time / 1000 / 30)
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setBigUint64(0, BigInt(counter))
  const hmac = await hmacSha1(base32Decode(secret), new Uint8Array(buf))
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 1000000).padStart(6, '0')
}

export async function verifyTotp(secret: string, code: string, window: number = 1): Promise<boolean> {
  const now = Date.now()
  for (let i = -window; i <= window; i++) {
    const t = now + i * 30000
    const expected = await totpCode(secret, t)
    if (expected === code.trim()) return true
  }
  return false
}

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}
