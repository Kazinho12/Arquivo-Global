import { getContrastRatio } from "../../data/covers";
export const colorKeys = [
  "bg",
  "surface",
  "elevated",
  "text",
  "muted",
  "link",
  "button",
  "buttonText",
  "border",
  "accent",
  "focus",
  "success",
  "warning",
  "error",
] as const;
export type ColorKey = (typeof colorKeys)[number];
export interface ThemeConfig {
  colors: Record<ColorKey, string>;
  typography: {
    font: "sans" | "serif" | "mono";
    size: number;
    lineHeight: number;
    headingWeight: number;
    letterSpacing: number;
  };
  components: {
    cardRadius: number;
    buttonRadius: number;
    borderWidth: number;
    shadow: "none" | "soft" | "deep";
    spacing: number;
    density: "compact" | "normal" | "comfortable";
  };
  effects: {
    mode: "off" | "static" | "soft" | "dynamic";
    intensity: number;
    speed: number;
    saturation: number;
    targets: ("borders" | "icons" | "highlights" | "decoration")[];
  };
}
export const baseConfig: ThemeConfig = {
  colors: {
    bg: "#0b1524",
    surface: "#101e30",
    elevated: "#192b40",
    text: "#e9eef5",
    muted: "#b7c8d9",
    link: "#c3d9ed",
    button: "#c3d9ed",
    buttonText: "#102338",
    border: "#8194a8",
    accent: "#c3d9ed",
    focus: "#87c5ff",
    success: "#99e5bd",
    warning: "#ffdc87",
    error: "#ffb5b9",
  },
  typography: {
    font: "sans",
    size: 16,
    lineHeight: 1.5,
    headingWeight: 600,
    letterSpacing: 0,
  },
  components: {
    cardRadius: 12,
    buttonRadius: 5,
    borderWidth: 1,
    shadow: "soft",
    spacing: 1,
    density: "normal",
  },
  effects: {
    mode: "off",
    intensity: 0.15,
    speed: 40,
    saturation: 0.6,
    targets: ["decoration"],
  },
};
const clone = () => structuredClone(baseConfig);
function palette(
  bg: string,
  surface: string,
  elevated: string,
  accent: string,
  light = false,
): ThemeConfig {
  const c = clone();
  c.colors = {
    ...c.colors,
    bg,
    surface,
    elevated,
    accent,
    link: accent,
    button: accent,
    buttonText: light ? "#ffffff" : "#081018",
    text: light ? "#15212d" : "#fafaff",
    muted: light ? "#374756" : "#d4dce5",
    border: light ? "#607080" : "#899bac",
    focus: light ? "#174c7c" : "#afe8ff",
    success: light ? "#17683b" : "#99e5bd",
    warning: light ? "#785000" : "#ffdc87",
    error: light ? "#a51d3a" : "#ffb5b9",
  };
  return c;
}
export const officialThemes = [
  {
    id: "night",
    name: "Noite Estrelada",
    description: "Azul profundo · identidade oficial",
    icon: "stars",
    config: clone(),
  },
  {
    id: "ruby",
    name: "Rubi",
    description: "Vermelho intenso, luz suave",
    icon: "gem",
    config: palette("#180c12", "#2c141e", "#3a1d29", "#ff9cb3"),
  },
  {
    id: "sunset",
    name: "Pôr do Sol",
    description: "Laranja acolhedor",
    icon: "sunset",
    config: palette("#1b100a", "#2e1d12", "#3e291c", "#ffc190"),
  },
  {
    id: "gold",
    name: "Aurora Dourada",
    description: "Amarelo luminoso",
    icon: "sunrise",
    config: palette("#17140a", "#292413", "#37301b", "#ffe39a"),
  },
  {
    id: "emerald",
    name: "Esmeralda",
    description: "Verde profundo",
    icon: "leaf",
    config: palette("#091912", "#112b20", "#19392b", "#a1e8bd"),
  },
  {
    id: "ocean",
    name: "Oceano",
    description: "Azul-claro sereno",
    icon: "waves",
    config: palette("#091820", "#102b38", "#173949", "#9cddfa"),
  },
  {
    id: "sapphire",
    name: "Safira",
    description: "Azul intenso",
    icon: "diamond",
    config: palette("#0b1025", "#141e3b", "#1d2a4b", "#adc6ff"),
  },
  {
    id: "amethyst",
    name: "Ametista",
    description: "Violeta literário",
    icon: "orbit",
    config: palette("#150e21", "#241a34", "#30233f", "#d9b7ff"),
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Rosa delicado",
    icon: "flower",
    config: palette("#1d1019", "#321f2d", "#412a3a", "#ffc2e2"),
  },
  {
    id: "parchment",
    name: "Pergaminho",
    description: "Sépia literário",
    icon: "scroll",
    config: palette("#f5eddc", "#fff9ec", "#ebe0cb", "#67431f", true),
  },
  {
    id: "minimal",
    name: "Minimalista",
    description: "Preto, branco e cinza",
    icon: "square",
    config: palette("#f5f5f5", "#ffffff", "#e9e9e9", "#303030", true),
  },
  {
    id: "contrast",
    name: "Alto Contraste",
    description: "Preto e branco, foco reforçado",
    icon: "contrast",
    config: {
      ...palette("#000000", "#050505", "#101010", "#ffffff"),
      colors: {
        ...palette("#000000", "#050505", "#101010", "#ffffff").colors,
        text: "#ffffff",
        muted: "#ffffff",
        focus: "#ffff00",
        border: "#ffffff",
      },
    },
  },
  {
    id: "light",
    name: "Claro",
    description: "Superfícies claras e azul editorial",
    icon: "sun",
    config: palette("#f4f6f8", "#ffffff", "#e7edf3", "#1e4566", true),
  },
  {
    id: "dark",
    name: "Escuro",
    description: "Azul-abissal clássico",
    icon: "moon",
    config: clone(),
  },
  {
    id: "system",
    name: "Automático",
    description: "Acompanha o sistema operativo",
    icon: "monitor",
    config: clone(),
  },
] as const;
export const themeById = (id: string, light = false) =>
  officialThemes.find(
    (t) => t.id === (id === "system" ? (light ? "light" : "night") : id),
  );
