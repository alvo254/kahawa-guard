// Public shell: top nav, outlet, footer. Mobile-first. No telemetry anywhere —
// this layout and everything it renders imports only lib/member.

import { NavLink, Link, Outlet } from "react-router-dom";
import { Logo } from "../ui/Logo";
import { ThemeToggle } from "../ui/ThemeToggle";
import { cx } from "../ui/primitives";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/services", label: "Services" },
  { to: "/about", label: "About" },
];

export function MemberLayout() {
  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4">
          <Link to="/" className="text-lg">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive ? "text-cherry" : "text-muted hover:text-ink",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/present"
              className="hidden rounded-xl bg-cherry px-4 py-2 text-sm font-medium text-white hover:bg-cherry-ink sm:inline-flex"
            >
              Open assistant
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm text-muted">
              A guarded assistant for the Kirinyaga coffee cooperative. Built so members can trust
              every answer, on any phone.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm">
            <div>
              <p className="mb-2 font-semibold text-ink">Members</p>
              <ul className="space-y-1.5 text-muted">
                <li><Link className="hover:text-ink" to="/present">WhatsApp · SMS · USSD</Link></li>
                <li><Link className="hover:text-ink" to="/services">Services</Link></li>
                <li><Link className="hover:text-ink" to="/about">How it works</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold text-ink">Cooperative</p>
              <ul className="space-y-1.5 text-muted">
                <li>Kirinyaga, Kenya</li>
                <li>SMS 20880</li>
                <li>Dial *384*7#</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto flex max-w-content items-center justify-between gap-2 px-4 py-4 text-xs text-muted">
            <span>© {new Date().getFullYear()} Kahawa Guard. Member data stays with the cooperative.</span>
            <span className="font-mono">build {__BUILD_ID__}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
