'use client'

export default function PreviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', textAlign: 'center', padding: '2rem',
      background: '#f8f8f8', color: '#444',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div>
        <p style={{ fontSize: 48, fontWeight: 700, color: '#ccc', margin: '0 0 0.5rem' }}>500</p>
        <p style={{ fontSize: 15, margin: '0 0 1rem' }}>Preview error</p>
        <button
          onClick={reset}
          style={{
            fontSize: 13, padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #ddd', background: '#fff', color: '#444',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
