import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";

import { AuthProvider } from "./lib/AuthContext";
import { DialogProvider } from "./components/Dialog";
import { useAnalyticsTracker } from "./lib/analyticsTracker";

// ── Bracket 2.0 UI ────────────────────────────────────────────────────────
import { TooltipProvider } from "./v2/ui/overlays";
import { CommandProvider } from "./v2/shell/CommandPalette";
import { AskPanelProvider } from "./v2/shell/AskPanel";
import { RequireAuth, Tool, AppEntry, FullScreenLoader } from "./v2/shell/Guards";
import MarketingLayout from "./v2/pages/marketing/Layout";
import Landing from "./v2/pages/marketing/Landing";
import { Pricing, Privacy, Terms, Security, NotFound } from "./v2/pages/marketing/Pages";
import { UseCases, Changelog, About, Contact } from "./v2/pages/marketing/More";
import { AuthCallback, Onboarding, Claim, PaymentResult } from "./v2/pages/auth";
import { SignIn, SignUp, VerifyEmail, ForgotPassword, ResetPassword, AcceptInvite, GoogleHandoff } from "./v2/pages/account/Auth";
import Onboarding2, { OAuthMock } from "./v2/pages/account/Onboarding";
import WorkspaceLayout, { WorkspaceNotFound } from "./v2/pages/workspace/WorkspaceLayout";
import Overview from "./v2/pages/workspace/Overview";
import Review from "./v2/pages/workspace/Review";
import Memory from "./v2/pages/workspace/Memory";
import Conversations from "./v2/pages/workspace/Conversations";
import Ask from "./v2/pages/workspace/Ask";
import Timeline from "./v2/pages/workspace/Timeline";
import Sources from "./v2/pages/workspace/Sources";
import Resolve from "./v2/pages/workspace/Resolve";
import SourceDetail from "./v2/pages/workspace/SourceDetail";
import Files from "./v2/pages/workspace/Files";
import WorkspaceSettings from "./v2/pages/workspace/Settings";
import { SettingsRedirect } from "./v2/shell/Guards";
import MockStates from "./v2/pages/MockStates";
import { SandboxProvider } from "./v2/sandbox/sandbox";
import SandboxEntry from "./v2/sandbox/SandboxEntry";
import SandboxPlans from "./v2/sandbox/SandboxPlans";
import { AdminRoutes } from "./v2/admin/AdminApp";

import "./App.css";

// ── Carried over from v1.9 (restyled through shared tokens) ───────────────
// Admin console, public client review links, and the legacy brief flow.
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ProtectedAdminRoute = lazy(() => import("./components/ProtectedAdminRoute"));
const LegacyAppShell = lazy(() => import("./components/AppShell"));
const ProjectFlow = lazy(() => import("./pages/ProjectFlow"));
const ProjectOverview = lazy(() => import("./pages/ProjectOverview"));
const ProjectDocument = lazy(() => import("./pages/ProjectDocument"));
const ClientReview = lazy(() => import("./pages/ClientReview"));

function AnalyticsTrackerMount() {
  useAnalyticsTracker();
  return null;
}

function ProjectRedirect() {
  const { id } = useParams();
  return <Navigate to={`/w/${id}`} replace />;
}

const Legacy = ({ children }) => (
  <Tool>
    <DialogProvider>
      <LegacyAppShell>{children}</LegacyAppShell>
    </DialogProvider>
  </Tool>
);

