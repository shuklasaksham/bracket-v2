import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Lock } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { Logo } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { Badge, Button, SourceMark } from "../ui/primitives";
import { motion, EASE } from "../ui/motion";
import { useSandbox, SANDBOX_WID } from "./sandbox";

/* /sandbox — Figma › Sandbox · 1 Entry (202:2165, mobile 203:2762).
   Public: no sign-up, no card, nothing connected. */
const READ = [
  { provider: "gmail", title: "23 emails", meta: "Sarah Chen and James Park at Acme Finance" },
  { provider: "slack", title: "2 channels", meta: "#acme-redesign and #acme-dev" },
  { provider: "notes", title: "4 meeting notes", meta: "Kickoff, design review, two check-ins" },
];
const TRY = ["See what needs your attention", "Review a change before it’s saved", "Ask a question, get a cited answer", "Play a client message and watch Bracket react", "See exactly what a plan adds"];

const up = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } };

export default function SandboxEntry() {
  const { user } = useAuth();
  const sb = useSandbox();
  const navigate = useNavigate();
  const signedIn = user && !user.is_sandbox;
  const open = () => (sb.active ? navigate(`/w/${SANDBOX_WID}`) : sb.start());

  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app">
      <Seo title="Try Bracket on a sample project" noindex={false} description="Explore Bracket with a sample client project. No sign-up, no card, nothing connected." />
      <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:h-16 md:px-8">
        <Logo />
        <span className="flex-1" />
        {!user && <Button variant="ghost" size="s" onClick={() => navigate("/login")}>Sign in</Button>}
        <Button variant="secondary" size="s" className="hidden sm:inline-flex" onClick={() => navigate(signedIn ? "/app" : "/signup")}>{signedIn ? "Open Bracket" : "Start free trial"}</Button>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 md:px-8">
        <motion.div className="grid w-full max-w-[1032px] items-center gap-10 md:grid-cols-[minmax(0,520px)_minmax(0,440px)] md:gap-[72px]" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
          <div className="flex flex-col gap-5">
            <motion.p variants={up} className="eyebrow">Sandbox</motion.p>
            <motion.h1 variants={up} className="text-[32px] font-semibold leading-[38px] tracking-[-0.9px] md:text-[44px] md:leading-[50px] md:tracking-[-1.2px]">Try Bracket on a sample project</motion.h1>
            <motion.p variants={up} className="text-body-l text-fg-secondary">
              Explore a real-looking client project, Acme Finance’s website redesign, with its emails, Slack and meeting notes already read. You’ll be Maya, a design lead at Northlight Studio. No sign-up, no card, nothing connected.
            </motion.p>
            {signedIn && (
              <motion.p variants={up} className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-body-s text-fg-secondary">
                You’re signed in as {user.email}. Opening the sandbox signs you out on this browser; your workspaces aren’t touched.
              </motion.p>
            )}
            <motion.div variants={up} className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Button variant="primary" className="h-11 sm:h-8" icon={ArrowRight} loading={sb.busy === "start"} onClick={open}>
                {sb.active ? "Continue the sandbox" : "Open the sandbox"}
              </Button>
              <Button variant="ghost" className="h-11 sm:h-8" onClick={() => navigate("/pricing")}>See pricing</Button>
            </motion.div>
            <motion.p variants={up} className="flex items-center gap-2 text-body-s text-fg-tertiary"><Clock size={16} /> Takes about 3 minutes · Resets when you leave</motion.p>
          </div>

          <motion.section variants={up} aria-label="What’s inside" className="overflow-hidden rounded-xl border border-line-subtle bg-surface">
            <div className="flex items-center gap-3 p-5">
              <div className="min-w-0 flex-1">
                <p className="text-title-m text-fg">Acme Finance · Website redesign</p>
                <p className="text-body-s text-fg-tertiary">Sample client project · 2 weeks of history</p>
              </div>
              <Badge tone="info">Sample</Badge>
            </div>
            <div className="border-t border-line-subtle p-5">
              <p className="eyebrow">Already read for you</p>
              <ul className="mt-3.5 space-y-3.5">
                {READ.map((r) => (
                  <li key={r.provider} className="flex items-center gap-3">
                    <SourceMark provider={r.provider} />
                    <span><span className="block text-body-m font-medium text-fg">{r.title}</span><span className="block text-body-s text-fg-tertiary">{r.meta}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden border-t border-line-subtle p-5 md:block">
              <p className="eyebrow">What you’ll try</p>
              <ol className="mt-3 space-y-3">
                {TRY.map((t, i) => (
                  <li key={t} className="flex items-center gap-3 text-body-m text-fg">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-raised font-mono text-[12px] text-fg-secondary">{i + 1}</span>{t}
                  </li>
                ))}
              </ol>
            </div>
          </motion.section>
        </motion.div>
      </main>

      <footer className="flex items-center justify-center gap-2 px-4 pb-7 text-center text-body-s text-fg-tertiary">
        <Lock size={16} className="shrink-0" /> The sandbox never asks for your email, never connects to your accounts and stores nothing about you.
        <Link to="/privacy" className="sr-only">Privacy policy</Link>
      </footer>
    </div>
  );
}
