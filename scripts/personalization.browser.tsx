import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Appearance from "../src/foundation/features/personalization/AppearancePage";
import Studio from "../src/foundation/features/personalization/ChromaticStudio";
import Language from "../src/foundation/features/personalization/LanguagePage";
import Recovery from "../src/foundation/features/personalization/RecoveryPage";
import {
  Session,
  PersonalizationEffects,
  personalKey,
  usePersonalization,
} from "../src/foundation/features/personalization/PersonalizationProvider";
import { defaults } from "../src/foundation/features/personalization/model";
import {
  officialThemes,
  baseConfig,
} from "../src/foundation/features/personalization/themes";
import { updateAccessibility } from "../src/foundation/features/preferences/store";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
let calls: any[] = [],
  failure = false,
  remote = defaults();
const repository = {
  async call(action: "read" | "save", data?: any) {
    calls.push({ action, data });
    if (failure) throw Error("Falha de rede; dados locais preservados.");
    if (action === "read") return structuredClone(remote);
    if (data.revision !== remote.revision)
      throw Object.assign(Error("Conflito de preferências"), { code: "40001" });
    remote = { ...structuredClone(data), revision: remote.revision + 1 };
    return structuredClone(remote);
  },
};
const check = (value: any, message: string) => {
  if (!value) throw Error(message);
};
const wait = (n = 60) => new Promise((r) => setTimeout(r, n));
function button(text: string) {
  const node = [...fixture.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!node) throw Error("Botão ausente: " + text);
  return node;
}
function field(label: string) {
  const node =
    fixture.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(`[aria-label="${label}"]`) ??
    [...fixture.querySelectorAll("label")]
      .find((l) => l.textContent?.trim().startsWith(label))
      ?.querySelector<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input,textarea,select");
  if (!node) throw Error("Campo ausente: " + label);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => {
    node.click();
    await wait();
  });
}
async function set(
  node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const proto =
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await wait();
  });
}
async function mount(
  node: React.ReactNode,
  path = "/definicoes/aparencia",
  owner?: string,
  sync = false,
) {
  await act(async () =>
    root.render(
      <MemoryRouter key={crypto.randomUUID()} initialEntries={[path]}>
        <Session
          owner={owner}
          enabled={sync}
          repository={sync ? repository : undefined}
        >
          <PersonalizationEffects />
          {node}
        </Session>
      </MemoryRouter>,
    ),
  );
  await act(async () => {
    await wait(100);
  });
}
async function reset() {
  await act(async () => root.render(null));
  for (const key of Object.keys(localStorage))
    if (key.startsWith("ag:personalization") || key === "ag.v2.theme")
      localStorage.removeItem(key);
  calls = [];
  failure = false;
  remote = defaults();
  updateAccessibility({ reducedMotion: null, highContrast: null });
}
function seed(data = defaults(), owner?: string) {
  localStorage.setItem(
    personalKey(owner),
    JSON.stringify({ version: 1, data, dirty: false }),
  );
}
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
async function driver(request: any) {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    const done = (e: Event) => {
      if ((e as CustomEvent).detail === id) {
        window.removeEventListener("test-driver-done", done);
        resolve();
      }
    };
    window.addEventListener("test-driver-done", done);
    (window as any).testDriver(JSON.stringify({ ...request, id }));
  });
}
window.prompt = () => "Tema do teste";
window.confirm = () => true;
await run(
  "15 temas oficiais com ícones sem emojis aplicam cores reais",
  async () => {
    await reset();
    await mount(<Appearance />);
    const cards = [
      ...fixture.querySelectorAll<HTMLButtonElement>(".chromatic-theme-card"),
    ];
    check(cards.length === 15, "galeria incompleta");
    check(
      !/\p{Extended_Pictographic}/u.test(
        fixture.querySelector(".chromatic-gallery")!.textContent!,
      ),
      "emoji na galeria",
    );
    for (let i = 0; i < cards.length; i++) {
      await click(cards[i]);
      check(
        cards[i].getAttribute("aria-pressed") === "true",
        "seleção perdida",
      );
      check(!!cards[i].querySelector("svg"), "ícone ausente");
      const stored = JSON.parse(localStorage.getItem(personalKey())!);
      check(
        stored.data.settings.theme === officialThemes[i].id,
        "não persistiu",
      );
    }
    await click(button("Restaurar padrão"));
    check(
      document.documentElement.style.getPropertyValue("--bg") === "#0b1524",
      "padrão não restaurado",
    );
  },
);
await run(
  "Prévia, desfazer/refazer e aplicar não confundem confirmação",
  async () => {
    await reset();
    await mount(<Studio />, "/definicoes/aparencia/estudio");
    const before = document.documentElement.style.getPropertyValue("--ui-size");
    await set(field("Tamanho geral"), "18");
    check(
      document.documentElement.style.getPropertyValue("--ui-size") === before,
      "prévia alterou o site",
    );
    await click(button("Desfazer"));
    check(field("Tamanho geral").value === "16", "desfazer falhou");
    await click(button("Refazer"));
    check(field("Tamanho geral").value === "18", "refazer falhou");
    await click(button("Comparar antes/depois"));
    check(
      fixture.querySelectorAll(".chromatic-preview").length === 2,
      "comparação ausente",
    );
    await click(button("Aplicar aparência"));
    check(
      document.documentElement.style.getPropertyValue("--ui-size") === "18px",
      "não aplicou",
    );
  },
);
await run(
  "Guardar novo tema é persistente e privado no dispositivo",
  async () => {
    await reset();
    await mount(<Studio />, "/definicoes/aparencia/estudio");
    await click(button("Guardar como novo tema"));
    const saved = JSON.parse(localStorage.getItem(personalKey())!).data;
    check(
      saved.themes.length === 1 && saved.themes[0].name === "Tema do teste",
      "tema não guardado",
    );
    await mount(<Appearance />);
    check(
      fixture.textContent?.includes("Tema do teste"),
      "tema perdido após remontar",
    );
    await click(button("Renomear"));
    await click(button("Duplicar"));
    check(
      JSON.parse(localStorage.getItem(personalKey())!).data.themes.length === 2,
      "duplicação falhou",
    );
    await click(button("Excluir tema próprio"));
    check(
      JSON.parse(localStorage.getItem(personalKey())!).data.themes.length === 1,
      "eliminação falhou",
    );
  },
);
await run("CSS malicioso é rejeitado sem injetar stylesheet", async () => {
  await reset();
  await mount(<Studio />, "/definicoes/aparencia/estudio");
  await click(fixture.querySelector("summary")!);
  await set(field("CSS pessoal"), '@import "https://evil.invalid/steal.css";');
  await click(button("Validar CSS e pré-visualizar"));
  check(!!fixture.querySelector('[role="alert"]'), "erro invisível");
  check(
    ![...document.querySelectorAll("style")].some((s) =>
      s.textContent?.includes("evil.invalid"),
    ),
    "CSS injetado",
  );
  check(
    document.documentElement.style.getPropertyValue("--bg") === "#0b1524",
    "tema alterado",
  );
  await set(field("CSS pessoal"), ":theme { --ui-size: 18px; }");
  await click(button("Validar CSS e pré-visualizar"));
  check(fixture.textContent?.includes("--ui-size"), "realce ausente");
  check(
    document.documentElement.style.getPropertyValue("--ui-size") === "16px",
    "CSS aplicou sem confirmar",
  );
});
await run(
  "Todos os países, pesquisa localizada e região independente de leitura",
  async () => {
    await reset();
    await mount(<Language />, "/definicoes/idioma");
    await set(field("Pesquisar país"), "mocambique");
    check(fixture.textContent?.includes("1 de 249"), "pesquisa não filtra");
    await set(field("País ou território"), "MZ");
    check(
      fixture.textContent?.includes("vmw"),
      "línguas documentadas ausentes",
    );
    await click(button("Ver todos os idiomas"));
    await set(field("Pesquisar idioma"), "francês");
    const french = [
      ...fixture.querySelectorAll<HTMLInputElement>(
        ".language-recommendations input",
      ),
    ].find((e) => /·\s*fr$/.test(e.parentElement?.textContent ?? ""));
    check(french, "francês ausente fora da região");
    await click(french!);
    await click(button("Guardar preferência neste dispositivo"));
    const data = JSON.parse(localStorage.getItem(personalKey())!).data;
    check(
      data.settings.region === "MZ" &&
        data.settings.readingLanguages.includes("fr"),
      "preferências misturadas: " +
        JSON.stringify({
          region: data.settings.region,
          languages: data.settings.readingLanguages,
        }),
    );
    check(
      data.settings.locale === "pt-PT" &&
        document.documentElement.lang === "pt-PT",
      "idioma inválido",
    );
  },
);
await run(
  "Traduções parciais não são anunciadas como disponíveis",
  async () => {
    await reset();
    await mount(<Language />, "/definicoes/idioma");
    const radios = [
      ...fixture.querySelectorAll<HTMLInputElement>(
        'input[name="interface-locale"]',
      ),
    ];
    check(
      radios.filter((r) => !r.disabled).length === 1,
      "tradução parcial selecionável",
    );
    check(
      radios.find((r) => r.value === "en")?.disabled,
      "inglês incompleto ativo",
    );
    check(
      fixture.textContent?.includes("não estão completas"),
      "limitação omitida",
    );
  },
);
await run(
  "Gravação autenticada usa ACK e recupera noutra sessão simulada",
  async () => {
    await reset();
    await mount(<Appearance />, "/definicoes/aparencia", "A", true);
    await click(
      [
        ...fixture.querySelectorAll<HTMLButtonElement>(".chromatic-theme-card"),
      ].find((b) => b.textContent?.includes("Rubi"))!,
    );
    check(
      calls.every((c) => c.action === "read"),
      "guardou sem confirmação",
    );
    await click(button("Guardar na conta"));
    check(
      calls.some((c) => c.action === "save"),
      "não guardou na conta",
    );
    await act(async () => root.render(null));
    localStorage.removeItem(personalKey("A"));
    await mount(<Appearance />, "/definicoes/aparencia", "A", true);
    check(
      document.documentElement.style.getPropertyValue("--bg") === "#180c12",
      "não recuperou a conta",
    );
  },
);
await run("Conta B não herda a aparência de A nem de visitante", async () => {
  await reset();
  const v = defaults();
  v.settings.theme = "ruby";
  v.settings.config = structuredClone(
    officialThemes.find((t) => t.id === "ruby")!.config,
  );
  seed(v);
  await mount(<Appearance />, "/definicoes/aparencia", "A", false);
  check(
    document.documentElement.style.getPropertyValue("--bg") === "#0b1524",
    "importação anónima automática",
  );
  await click(
    [
      ...fixture.querySelectorAll<HTMLButtonElement>(".chromatic-theme-card"),
    ].find((b) => b.textContent?.includes("Ametista"))!,
  );
  await mount(<Appearance />, "/definicoes/aparencia", "B", false);
  check(
    document.documentElement.style.getPropertyValue("--bg") === "#0b1524",
    "A contaminou B",
  );
  await click(button("Importar preferências deste dispositivo"));
  check(
    document.documentElement.style.getPropertyValue("--bg") === "#180c12",
    "importação explícita falhou",
  );
});
await run("Conflito remoto conserva as alterações locais", async () => {
  await reset();
  await mount(<Appearance />, "/definicoes/aparencia", "A", true);
  await click(
    [
      ...fixture.querySelectorAll<HTMLButtonElement>(".chromatic-theme-card"),
    ].find((b) => b.textContent?.includes("Sakura"))!,
  );
  remote = { ...defaults(), revision: 1 };
  await click(button("Guardar na conta"));
  check(
    document.documentElement.style.getPropertyValue("--bg") === "#1d1019",
    "conflito apagou local",
  );
  check(fixture.textContent?.includes("conciliar"), "conflito sem resolução");
  await click(button("Conciliar preservando temas"));
  await click(button("Guardar na conta"));
  check(remote.settings.theme === "sakura", "conciliação falhou");
});
await run("Rede indisponível não declara sucesso remoto", async () => {
  await reset();
  await mount(<Appearance />, "/definicoes/aparencia", "A", true);
  await click(
    [
      ...fixture.querySelectorAll<HTMLButtonElement>(".chromatic-theme-card"),
    ].find((b) => b.textContent?.includes("Oceano"))!,
  );
  failure = true;
  await click(button("Guardar na conta"));
  check(fixture.textContent?.includes("Falha de rede"), "erro invisível");
  check(
    !fixture.textContent?.includes("Gravação confirmada na conta"),
    "sucesso fictício",
  );
  check(
    JSON.parse(localStorage.getItem(personalKey("A"))!).dirty,
    "rascunho perdido",
  );
});
await run(
  "RGB respeita movimento reduzido e pode ser desligado imediatamente",
  async () => {
    await reset();
    const v = defaults();
    v.settings.theme = "custom";
    v.settings.config.effects.mode = "dynamic";
    seed(v);
    await act(async () => {
      await driver({
        kind: "media",
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    });
    await mount(<Appearance />);
    check(
      document.documentElement.dataset.rgbMode === "off",
      "ignorou movimento reduzido",
    );
    await act(async () => {
      await driver({
        kind: "media",
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
      await wait();
    });
    check(
      document.documentElement.dataset.rgbMode === "dynamic",
      "preferência perdida",
    );
    await click(button("Desligar RGB"));
    check(document.documentElement.dataset.rgbMode === "off", "não desligou");
  },
);
await run(
  "Admin e autenticação não recebem personalizações arbitrárias",
  async () => {
    await reset();
    const v = defaults();
    v.settings.theme = "custom";
    v.settings.config.typography.size = 22;
    v.settings.config.effects.mode = "dynamic";
    seed(v);
    await mount(<p>Admin protegido</p>, "/admin");
    check(
      document.documentElement.style.getPropertyValue("--ui-size") === "16px",
      "admin personalizado",
    );
    check(document.documentElement.dataset.rgbMode === "off", "RGB no admin");
    await mount(<p>Autenticação</p>, "/entrar");
    check(
      document.documentElement.style.getPropertyValue("--ui-size") === "16px",
      "login personalizado",
    );
  },
);
await run(
  "Recuperação funciona com dados ilegíveis e preserva original",
  async () => {
    await reset();
    localStorage.setItem(personalKey(), "{broken}");
    await mount(<Recovery />, "/definicoes/aparencia/recuperar");
    await click(button("Restaurar Noite Estrelada"));
    check(
      document.documentElement.style.getPropertyValue("--bg") === "#0b1524",
      "recuperação falhou",
    );
    check(
      Object.keys(localStorage).some(
        (k) =>
          k.startsWith(personalKey() + ":recovery:") &&
          localStorage.getItem(k) === "{broken}",
      ),
      "original não preservado",
    );
  },
);
function FormSurvives() {
  const p = usePersonalization();
  const [text, setText] = useState("");
  return (
    <>
      <label>
        Trabalho em edição
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        onClick={() =>
          p.change({
            ...p.data,
            settings: { ...p.data.settings, region: "JP" },
          })
        }
      >
        Guardar região sem navegar
      </button>
    </>
  );
}
await run(
  "Preferências não remontam formulários ou mudam a direção de mangá",
  async () => {
    await reset();
    await mount(<FormSurvives />);
    await set(field("Trabalho em edição"), "Texto ainda não guardado");
    await click(button("Guardar região sem navegar"));
    check(
      field("Trabalho em edição").value === "Texto ainda não guardado",
      "formulário perdido",
    );
    check(
      document.documentElement.dir === "ltr",
      "direção da interface inválida",
    );
  },
);
for (const width of [360, 1280])
  await run(`Chromatic Studio e Idioma responsivos ${width}px`, async () => {
    await reset();
    await act(async () => {
      await driver({ kind: "viewport", width });
    });
    await mount(<Studio />, "/definicoes/aparencia/estudio");
    check(
      document.documentElement.scrollWidth <= window.innerWidth + 1,
      "overflow editor",
    );
    button("Aplicar aparência").focus();
    check(
      document.activeElement === button("Aplicar aparência"),
      "foco ausente",
    );
    await driver({ kind: "screenshot", label: `f61-studio-${width}` });
    await mount(<Language />, "/definicoes/idioma");
    check(
      document.documentElement.scrollWidth <= window.innerWidth + 1,
      "overflow idiomas",
    );
    await driver({ kind: "screenshot", label: `f61-language-${width}` });
    await mount(<Appearance />, "/definicoes/aparencia");
    await driver({ kind: "screenshot", label: `f61-gallery-${width}` });
  });
await act(async () => root.unmount());
document.getElementById("results")!.textContent = JSON.stringify(
  results,
  null,
  2,
);
document.documentElement.dataset.tests = results.every((r) => r.ok)
  ? "passed"
  : "failed";
