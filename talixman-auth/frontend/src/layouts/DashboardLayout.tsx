import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import { listSectors } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useTheme } from '../lib/theme';

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Administrateur',
  GUEST: 'Invité',
};

function navItemsFor(role: string | undefined) {
  if (role === 'SUPERADMIN')
    return [
      { to: '/gestion', label: 'Gestion' },
      { to: '/compte', label: 'Compte' },
    ];
  if (role === 'ADMIN')
    return [
      { to: '/', label: 'Portail' },
      { to: '/invites', label: 'Invités' },
      { to: '/compte', label: 'Compte' },
    ];
  if (role === 'GUEST')
    return [
      { to: '/', label: 'Portail' },
      { to: '/compte', label: 'Compte' },
    ];
  return [];
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: listSectors });
  const sectorLabel = sectors?.find((s) => s.id === user?.sectorId)?.label;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const roleLabel = user ? ROLE_LABEL[user.role] : '';
  const fullName = user && (user.firstName || user.lastName) ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  const avatarInitial = (fullName || roleLabel)[0] ?? '';
  const navItems = navItemsFor(user?.role);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <a href="#main-content" className="skip-link">
        Aller au contenu principal
      </a>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg,var(--orange),var(--red))' }} />
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel) 92%, transparent)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-fit shrink-0 rounded-lg bg-white px-3 py-2">
              <img src={logo} alt="Talixman" className="h-[20px] sm:h-[22px]" />
            </div>
            {sectorLabel && (
              <>
                <div className="hidden h-6 w-px sm:block" style={{ background: 'var(--border)' }} />
                <span className="hidden truncate font-mono text-xs font-bold uppercase tracking-wide sm:inline" style={{ color: 'var(--orange)' }}>
                  {sectorLabel}
                </span>
              </>
            )}
          </div>

          <nav className="ml-2 hidden flex-1 items-center gap-1 md:flex" aria-label="Navigation principale">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-2 font-mono text-[11px] font-bold uppercase tracking-wide transition-colors duration-[var(--dur-fast)] ${isActive ? '' : 'hover:bg-[var(--panel2)]'}`
                }
                style={({ isActive }) => ({
                  color: isActive ? '#fff' : 'var(--text-dim)',
                  background: isActive ? 'var(--gradient-brand)' : 'transparent',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-3 md:flex">
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
              className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-mono text-[11px] font-bold uppercase transition-colors duration-[var(--dur-fast)] hover:bg-[var(--panel2)]"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? 'Clair' : 'Sombre'}
            </button>

            <div
              className="flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--panel2)' }}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--gradient-brand)' }}>
                {avatarInitial}
              </div>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold">{fullName || roleLabel}</div>
                {fullName && (
                  <div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    {roleLabel}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-mono text-[11px] font-bold uppercase transition-colors duration-[var(--dur-fast)] hover:bg-[var(--danger-bg)]"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--red)' }}
            >
              <LogOut size={14} />
              Déconnexion
            </button>
          </div>

          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="ml-auto flex h-10 w-10 items-center justify-center rounded-full border md:hidden"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {mobileOpen && (
          <div
            id="mobile-nav"
            className="animate-slide-up border-t px-4 py-4 md:hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
          >
            <nav className="mb-4 flex flex-col gap-1" aria-label="Navigation principale">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `rounded-lg px-3.5 py-2.5 text-[13px] font-bold ${isActive ? '' : 'hover:bg-[var(--panel2)]'}`
                  }
                  style={({ isActive }) => ({
                    color: isActive ? '#fff' : 'var(--text)',
                    background: isActive ? 'var(--gradient-brand)' : 'transparent',
                  })}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="mb-4 flex items-center gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-strong)', background: 'var(--panel2)' }}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--gradient-brand)' }}>
                {avatarInitial}
              </div>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold">{fullName || roleLabel}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                  {sectorLabel ? `${roleLabel} · ${sectorLabel}` : roleLabel}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={toggleTheme}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[12px] font-bold uppercase"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text)' }}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? 'Clair' : 'Sombre'}
              </button>
              <button
                onClick={handleLogout}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[12px] font-bold uppercase"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--red)' }}
              >
                <LogOut size={14} />
                Déconnexion
              </button>
            </div>
          </div>
        )}
      </header>

      <main id="main-content" className="mx-auto max-w-[1400px] p-4 sm:p-7">
        <Outlet />
      </main>
    </div>
  );
}
