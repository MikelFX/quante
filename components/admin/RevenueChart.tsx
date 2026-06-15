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
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', background: '#0d0d11', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <p style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#8a8a93', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>
          Revenue ({currency})
        </p>
        <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,.04)', borderRadius: 7, padding: 3 }}>
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
                border: 'none', cursor: 'pointer',
                background: days === d ? 'rgba(255,255,255,.1)' : 'transparent',
                color: days === d ? '#f4f4f6' : '#8a8a93',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 140, borderRadius: 8, background: 'rgba(255,255,255,.03)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ) : !hasData ? (
        <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#5b5b64', margin: 0 }}>No paid orders in this period</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3ecf8e" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3ecf8e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={v => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}` }}
              tick={{ fill: '#5b5b64', fontSize: 10 }}
              axisLine={false} tickLine={false}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis tick={{ fill: '#5b5b64', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#1a1a22', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#8a8a93', marginBottom: 4 }}
              itemStyle={{ color: '#3ecf8e' }}
              formatter={(v) => [`${currency} ${Number(v).toFixed(2)}`, 'Revenue']}
              labelFormatter={v => new Date(v as string).toLocaleDateString('cs-CZ')}
            />
            <Area
              type="monotone" dataKey="revenue"
              stroke="#3ecf8e" strokeWidth={2}
              fill="url(#rev-grad)"
              dot={false} activeDot={{ r: 4, fill: '#3ecf8e' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
