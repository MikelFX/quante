import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

/** Labelled input: mono caps label, 54 px field, 16 px radius, mint focus ring. */
export function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="fl">
      <span>{label}</span>
      <input type="text" {...input} />
    </label>
  )
}

export function TextArea({ label, ...input }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="fl">
      <span>{label}</span>
      <textarea rows={4} {...input} />
    </label>
  )
}
