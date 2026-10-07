import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";

/**
 * Bracket-styled dialog primitives — replace browser-native alert/confirm/prompt
 * with a frosted-glass modal matching the login card recipe.
 *
 * Usage:
 *   const { alert, confirm, prompt } = useDialog();
 *   await alert({ title, message });
 *   const ok = await confirm({ title, message, confirmLabel, tone });
 *   const value = await prompt({ title, message, defaultValue, placeholder });
 */
const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((value) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setDialog(null);
  }, []);

  const open = useCallback((cfg) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog(cfg);
    });
  }, []);

  const alert = useCallback(
    (cfg) => open({ ...cfg, kind: "alert" }),
    [open]
  );
  const confirm = useCallback(
    (cfg) => open({ ...cfg, kind: "confirm" }),
    [open]
  );
  const prompt = useCallback(
    (cfg) => open({ ...cfg, kind: "prompt" }),
    [open]
  );

  return (
    <DialogContext.Provider value={{ alert, confirm, prompt }}>
      {children}
      {dialog && <DialogPortal dialog={dialog} close={close} />}
    </DialogContext.Provider>
  );
}

function DialogPortal({ dialog, close }) {
  const {
    kind,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "default", // "default" | "danger"
    defaultValue = "",
    placeholder = "",
  } = dialog;
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    // Focus input for prompt, primary CTA otherwise. Also lock body scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      if (kind === "prompt" && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else {
        dialogRef.current
          ?.querySelector('[data-testid="dialog-confirm-btn"]')
          ?.focus();
      }
    }, 50);

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(kind === "confirm" || kind === "prompt" ? null : true);
      }
      if (e.key === "Enter" && kind !== "alert") {
        e.preventDefault();
        close(kind === "prompt" ? value : true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [kind, value, close]);

  const primaryClass =
    tone === "danger" ? "btn-primary btn-danger" : "btn-primary";

  return (
    <div
      className="bracket-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bracket-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          close(kind === "confirm" || kind === "prompt" ? false : true);
        }
      }}
      data-testid="bracket-dialog"
    >
      <div
        ref={dialogRef}
        className="bracket-dialog card-linear card-linear--solid"
        data-testid="bracket-dialog-card"
      >
        <button
          type="button"
          className="bracket-dialog-close"
          onClick={() => close(kind === "confirm" || kind === "prompt" ? false : true)}
          aria-label="Close"
          data-testid="dialog-close-btn"
        >
          <X size={14} />
        </button>

        <div className="bracket-dialog-body">
          {title && (
            <h2
              id="bracket-dialog-title"
              className="bracket-dialog-title"
              data-testid="dialog-title"
            >
              {title}
            </h2>
          )}
          {message && (
            <p className="bracket-dialog-message" data-testid="dialog-message">
              {message}
            </p>
          )}

          {kind === "prompt" && (
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="bracket-dialog-input"
              data-testid="dialog-input"
            />
          )}

          <div className="bracket-dialog-actions">
            {kind !== "alert" && (
              <button
                type="button"
                onClick={() => close(kind === "prompt" ? null : false)}
                className="btn-ghost"
                data-testid="dialog-cancel-btn"
              >
                {cancelLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => close(kind === "prompt" ? value : true)}
              className={primaryClass}
              data-testid="dialog-confirm-btn"
            >
              {kind === "alert" ? "OK" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
