"use client";

import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [values, setValues] = useState(["", "", "", ""]);
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  async function checkPin(pin: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/"), 800);
      } else {
        setError(true);
        setTimeout(() => {
          setError(false);
          setValues(["", "", "", ""]);
          inputs.current[0]?.focus();
        }, 600);
      }
    } catch {
      // Offline fallback
      if (pin.toUpperCase() === "PG26") {
        setSuccess(true);
        document.cookie = "pg_session=authenticated;path=/;max-age=604800";
        setTimeout(() => router.push("/"), 800);
      } else {
        setError(true);
        setTimeout(() => {
          setError(false);
          setValues(["", "", "", ""]);
          inputs.current[0]?.focus();
        }, 600);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleInput(index: number, value: string) {
    if (value.length > 1) value = value[value.length - 1];
    const next = [...values];
    next[index] = value;
    setValues(next);

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
    if (value && index === 3) {
      const pin = next.join("");
      if (pin.length === 4) checkPin(pin);
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !values[index] && index > 0) {
      const next = [...values];
      next[index - 1] = "";
      setValues(next);
      inputs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").trim();
    if (text.length >= 4) {
      const next = text.slice(0, 4).split("");
      setValues(next);
      inputs.current[3]?.focus();
      setTimeout(() => checkPin(next.join("")), 200);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className={`text-center transition-all duration-500 ${success ? "opacity-0 -translate-y-5" : ""}`}>
        {/* Golf ball */}
        <div
          className={`w-6 h-6 rounded-full mx-auto mb-8 bg-gradient-to-br from-white via-gray-200 to-gray-300 shadow-md ${
            success ? "animate-[roll_1.2s_ease-in_forwards]" : ""
          }`}
        />

        <h1 className="text-4xl font-extrabold tracking-tight mb-2">Performance Golf</h1>
        <p className="text-sm font-medium uppercase tracking-[3px] text-muted mb-8">
          Networking Intelligence
        </p>

        <div className="w-15 h-px bg-primary/30 mx-auto mb-10" />

        <div className={`flex gap-3 justify-center ${error ? "animate-[shake_0.4s_ease]" : ""}`}>
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              type={values[i] ? "password" : "text"}
              maxLength={1}
              value={values[i]}
              disabled={loading}
              onChange={(e) => handleInput(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              inputMode="text"
              autoComplete="off"
              className={`w-14 h-16 text-center text-2xl font-bold rounded-xl border bg-card outline-none transition-all ${
                error
                  ? "border-danger shadow-[0_0_0_2px_rgba(255,61,0,0.2)]"
                  : success
                    ? "border-success shadow-[0_0_0_2px_rgba(0,200,83,0.2)]"
                    : "border-border focus:border-primary focus:shadow-[0_0_0_2px_rgba(253,51,0,0.15)]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
