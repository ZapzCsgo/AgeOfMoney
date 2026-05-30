// Standalone layout — bypasses the root layout (no Navbar/Sidebar/ChatPanel/Footer)
// so a planned downtime page doesn't bleed any of the live UI infrastructure
// that might itself depend on the backend being up.
export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, padding: 0, background: '#07060f' }}>
        {children}
      </body>
    </html>
  );
}
