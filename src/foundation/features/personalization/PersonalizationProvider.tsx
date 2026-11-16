import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { usePreferences } from "../preferences/store";
import {
  defaults,
  validateSnapshot,
  mergeSnapshots,
  type PersonalSnapshot,
} from "./model";
import {
  baseConfig,
  themeById,
  themeVariables,
  validateTheme,
  type ThemeConfig,
} from "./themes";
import {
  createPersonalizationRepository,
  personalizationSyncEnabled,
} from "./repository";
import {
  resolveLocale,
  catalogReady,
  loadCatalog,
  translate,
  documentDirection,
  type MessageKey,
} from "./i18n";
interface ContextValue {
  data: PersonalSnapshot;
  dirty: boolean;
  message: string;
  busy: boolean;
  remote: PersonalSnapshot | null;
  owner?: string;
  config: ThemeConfig;
  mode: "dark" | "light";
  change: (next: PersonalSnapshot) => void;
  select: (id: string, config?: ThemeConfig) => void;
  saveAccount: () => Promise<void>;
  reload: () => Promise<void>;
  useRemote: () => void;
  merge: () => void;
  reset: () => void;
  importGuest: () => void;
}
const initial = defaults();
const Context = createContext<ContextValue>({
  data: initial,
  dirty: false,
  message: "",
  busy: false,
  remote: null,
  config: baseConfig,
  mode: "dark",
  change: () => {},
  select: () => {},
  saveAccount: async () => {},
  reload: async () => {},
  useRemote: () => {},
  merge: () => {},
  reset: () => {},
  importGuest: () => {},
});
export const usePersonalization = () => useContext(Context);
export function useTheme() {
  const p = usePersonalization();
  return {
    theme: p.mode,
    toggle: () => p.select(p.mode === "dark" ? "light" : "dark"),
  };
}
export function useI18n() {
  const { data } = usePersonalization();
  const [, refresh] = useState(0);
  useEffect(() => {
    if (catalogReady(data.settings.locale)) return;
    let active = true;
    void loadCatalog(data.settings.locale).then(() => {
      if (active) refresh((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [data.settings.locale]);
  return {
    locale: resolveLocale(data.settings.locale),
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(key, params, data.settings.locale),
  };
}
export const personalKey = (owner?: string) =>
  "ag:personalization:v1:" + (owner ?? "guest");
function readDevice(owner?: string) {
  try {
    const raw = localStorage.getItem(personalKey(owner));
    if (raw) {
      const v = JSON.parse(raw);
      if (v.version !== 1 || typeof v.dirty !== "boolean")
        throw Error("Formato local incompatível.");
      return {
        data: validateSnapshot(v.data),
        dirty: v.dirty === true,
        warning: "",
      };
    }
    const data = defaults();
    if (!owner) {
      const old = localStorage.getItem("ag.v2.theme");
      if (old === "light" || old === "dark") {
        data.settings.theme = old;
        data.settings.config = structuredClone(themeById(old)!.config);
      }
      const requested = navigator.language;
      data.settings.locale = resolveLocale(requested);
    }
    return { data, dirty: false, warning: "" };
  } catch {
    return {
      data: defaults(),
      dirty: false,
      warning:
        "Dados locais ilegíveis preservados. Usa a recuperação antes de substituir o armazenamento.",
    };
  }
}
function useMedia(query: string) {
  const [value, setValue] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const q = matchMedia(query);
    const read = () => setValue(q.matches);
    read();
    q.addEventListener?.("change", read);
    return () => q.removeEventListener?.("change", read);
  }, [query]);
  return value;
}
export function PersonalizationProvider({
  children,
  enabled = personalizationSyncEnabled,
  repository,
}: {
  children: ReactNode;
  enabled?: boolean;
  repository?: ReturnType<typeof createPersonalizationRepository>;
}) {
  const { state } = useAuth();
  const owner = state.user?.id;
  return (
    <Session
      key={owner ?? "guest"}
      owner={owner}
      enabled={enabled}
      repository={repository}
    >
      {children}
    </Session>
  );
}
export function Session({
  children,
  owner,
  enabled,
  repository,
}: {
  children: ReactNode;
  owner?: string;
  enabled: boolean;
  repository?: ReturnType<typeof createPersonalizationRepository>;
}) {
  const stored = useMemo(() => readDevice(owner), [owner]);
  const [data, setData] = useState(stored.data),
    [dirty, setDirty] = useState(stored.dirty),
    [message, setMessage] = useState(stored.warning),
    [busy, setBusy] = useState(false),
    [remote, setRemote] = useState<PersonalSnapshot | null>(null);
  const alive = useRef(true),
    latest = useRef({ data, dirty }),
    lock = useRef(false),
    blocked = useRef(!!stored.warning);
  latest.current = { data, dirty };
  const light = useMedia("(prefers-color-scheme: light)");
  const repo = useMemo(
    () =>
      repository ??
      (owner && enabled ? createPersonalizationRepository(owner) : null),
    [repository, owner, enabled],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function persist(next: PersonalSnapshot, pending: boolean) {
    if (blocked.current) return false;
    try {
      localStorage.setItem(
        personalKey(owner),
        JSON.stringify({ version: 1, data: next, dirty: pending }),
      );
      return true;
    } catch {
      setMessage("Sem armazenamento local: exporta uma cópia antes de sair.");
      return false;
    }
  }
  function accept(next: PersonalSnapshot, pending: boolean) {
    if (!alive.current) return false;
    setData(next);
    setDirty(pending);
    latest.current = { data: next, dirty: pending };
    return persist(next, pending);
  }
  function change(next: PersonalSnapshot) {
    try {
      const persisted = accept(validateSnapshot(next), true);
      if (persisted)
        setMessage(
          owner
            ? "Alterações aplicadas neste dispositivo; guarda na conta para sincronizar."
            : "Preferências guardadas neste dispositivo.",
        );
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function select(id: string, config?: ThemeConfig) {
    const preset = themeById(id, light);
    const personal = latest.current.data.themes.find((t) => t.id === id);
    const next = config ?? personal?.config ?? preset?.config;
    if (!next) {
      setMessage("Tema não encontrado.");
      return;
    }
    change({
      ...latest.current.data,
      settings: {
        ...latest.current.data.settings,
        theme: id,
        config: validateTheme(next),
      },
    });
  }
  async function reload() {
    if (!repo) return;
    try {
      const next = await repo.call("read");
      if (!alive.current || next.revision < latest.current.data.revision)
        return;
      if (latest.current.dirty) {
        setRemote(next);
        setMessage(
          "A conta foi consultada. As alterações locais foram preservadas para conciliação.",
        );
      } else {
        accept(next, false);
        setRemote(null);
        setMessage("Preferências recuperadas da conta.");
      }
    } catch (e) {
      if (alive.current) setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    if (!repo) return;
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible" && !lock.current)
        void reload();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [repo]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key !== personalKey(owner) || !event.newValue) return;
      try {
        const envelope = JSON.parse(event.newValue);
        if (envelope.version !== 1 || typeof envelope.dirty !== "boolean")
          throw Error("Formato local incompatível.");
        const next = validateSnapshot(envelope.data);
        const same =
          JSON.stringify(next.settings) ===
            JSON.stringify(latest.current.data.settings) &&
          JSON.stringify(next.themes) ===
            JSON.stringify(latest.current.data.themes);
        if (latest.current.dirty && !same) {
          setRemote(next);
          setMessage(
            "Outro separador alterou estas preferências. As duas versões foram preservadas para conciliação.",
          );
        } else accept(next, envelope.dirty === true);
      } catch {
        blocked.current = true;
        setMessage(
          "Outro separador escreveu dados ilegíveis. A versão em memória foi preservada.",
        );
      }
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [owner]);
  async function saveAccount() {
    if (!repo || lock.current) {
      if (!repo)
        setMessage(
          "Sincronização da conta não ativada neste ambiente. Os dados locais continuam disponíveis.",
        );
      return;
    }
    lock.current = true;
    setBusy(true);
    const sent = latest.current.data;
    try {
      const ack = await repo.call("save", sent);
      if (!alive.current) return;
      const current = latest.current.data;
      if (JSON.stringify(current) === JSON.stringify(sent)) {
        accept(ack, false);
        setMessage("Gravação confirmada na conta.");
      } else {
        accept({ ...current, revision: ack.revision }, true);
        setMessage(
          "Versão enviada confirmada; há alterações locais posteriores por guardar.",
        );
      }
      setRemote(null);
    } catch (e) {
      if (alive.current) {
        setMessage((e as Error).message);
        try {
          setRemote(await repo.call("read"));
        } catch {
          /* Keep original failure and all local drafts. */
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const config =
    data.settings.theme === "system"
      ? structuredClone(themeById("system", light)!.config)
      : data.settings.config;
  const mode =
    Number.parseInt(config.colors.bg.slice(1, 3), 16) +
      Number.parseInt(config.colors.bg.slice(3, 5), 16) +
      Number.parseInt(config.colors.bg.slice(5, 7), 16) >
    420
      ? "light"
      : "dark";
  return (
    <Context.Provider
      value={{
        data,
        dirty,
        message,
        busy,
        remote,
        owner,
        config,
        mode,
        change,
        select,
        saveAccount,
        reload,
        useRemote: () => {
          if (remote) {
            accept(remote, false);
            setRemote(null);
            setMessage("Versão da conta aplicada.");
          }
        },
        merge: () => {
          if (!remote) return;
          try {
            accept(mergeSnapshots(remote, latest.current.data), true);
            setRemote(null);
            setMessage(
              "Dados conciliados. Temas em conflito foram preservados como cópias; confirma a gravação.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          }
        },
        reset: () => {
          if (blocked.current) {
            try {
              const original = localStorage.getItem(personalKey(owner));
              if (original !== null)
                localStorage.setItem(
                  personalKey(owner) + ":recovery:" + Date.now(),
                  original,
                );
              blocked.current = false;
            } catch {
              setMessage(
                "Restauro em memória; o original ilegível permanece preservado.",
              );
            }
          }
          const next = {
            ...latest.current.data,
            settings: {
              ...latest.current.data.settings,
              theme: "night",
              config: structuredClone(baseConfig),
            },
          };
          const persisted = accept(next, true);
          setMessage(
            persisted
              ? "Tema oficial restaurado neste dispositivo."
              : "Tema oficial aplicado em memória; o armazenamento original foi preservado.",
          );
        },
        importGuest: () => {
          if (!owner) return;
          try {
            const guest = readDevice().data;
            const next = mergeSnapshots(latest.current.data, guest);
            accept({ ...next, revision: latest.current.data.revision }, true);
            setMessage(
              "Preferências anónimas importadas localmente, sem apagar os originais. Guarda para sincronizar.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function PersonalizationEffects() {
  const { config, data, mode, select } = usePersonalization();
  const location = useLocation();
  const { accessibility } = usePreferences();
  const reduced = useMedia("(prefers-reduced-motion: reduce)"),
    contrast = useMedia("(prefers-contrast: more)");
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  useEffect(() => {
    const read = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  const safe =
    /^\/(admin(?:\/|$)|entrar(?:\/|$)|registar(?:\/|$)|auth(?:\/|$)|recuperar-senha|redefinir-senha|confirmar-email|definicoes\/aparencia\/recuperar)/.test(
      location.pathname,
    );
  useLayoutEffect(() => {
    const root = document.documentElement;
    const active = safe
      ? location.pathname.includes("/aparencia/recuperar")
        ? baseConfig
        : (themeById(data.settings.theme, mode === "light")?.config ??
          baseConfig)
      : accessibility.highContrast === true ||
          (accessibility.highContrast === null && contrast)
        ? themeById("contrast")!.config
        : config;
    const vars = themeVariables(active);
    Object.entries(vars).forEach(([key, value]) =>
      root.style.setProperty(key, value),
    );
    root.dataset.theme =
      parseInt(active.colors.bg.slice(1, 3), 16) +
        parseInt(active.colors.bg.slice(3, 5), 16) +
        parseInt(active.colors.bg.slice(5, 7), 16) >
      420
        ? "light"
        : "dark";
    root.style.colorScheme = root.dataset.theme;
    root.lang = resolveLocale(data.settings.locale);
    root.dir = documentDirection(root.lang);
    root.dataset.chromatic = safe ? "safe" : "active";
    root.dataset.rgbMode =
      safe || hidden || reduced || accessibility.reducedMotion === true
        ? "off"
        : active.effects.mode;
    for (const target of ["icons", "borders", "highlights", "decoration"])
      root.setAttribute(
        "data-rgb-" + target,
        String(active.effects.targets.includes(target as any)),
      );
    return () => {
      Object.keys(vars).forEach((k) => root.style.removeProperty(k));
    };
  }, [
    config,
    data.settings.locale,
    safe,
    hidden,
    reduced,
    contrast,
    accessibility.highContrast,
    accessibility.reducedMotion,
  ]);
  return !safe && config.effects.mode !== "off" ? (
    <button
      className="button secondary chromatic-stop"
      type="button"
      onClick={() => {
        const next = structuredClone(config);
        next.effects.mode = "off";
        select("custom", next);
      }}
    >
      Desligar RGB
    </button>
  ) : null;
}
