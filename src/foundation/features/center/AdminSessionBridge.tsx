import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthProvider";
export function AdminSessionBridge() {
  const { state } = useAuth();
  const previous = useRef(false),
    token = state.session?.access_token;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!token) {
      if (previous.current)
        void fetch("/api/admin?resource=session", {
          method: "DELETE",
          credentials: "same-origin",
        }).catch(() => {});
      previous.current = false;
      return;
    }
    previous.current = true;
    const establish = async () => {
      try {
        const response = await fetch("/api/admin?resource=session", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
        });
        if (active && response.ok && !timer)
          timer = setInterval(() => {
            if (document.visibilityState !== "hidden") void establish();
          }, 120000);
      } catch {
        /* Failure leaves the administrative page closed; ordinary login remains intact. */
      }
    };
    void establish();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [token]);
  return null;
}
