export default function PreviewNotFound() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', textAlign: 'center', padding: '2rem',
      background: '#f8f8f8', color: '#444',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div>
        <p style={{ fontSize: 48, fontWeight: 700, color: '#ccc', margin: '0 0 0.5rem' }}>404</p>
        <p style={{ fontSize: 15, margin: 0 }}>Page not found in preview</p>
        <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
          This link may not be set up yet. Edit the store to fix it.
        </p>
      </div>
    </div>
  )
}
