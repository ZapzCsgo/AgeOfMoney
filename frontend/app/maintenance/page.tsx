'use client';

export default function MaintenancePage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: '#07060f', color: '#e8e2f5', fontFamily: 'sans-serif' }}
    >
      <div className="text-center px-6 max-w-md">
        {/* Crown */}
        <div className="mb-8">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="mx-auto">
            <path
              d="M3 17L5 9L9 13L12 7L15 13L19 9L21 17H3Z"
              fill="#d4a017"
              stroke="#d4a017"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            <rect x="3" y="17" width="18" height="2" rx="1" fill="#d4a017" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: 'Cinzel, serif',
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: '#d4a017',
            marginBottom: '1rem',
          }}
        >
          AGEOFMONEY
        </h1>

        <p style={{ color: '#6b6488', fontSize: '0.95rem', lineHeight: 1.6 }}>
          Le site est en cours de construction.<br />
          Revenez bientôt.
        </p>

        <div
          className="mt-8"
          style={{
            width: 40,
            height: 2,
            background: 'linear-gradient(90deg, transparent, #d4a017, transparent)',
            margin: '2rem auto 0',
          }}
        />
      </div>
    </div>
  );
}
