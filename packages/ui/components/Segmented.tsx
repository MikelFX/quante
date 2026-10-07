'use client'

import { cx } from './primitives'

/** Two-option glass switch with a sliding mint indicator (Předplatné / Jednorázově). */
export function Segmented<T extends string>({ options, value, onChange, label, className }: {
  options: [{ value: T; label: string }, { value: T; label: string }]
  value: T
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  const right = value === options[1].value
  return (
    <div className={cx('seg glass', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      <i className={right ? 'seg-i r' : 'seg-i'} aria-hidden="true" />
    </div>
  )
}

/** Single-choice chips (Co potřebujete). */
export function ChipGroup({ legend, options, value, onChange }: { legend: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="fs">
      <legend>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <button key={o} type="button" className={o === value ? 'chip on' : 'chip'} aria-pressed={o === value} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
