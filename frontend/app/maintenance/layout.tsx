// Standalone layout — completely bypasses the root layout (no sidebar, header, footer)
export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, padding: 0, background: '#07060f' }}>
        {children}
      </body>
    </html>
  );
}
