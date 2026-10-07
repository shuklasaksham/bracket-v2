import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Button } from "../../ui/primitives";
import { Logo } from "../../shell/Logo";
import { cn } from "../../../lib/utils";

const LINKS = [
  { to: "/#product", label: "Product" },
  { to: "/#how", label: "How it works" },
  { to: "/pricing", label: "Pricing" },
  { to: "/security", label: "Security" },
];

export default function MarketingLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.hash]);
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 40);
    } else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return (
    <div className="bk min-h-[100dvh] bg-app text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-inverse focus:px-3 focus:py-2 focus:text-fg-inverse">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line-subtle bg-app/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 md:px-8">
          <Logo />
          <nav className="hidden md:flex items-center gap-7" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.label} to={l.to} className="text-body-m text-fg-secondary hover:text-fg transition-colors">{l.label}</NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <div className="hidden md:flex items-center gap-2">
            {user ? (
              <Link to="/app"><Button variant="primary">Open Bracket</Button></Link>
            ) : (
              <>
                <Link to="/login" className="px-3 text-body-m text-fg-secondary hover:text-fg">Sign in</Link>
                <Link to="/signup"><Button variant="primary">Get started</Button></Link>
              </>
            )}
          </div>
          <button className="md:hidden rounded-md p-2 text-fg-secondary" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
        {open && (
          <div className="md:hidden border-t border-line-subtle bg-app px-4 pb-5 animate-fade-in">
            <nav className="flex flex-col py-2" aria-label="Main">
              {LINKS.map((l) => <Link key={l.label} to={l.to} className="flex h-12 items-center border-b border-line-subtle text-body-l text-fg-secondary">{l.label}</Link>)}
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              {user ? <Link to="/app"><Button variant="primary" size="l" className="w-full">Open Bracket</Button></Link> : (
                <>
                  <Link to="/signup"><Button variant="primary" size="l" className="w-full">Get started</Button></Link>
                  <Link to="/login"><Button variant="secondary" size="l" className="w-full">Sign in</Button></Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>
      <main id="main"><Outlet /></main>
      <Footer />
    </div>
  );
}

function Footer() {
  const cols = [
    ["Product", [["How it works", "/#how"], ["Pricing", "/pricing"], ["Security", "/security"]]],
    ["Company", [["Contact", "mailto:support@use-bracket.com"], ["LinkedIn", "https://www.linkedin.com/company/bracket-app/"]]],
    ["Legal", [["Privacy", "/privacy"], ["Terms", "/terms"]]],
  ];
  return (
    <footer className="border-t border-line-subtle">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)] md:px-8">
        <div>
          <Logo />
          <p className="mt-3 max-w-[260px] text-body-m text-fg-tertiary">A memory for your business.</p>
        </div>
        {cols.map(([h, links]) => (
          <div key={h}>
            <p className="text-title-s">{h}</p>
            <ul className="mt-3 space-y-2">
              {links.map(([l, to]) => (
                <li key={l}>
                  {to.startsWith("http") || to.startsWith("mailto") ? (
                    <a href={to} target={to.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-body-m text-fg-tertiary hover:text-fg">{l}</a>
                  ) : (
                    <Link to={to} className="text-body-m text-fg-tertiary hover:text-fg">{l}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 border-t border-line-subtle px-4 py-6 text-body-s text-fg-tertiary md:flex-row md:justify-between md:px-8">
        <span>© {new Date().getFullYear()} Bracket Inc.</span>
        <a href="mailto:support@use-bracket.com" className="hover:text-fg">support@use-bracket.com</a>
      </div>
    </footer>
  );
}

export function Section({ id, eyebrow, title, sub, children, className }) {
  return (
    <section id={id} className={cn("mx-auto max-w-[1200px] px-4 py-20 md:px-8 md:py-28", className)}>
      {(eyebrow || title) && (
        <div className="mx-auto max-w-[720px] text-center">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          {title && <h2 className="mt-3 text-[30px] leading-[36px] md:text-[40px] md:leading-[46px] font-semibold tracking-[-1px]">{title}</h2>}
          {sub && <p className="mt-4 text-body-l text-fg-tertiary">{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
