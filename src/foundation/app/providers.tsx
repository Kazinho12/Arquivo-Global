import { PersonalizationProvider } from "../features/personalization/PersonalizationProvider";
export { useTheme } from "../features/personalization/PersonalizationProvider";
import { NotificationCountProvider } from "../features/notifications/Notifications";
import { ReadingProvider } from "../features/library/ReadingProvider";
import { AdminSessionBridge } from "../features/center/AdminSessionBridge";
import { RemoteWorksProvider } from "../features/studio/RemoteWorksProvider";
import { PreferenceEffects } from "../features/preferences/store";
import { LocalDataBoundary } from "../features/local/LocalDataBoundary";
import { AuthProvider } from "../features/auth/AuthProvider";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function Providers({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <ToastContext.Provider value={setMessage}>
      <PreferenceEffects />
      <AuthProvider>
        <AdminSessionBridge />
        <LocalDataBoundary>
          <PersonalizationProvider>
            <NotificationCountProvider>
              <ReadingProvider>
                <RemoteWorksProvider>{children}</RemoteWorksProvider>
              </ReadingProvider>
            </NotificationCountProvider>
          </PersonalizationProvider>
        </LocalDataBoundary>
      </AuthProvider>
      <div className="toast-region" role="status" aria-live="polite">
        {message && (
          <div className="toast">
            {message}
            <button
              aria-label="Fechar notificação"
              onClick={() => setMessage("")}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
