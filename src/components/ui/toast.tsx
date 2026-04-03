"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

// \u2500\u2500\u2500 Types \u2500\u2500\u2500

type ToastVariant = "default" | "success" | "error" | "warning";

interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (opts: { title: string; description?: string; variant?: ToastVariant }) => void;
}

// \u2500\u2500\u2500 Context \u2500\u2500\u2500

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

// \u2500\u2500\u2500 Provider \u2500\u2500\u2500

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const toast = useCallback(
    (opts: { title: string; description?: string; variant?: ToastVariant }) => {
      const id = `toast-${++toastId}`;
      const newToast: ToastData = {
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant || "default",
      };

      setToasts((prev) => {
        const next = [...prev, newToast];
        if (next.length > 3) {
          const oldest = next[0];
          if (oldest) {
            const timer = timersRef.current.get(oldest.id);
            if (timer) clearTimeout(timer);
            timersRef.current.delete(oldest.id);
            setTimeout(() => removeToast(oldest.id), 0);
          }
        }
        return next;
      });

      const timer = setTimeout(() => {
        removeToast(id);
        timersRef.current.delete(id);
      }, 3000);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} data={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// \u2500\u2500\u2500 Toast Item \u2500\u2500\u2500

const variantBorder: Record<ToastVariant, string> = {
  default: "border-l-secondary",
  success: "border-l-success",
  error: "border-l-danger",
  warning: "border-l-warning",
};

function ToastItem({ data, onDismiss }: { data: ToastData; onDismiss: () => void }) {
  return (
    <div
      className={`pointer-events-auto min-w-[280px] max-w-[360px] bg-card border border-border border-l-4 ${variantBorder[data.variant]} rounded-lg shadow-lg px-4 py-3 cursor-pointer transition-all duration-300 ${
        data.exiting
          ? "opacity-0 translate-x-4"
          : "opacity-100 translate-x-0 animate-[slideIn_0.3s_ease-out]"
      }`}
      onClick={onDismiss}
      role="alert"
    >
      <p className="text-sm font-semibold text-foreground">{data.title}</p>
      {data.description && (
        <p className="text-xs text-secondary mt-0.5">{data.description}</p>
      )}
    </div>
  );
}
