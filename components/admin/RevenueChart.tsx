'use client'

import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface DayPoint { date: string; revenue: number; orders: number }

interface Props { projectId: string }

export function RevenueChart({ projectId }: Props) {
  const [data, setData] = useState<DayPoint[]>([])
  const [currency, setCurrency] = useState('CZK')
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/projects/${projectId}/revenue?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d.chartData ?? []); setCurrency(d.currency ?? 'CZK') })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, days])

  const hasData = data.some(d => d.revenue > 0)

  return (
    <div style={{ borderRadius: 12, border: '1px solid rgb(var(--q-ink-rgb) / .07)', background: 'var(--q-s1)', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ fontSize: 12, fontFamily: 'var(--q-mono)', color: 'var(--q-fg3)', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>
          Revenue ({currency})
        </p>
        <div style={{ display: 'flex', gap: 3, background: 'rgb(var(--q-ink-rgb) / .04)', borderRadius: 7, padding: 3 }}>
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
                border: 'none', cursor: 'pointer',
                background: days === d ? 'rgb(var(--q-ink-rgb) / .1)' : 'transparent',
                color: days === d ? 'var(--q-fg)' : 'var(--q-fg3)',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 140, borderRadius: 8, background: 'rgb(var(--q-ink-rgb) / .03)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ) : !hasData ? (
        <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--q-fg4)', margin: 0 }}>No paid orders in this period</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--q-ok)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--q-ok)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--q-ink-rgb) / .05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}` }}
              tick={{ fill: 'var(--q-fg4)', fontSize: 10 }}
              axisLine={false} tickLine={false}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis tick={{ fill: 'var(--q-fg4)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--q-s3)', border: '1px solid rgb(var(--q-ink-rgb) / .1)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--q-fg3)', marginBottom: 4 }}
              itemStyle={{ color: 'var(--q-ok-text)' }}
              formatter={(v) => [`${currency} ${Number(v).toFixed(2)}`, 'Revenue']}
              labelFormatter={v => new Date(v as string).toLocaleDateString('en-GB')}
            />
            <Area
              type="monotone" dataKey="revenue"
              stroke="var(--q-ok)" strokeWidth={2}
              fill="url(#rev-grad)"
              dot={false} activeDot={{ r: 4, fill: 'var(--q-ok)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
