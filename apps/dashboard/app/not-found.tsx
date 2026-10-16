import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="app-container" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <h2 style={{ fontSize: '2rem', marginBottom: '16px' }}>404 — Page Not Found</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
        The requested dashboard page or resource does not exist.
      </p>
      <Link href="/" className="btn btn-primary" style={{ display: 'inline-block' }}>
        Return to Dashboard
      </Link>
    </div>
  );
}
