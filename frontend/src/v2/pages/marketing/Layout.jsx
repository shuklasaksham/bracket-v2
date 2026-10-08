import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu as MenuIcon, X } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Button } from "../../ui/primitives";
import { Logo } from "../../shell/Logo";
import { AnimatePresence, motion, EASE, DUR } from "../../ui/motion";
import { cn } from "../../../lib/utils";

const LINKS = [
  { to: "/#product", label: "Product" },
  { to: "/#how", label: "How it works" },
  { to: "/use-cases", label: "Use cases" },
  { to: "/pricing", label: "Pricing" },
];

export default function MarketingLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, location.hash]);
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 40);
    } else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="bk min-h-[100dvh] bg-app text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-inverse focus:px-3 focus:py-2 focus:text-fg-inverse">Skip to content</a>
      {/* Figma › Site nav: 72px, padding 64, gap 40, links 12 Medium secondary, gap 32 */}
      <header className={cn("sticky top-0 z-40 border-b transition-colors duration-200", scrolled ? "border-line-subtle bg-app/85 backdrop-blur" : "border-line-subtle bg-app")}>
        <div className="flex h-14 items-center gap-10 px-4 md:h-[72px] md:px-8 lg:px-16">
          <Logo />
          <nav className="hidden md:flex items-center gap-8" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.label} to={l.to} className={({ isActive }) => cn("text-[12px] font-medium leading-[18px] transition-colors hover:text-fg", isActive && !l.to.includes("#") ? "text-fg" : "text-fg-secondary")}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {user ? (
              <Link to="/app" className="hidden md:block"><Button variant="primary">Open Bracket</Button></Link>
            ) : (
              <>
                <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
                <Link to="/signup" className="hidden md:block"><Button variant="primary">Get started</Button></Link>
              </>
            )}
            <button className="md:hidden -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-fg-secondary hover:text-fg" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={open ? "x" : "m"} initial={{ opacity: 0, rotate: -45 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 45 }} transition={{ duration: DUR.fast }}>
                  {open ? <X size={20} /> : <MenuIcon size={20} />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>
      {/* Figma › Mobile menu sheet (72:2712) */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-app px-4 pb-6 md:hidden"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: DUR.base, ease: EASE }}
            role="dialog" aria-label="Menu"
          >
            <nav className="flex flex-col py-2" aria-label="Main">
              {LINKS.map((l, i) => (
                <motion.div key={l.label} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i + 0.04, duration: DUR.base, ease: EASE }}>
                  <Link to={l.to} className="flex h-14 items-center border-b border-line-subtle text-title-m text-fg">{l.label}</Link>
                </motion.div>
              ))}
              {[["Changelog", "/changelog"], ["About", "/about"], ["Contact", "/contact"]].map(([l, to], i) => (
                <motion.div key={l} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * (i + 4) + 0.04, duration: DUR.base, ease: EASE }}>
                  <Link to={to} className="flex h-12 items-center border-b border-line-subtle text-body-m text-fg-secondary">{l}</Link>
                </motion.div>
              ))}
            </nav>
            <div className="flex-1" />
            <div className="flex flex-col gap-2">
              {user ? <Link to="/app"><Button variant="primary" size="l" className="w-full">Open Bracket</Button></Link> : (
                <>
                  <Link to="/signup"><Button variant="primary" size="l" className="w-full">Get started</Button></Link>
                  <Link to="/login"><Button variant="secondary" size="l" className="w-full">Sign in</Button></Link>
                </>
              )}
              <p className="mt-2 text-center text-body-s text-fg-tertiary">Free for 14 days · No card required</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <main id="main"><Outlet /></main>
      <Footer />
    </div>
  );
}

/* Figma › Site footer: padding 48/64/32, link columns gap 64, 12px */
function Footer() {
  const cols = [
    ["Product", [["How it works", "/#how"], ["Use cases", "/use-cases"], ["Pricing", "/pricing"], ["Changelog", "/changelog"]]],
    ["Company", [["About", "/about"], ["Contact", "/contact"], ["LinkedIn", "https://www.linkedin.com/company/bracket-app/"]]],
    ["Legal", [["Privacy", "/privacy"], ["Terms", "/terms"], ["Security", "/security"]]],
  ];
  return (
    <footer className="border-t border-line-subtle bg-app">
      <div className="flex flex-col gap-10 px-4 pb-8 pt-12 md:px-8 lg:px-16">
        <div className="flex flex-col gap-10 md:flex-row md:gap-16">
          <div className="flex-1">
            <Logo />
            <p className="mt-3 text-body-s text-fg-tertiary">A memory for your business.</p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-body-s md:flex md:gap-16">
            {cols.map(([h, links]) => (
              <div key={h} className="flex flex-col gap-3">
                <p className="font-medium text-fg">{h}</p>
                {links.map(([l, to]) => (
                  to.startsWith("http") ? (
                    <a key={l} href={to} target="_blank" rel="noopener noreferrer" className="text-fg-secondary transition-colors hover:text-fg">{l}</a>
                  ) : (
                    <Link key={l} to={to} className="text-fg-secondary transition-colors hover:text-fg">{l}</Link>
                  )
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-caption text-fg-tertiary sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Bracket Inc.</span>
          <a href="mailto:support@use-bracket.com" className="transition-colors hover:text-fg">support@use-bracket.com</a>
        </div>
      </div>
    </footer>
  );
}

/* Scroll-reveal: fades content up once as it enters the viewport. */
export function Reveal({ children, className, delay = 0, as = "div", y = 12 }) {
  const C = motion[as] || motion.div;
  return (
    <C className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -80px 0px" }} transition={{ duration: 0.45, ease: EASE, delay }}>
      {children}
    </C>
  );
}

/* Figma › Section header: eyebrow 12, title 44/1.1 -1.32, body-l secondary 640 wide; section padding 120 */
export function Section({ id, eyebrow, title, sub, children, className, tone = "app" }) {
  return (
    <section id={id} className={cn("scroll-mt-16 px-4 py-20 md:px-8 md:py-24 lg:px-[120px] lg:py-[120px]", tone === "sidebar" ? "bg-sidebar" : "bg-app", className)}>
      <div className="mx-auto max-w-[1200px]">
        {(eyebrow || title) && (
          <Reveal className="mx-auto flex max-w-[720px] flex-col items-center gap-4 text-center">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.96px] md:text-[44px] md:tracking-[-1.32px]">{title}</h2>}
            {sub && <p className="max-w-[640px] text-body-l text-fg-secondary">{sub}</p>}
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}