export function normalizeColor(input: string): string {
  const value = input.trim().toLowerCase();
  if (/^#[a-f0-9]{6}$/.test(value)) return value;
  if (/^#[a-f0-9]{3}$/.test(value))
    return (
      "#" +
      value
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  const fn = /^(rgb|hsl)\(([^()]*)\)$/.exec(value);
  if (!fn) throw Error("Usa HEX, rgb() ou hsl() sem transparência.");
  const parts = fn[2].replaceAll(",", " ").trim().split(/\s+/);
  if (
    parts.length !== 3 ||
    parts.some((p) => !/^\d+(?:\.\d+)?(?:%|deg)?$/.test(p))
  )
    throw Error("Cor RGB/HSL inválida.");
  let rgb: number[];
  if (fn[1] === "rgb") {
    rgb = parts.map((p) => {
      const n = parseFloat(p),
        max = p.endsWith("%") ? 100 : 255;
      if (n > max || p.endsWith("deg")) throw Error("RGB fora dos limites.");
      return (n / max) * 255;
    });
  } else {
    if (
      !parts[1].endsWith("%") ||
      !parts[2].endsWith("%") ||
      parts[0].endsWith("%")
    )
      throw Error("HSL requer percentagens de saturação e luminosidade.");
    const h = parseFloat(parts[0]),
      s = parseFloat(parts[1]) / 100,
      l = parseFloat(parts[2]) / 100;
    if (h > 360 || s > 1 || l > 1) throw Error("HSL fora dos limites.");
    const a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map((n) => {
      const k = (n + h / 30) % 12;
      return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    });
  }
  return (
    "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")
  );
}
export function contrastErrors(c: ThemeConfig): string[] {
  const errors: string[] = [];
  for (const surface of ["bg", "surface", "elevated"] as const) {
    for (const text of [
      "text",
      "muted",
      "link",
      "success",
      "warning",
      "error",
    ] as const)
      if (getContrastRatio(c.colors[text], c.colors[surface]) < 4.5)
        errors.push(`${text}/${surface}: contraste inferior a 4,5:1`);
    if (getContrastRatio(c.colors.focus, c.colors[surface]) < 3)
      errors.push(`focus/${surface}: contraste inferior a 3:1`);
    if (getContrastRatio(c.colors.border, c.colors[surface]) < 3)
      errors.push(`border/${surface}: contraste inferior a 3:1`);
  }
  if (getContrastRatio(c.colors.buttonText, c.colors.button) < 4.5)
    errors.push("Texto do botão: contraste inferior a 4,5:1");
  return errors;
}
function exact(value: any, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...keys].sort().join("|")
  )
    throw Error("Estrutura de tema inválida.");
}
export function validateTheme(input: unknown, contrast = true): ThemeConfig {
  const v = structuredClone(input) as ThemeConfig;
  exact(v, ["colors", "typography", "components", "effects"]);
  exact(v.colors, [...colorKeys]);
  for (const key of colorKeys) {
    if (typeof v.colors[key] !== "string") throw Error("Cor inválida.");
    v.colors[key] = normalizeColor(v.colors[key]);
  }
  exact(v.typography, [
    "font",
    "size",
    "lineHeight",
    "headingWeight",
    "letterSpacing",
  ]);
  exact(v.components, [
    "cardRadius",
    "buttonRadius",
    "borderWidth",
    "shadow",
    "spacing",
    "density",
  ]);
  exact(v.effects, ["mode", "intensity", "speed", "saturation", "targets"]);
  const bounded = (n: number, min: number, max: number) => {
    if (!Number.isFinite(n) || n < min || n > max)
      throw Error("Valor de personalização fora dos limites.");
  };
  bounded(v.typography.size, 14, 22);
  bounded(v.typography.lineHeight, 1.4, 1.9);
  bounded(v.typography.headingWeight, 500, 800);
  bounded(v.typography.letterSpacing, 0, 0.12);
  bounded(v.components.cardRadius, 0, 24);
  bounded(v.components.buttonRadius, 0, 24);
  bounded(v.components.borderWidth, 1, 3);
  bounded(v.components.spacing, 0.85, 1.3);
  bounded(v.effects.intensity, 0, 0.4);
  bounded(v.effects.speed, 10, 90);
  bounded(v.effects.saturation, 0, 1);
  if (
    !["sans", "serif", "mono"].includes(v.typography.font) ||
    !["none", "soft", "deep"].includes(v.components.shadow) ||
    !["compact", "normal", "comfortable"].includes(v.components.density) ||
    !["off", "static", "soft", "dynamic"].includes(v.effects.mode) ||
    !Array.isArray(v.effects.targets) ||
    v.effects.targets.length > 4 ||
    new Set(v.effects.targets).size !== v.effects.targets.length ||
    v.effects.targets.some(
      (t) => !["borders", "icons", "highlights", "decoration"].includes(t),
    )
  )
    throw Error("Opção de tema inválida.");
  if (contrast && contrastErrors(v).length)
    throw Error(contrastErrors(v).join("; "));
  return v;
}
export function themeVariables(c: ThemeConfig): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(c.colors))
    result["--" + (key === "buttonText" ? "button-ink" : key)] = value;
  result["--accent-ink"] =
    getContrastRatio(c.colors.accent, "#000000") >=
    getContrastRatio(c.colors.accent, "#ffffff")
      ? "#000000"
      : "#ffffff";
  result["--font-literary"] = 'Georgia, "Times New Roman", serif';
  result["--ui-font"] = {
    sans: 'Inter, "Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: "ui-monospace, monospace",
  }[c.typography.font];
  result["--ui-size"] = c.typography.size + "px";
  result["--ui-leading"] = String(c.typography.lineHeight);
  result["--ui-weight"] = String(c.typography.headingWeight);
  result["--ui-tracking"] = c.typography.letterSpacing + "em";
  result["--card-radius"] = c.components.cardRadius + "px";
  result["--button-radius"] = c.components.buttonRadius + "px";
  result["--ui-border"] = c.components.borderWidth + "px";
  result["--ui-spacing"] = String(
    c.components.spacing *
      { compact: 0.9, normal: 1, comfortable: 1.1 }[c.components.density],
  );
  result["--shadow"] = {
    none: "none",
    soft: "0 12px 35px #0002",
    deep: "0 24px 65px #0005",
  }[c.components.shadow];
  result["--rgb-intensity"] = String(c.effects.intensity);
  result["--rgb-speed"] = c.effects.speed + "s";
  result["--rgb-saturation"] = String(c.effects.saturation);
  return result;
}
