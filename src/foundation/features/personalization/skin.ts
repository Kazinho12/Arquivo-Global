import {
  colorKeys,
  normalizeColor,
  validateTheme,
  type ThemeConfig,
} from "./themes";
export interface SkinNode {
  type: "declaration";
  name: string;
  value: string;
  start: number;
}
/** Closed grammar, not arbitrary CSS: :theme { --known-token: literal; }. No raw input is injected. */
export function parseSkin(source: string): SkinNode[] {
  if (new TextEncoder().encode(source).length > 12000)
    throw Error("O CSS excede 12 KB.");
  let i = 0;
  const nodes: SkinNode[] = [];
  const fail = (m: string): never => {
    throw Error(`${m} (posição ${i + 1}).`);
  };
  const space = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) {
        i++;
        continue;
      }
      if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        if (end < 0) fail("Comentário não terminado");
        i = end + 2;
        continue;
      }
      break;
    }
  };
  const take = (c: string) => {
    space();
    if (!source.startsWith(c, i)) fail(`Esperado ${c}`);
    i += c.length;
  };
  const ident = () => {
    space();
    let v = "";
    while (i < source.length && /[a-z0-9-]/i.test(source[i])) v += source[i++];
    if (!v) fail("Identificador em falta");
    return v;
  };
  space();
  while (i < source.length) {
    take(":");
    if (ident() !== "theme") fail("Só o seletor :theme é permitido");
    take("{");
    space();
    while (source[i] !== "}") {
      if (i >= source.length) fail("Bloco não terminado");
      const start = i;
      const name = ident();
      if (!name.startsWith("--"))
        fail("Só variáveis documentadas são permitidas");
      take(":");
      space();
      let value = "",
        depth = 0;
      while (i < source.length) {
        const c = source[i];
        if ((c === ";" || c === "}") && depth === 0) break;
        if (c === "(") {
          depth++;
          if (depth > 1) fail("Funções aninhadas não são permitidas");
        } else if (c === ")") {
          depth--;
          if (depth < 0) fail("Parênteses inválidos");
        } else if (!/[a-zA-Z0-9#.,%\s-]/.test(c))
          fail("Token CSS não permitido");
        value += c;
        i++;
      }
      if (depth !== 0 || !value.trim()) fail("Valor CSS inválido");
      nodes.push({ type: "declaration", name, value: value.trim(), start });
      if (nodes.length > 60) fail("Máximo de 60 declarações");
      if (source[i] === ";") i++;
      space();
    }
    take("}");
    space();
  }
  return nodes;
}
const numeric: Record<
  string,
  { group: "typography" | "components"; key: string; unit: string }
> = {
  "--ui-size": { group: "typography", key: "size", unit: "px" },
  "--ui-leading": { group: "typography", key: "lineHeight", unit: "" },
  "--ui-weight": { group: "typography", key: "headingWeight", unit: "" },
  "--ui-tracking": { group: "typography", key: "letterSpacing", unit: "em" },
  "--card-radius": { group: "components", key: "cardRadius", unit: "px" },
  "--button-radius": { group: "components", key: "buttonRadius", unit: "px" },
  "--ui-border": { group: "components", key: "borderWidth", unit: "px" },
  "--ui-spacing": { group: "components", key: "spacing", unit: "" },
};
export function compileSkin(source: string, base: ThemeConfig): ThemeConfig {
  const next = structuredClone(base);
  const seen = new Set<string>();
  for (const node of parseSkin(source)) {
    if (seen.has(node.name)) throw Error("Variável repetida: " + node.name);
    seen.add(node.name);
    const colorName =
      node.name === "--button-ink" ? "buttonText" : node.name.slice(2);
    if (colorKeys.includes(colorName as any)) {
      next.colors[colorName as keyof ThemeConfig["colors"]] = normalizeColor(
        node.value,
      );
      continue;
    }
    if (node.name === "--ui-font") {
      if (!["sans", "serif", "mono"].includes(node.value))
        throw Error("Família tipográfica não permitida.");
      next.typography.font = node.value as any;
      continue;
    }
    const rule = numeric[node.name];
    if (!rule) throw Error("Variável não permitida: " + node.name);
    if (rule.unit && !node.value.endsWith(rule.unit))
      throw Error("Unidade esperada: " + rule.unit);
    const text = rule.unit
      ? node.value.slice(0, -rule.unit.length)
      : node.value;
    if (!/^\d+(?:\.\d+)?$/.test(text))
      throw Error("Só valores numéricos literais são permitidos.");
    (next[rule.group] as any)[rule.key] = Number(text);
  }
  return validateTheme(next);
}
export function skinSource(c: ThemeConfig) {
  return (
    ":theme {\n" +
    colorKeys
      .map(
        (key) =>
          `  --${key === "buttonText" ? "button-ink" : key}: ${c.colors[key]};`,
      )
      .join("\n") +
    `\n  --ui-font: ${c.typography.font};\n  --ui-size: ${c.typography.size}px;\n  --ui-leading: ${c.typography.lineHeight};\n  --ui-weight: ${c.typography.headingWeight};\n  --ui-tracking: ${c.typography.letterSpacing}em;\n  --card-radius: ${c.components.cardRadius}px;\n  --button-radius: ${c.components.buttonRadius}px;\n  --ui-border: ${c.components.borderWidth}px;\n  --ui-spacing: ${c.components.spacing};\n}`
  );
}
export function skinHighlight(source: string) {
  try {
    return parseSkin(source).map((n) => ({ name: n.name, value: n.value }));
  } catch {
    return [];
  }
}
