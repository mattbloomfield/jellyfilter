import { NavLink } from "react-router-dom";

const nav = [
  { to: "/library", label: "Library" },
  { to: "/queue", label: "Queue" },
  { to: "/preferences", label: "Preferences" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-8">
        <span className="font-bold text-lg tracking-tight text-violet-400">JellyFilter</span>
        <nav className="flex gap-4">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive ? "text-white" : "text-gray-400 hover:text-gray-200"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