export default function App() {
  return (
    <HelmetProvider>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <BrowserRouter>
            <TooltipProvider delayDuration={350}>
              <AskPanelProvider>
                <CommandProvider>
                  <AnalyticsTrackerMount />
                  <Toaster
                    position="bottom-center"
                    mobileOffset={{ bottom: 96 }}
                    theme="dark"
                    toastOptions={{
                      className: "bk",
                      style: { background: "#15161a", border: "1px solid rgba(255,255,255,0.14)", color: "#f7f8f8", fontFamily: "Urbanist, system-ui, sans-serif" },
                    }}
                  />
                  <SandboxProvider>
                  <Suspense fallback={<FullScreenLoader />}>
                    <Routes>
                      {/* Marketing — public */}
                      <Route element={<MarketingLayout />}>
                        <Route path="/" element={<Landing />} />
                        <Route path="/pricing" element={<Pricing />} />
                        <Route path="/privacy" element={<Privacy />} />
                        <Route path="/terms" element={<Terms />} />
                        <Route path="/security" element={<Security />} />
                        <Route path="/use-cases" element={<UseCases />} />
                        <Route path="/changelog" element={<Changelog />} />
                        <Route path="/about" element={<About />} />
                        <Route path="/contact" element={<Contact />} />
                        <Route path="*" element={<NotFound />} />
                      </Route>

                      {/* Auth & onboarding */}
                      <Route path="/login" element={<SignIn />} />
                      <Route path="/signup" element={<SignUp />} />
                      <Route path="/verify" element={<VerifyEmail />} />
                      <Route path="/auth/google" element={<GoogleHandoff />} />
                      <Route path="/oauth-mock" element={<OAuthMock />} />
                      <Route path="/auth/callback" element={<AuthCallback />} />
                      <Route path="/forgot-password" element={<ForgotPassword />} />
                      <Route path="/reset-password" element={<ResetPassword />} />
                      <Route path="/invite/:token" element={<AcceptInvite />} />
                      <Route path="/__states" element={<MockStates />} />
                      <Route path="/sandbox" element={<SandboxEntry />} />
                      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
                      <Route path="/claim" element={<RequireAuth><Claim /></RequireAuth>} />
                      <Route path="/plan" element={<Navigate to="/settings/billing" replace />} />
                      <Route path="/payment/success" element={<RequireAuth><PaymentResult ok /></RequireAuth>} />
                      <Route path="/payment/cancel" element={<RequireAuth><PaymentResult ok={false} /></RequireAuth>} />

                      {/* App */}
                      <Route path="/app" element={<Tool><AppEntry /></Tool>} />
                      <Route path="/welcome" element={<Tool><Onboarding2 /></Tool>} />
                      <Route path="/connect" element={<Tool><Onboarding2 /></Tool>} />
                      <Route path="/settings" element={<Tool><SettingsRedirect /></Tool>} />
                      <Route path="/settings/:section" element={<Tool><SettingsRedirect /></Tool>} />
                      <Route path="/w/:id" element={<Tool><WorkspaceLayout /></Tool>}>
                        <Route index element={<Overview />} />
                        <Route path="review" element={<Review />} />
                        <Route path="review/:rid" element={<Review />} />
                        <Route path="resolve/:cid" element={<Resolve />} />
                        <Route path="memory" element={<Memory />} />
                        <Route path="memory/:category" element={<Memory />} />
                        <Route path="conversations" element={<Conversations />} />
                        <Route path="conversations/:tid" element={<Conversations />} />
                        <Route path="ask" element={<Ask />} />
                        <Route path="timeline" element={<Timeline />} />
                        <Route path="timeline/:eid" element={<Timeline />} />
                        <Route path="sources" element={<Sources />} />
                        <Route path="sources/:sid" element={<SourceDetail />} />
                        <Route path="files" element={<Files />} />
                        <Route path="files/:fid" element={<Files />} />
                        <Route path="settings" element={<WorkspaceSettings />} />
                        <Route path="settings/:section" element={<WorkspaceSettings />} />
                        <Route path="sandbox" element={<SandboxPlans />} />
                        <Route path="*" element={<WorkspaceNotFound />} />
                      </Route>

                      {/* v1.9 links keep working */}
                      <Route path="/project/:id" element={<ProjectRedirect />} />
                      <Route path="/start" element={<Navigate to="/app" replace />} />
                      <Route path="/app/new" element={<Navigate to="/connect?new=1" replace />} />
                      <Route path="/app/connect" element={<Navigate to="/connect" replace />} />
                      <Route path="/app/activity" element={<Navigate to="/app" replace />} />

                      {/* Legacy brief flow + public client review + admin */}
                      <Route path="/project/:id/legacy" element={<Legacy><ProjectOverview /></Legacy>} />
                      <Route path="/project/:id/flow" element={<Legacy><ProjectFlow /></Legacy>} />
                      <Route path="/project/:id/document" element={<Legacy><ProjectDocument /></Legacy>} />
                      <Route path="/r/:token" element={<ClientReview />} />
                      {/* v1.9 console (admin-email accounts) kept for parity */}
                      <Route path="/admin/legacy/login" element={<AdminLogin />} />
                      <Route path="/admin/legacy" element={<DialogProvider><ProtectedAdminRoute><LegacyAppShell><AdminDashboard /></LegacyAppShell></ProtectedAdminRoute></DialogProvider>} />
                      {/* Owner-only admin panel — separate username/password session */}
                      {AdminRoutes()}
                    </Routes>
                  </Suspense>
                  </SandboxProvider>
                </CommandProvider>
              </AskPanelProvider>
            </TooltipProvider>
          </BrowserRouter>
        </AuthProvider>
      </MotionConfig>
    </HelmetProvider>
  );
}
