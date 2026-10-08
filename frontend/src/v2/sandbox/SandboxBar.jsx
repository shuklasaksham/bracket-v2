import React from "react";
import { Compass, MoreHorizontal, LogOut, RotateCcw, Send } from "lucide-react";
import { Badge, Button, IconButton } from "../ui/primitives";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "../ui/overlays";
import { motion, EASE } from "../ui/motion";
import { useSandbox } from "./sandbox";

/* Figma › Sandbox bar (196:1852) and Sandbox bar / Mobile (203:2635).
   Desktop: a 44px strip above the top bar in the main column. Mobile: under
   the compact header, with Reset / Leave / Tour in a menu. */
export default function SandboxBar({ mobile }) {
  const sb = useSandbox();
  if (!sb.active) return null;
  const s = sb.state || {};
  const total = s.total || 5;
  const played = s.beat || 0;
  const detail = s.done
    ? `All ${total} client messages played. Reset to replay them.`
    : played
      ? `Message ${played} of ${total} played. Nothing here touches your accounts.`
      : "Nothing here touches your accounts. It resets when you leave.";
  const play = () => sb.next();

  if (mobile) {
    return (
      <motion.div role="region" aria-label="Sandbox" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.28, ease: EASE }}
        className="flex shrink-0 items-center gap-2 border-b border-line-subtle bg-surface py-1.5 pl-4 pr-2">
        <Badge tone="info" dot>Sandbox</Badge>
        <span className="min-w-0 flex-1 truncate text-body-s text-fg-secondary">{played ? `${played} of ${total} played` : "Sample data"}</span>
        <Button size="s" variant="secondary" icon={Send} data-tour="sandbox-play" loading={sb.busy === "next"} disabled={s.done} onClick={play}>Play message</Button>
        <Button size="s" variant="primary" onClick={() => sb.startTrial()}>Trial</Button>
        <Menu>
          <MenuTrigger asChild><IconButton icon={MoreHorizontal} label="Sandbox options" /></MenuTrigger>
          <MenuContent>
            <MenuItem icon={Compass} onSelect={sb.startTour}>Restart the tour</MenuItem>
            <MenuItem icon={RotateCcw} onSelect={sb.openReset}>Reset the sandbox</MenuItem>
            <MenuItem icon={LogOut} onSelect={() => sb.leave()}>Leave the sandbox</MenuItem>
          </MenuContent>
        </Menu>
      </motion.div>
    );
  }

  return (
    <motion.div role="region" aria-label="Sandbox" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 44 }} transition={{ duration: 0.28, ease: EASE }}
      className="flex shrink-0 items-center gap-3 overflow-hidden border-b border-line-subtle bg-surface px-4">
      <Badge tone="info" dot>Sandbox</Badge>
      <p className="min-w-0 flex-1 truncate text-body-s">
        <span className="font-medium text-fg">Sample project · Acme Finance</span>{" "}
        <span className="text-fg-tertiary">{detail}</span>
      </p>
      <Button size="s" variant="secondary" icon={Send} data-tour="sandbox-play" loading={sb.busy === "next"} disabled={s.done} onClick={play}>
        {s.done ? "All messages played" : "Play next client message"}
      </Button>
      {!sb.tour && <Button size="s" variant="ghost" icon={Compass} onClick={sb.startTour} className="hidden xl:inline-flex">Tour</Button>}
      <Button size="s" variant="ghost" icon={RotateCcw} onClick={sb.openReset}>Reset</Button>
      <Button size="s" variant="ghost" loading={sb.busy === "leave"} onClick={() => sb.leave()}>Leave</Button>
      <Button size="s" variant="primary" onClick={() => sb.startTrial()}>Start free trial</Button>
    </motion.div>
  );
}
