import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { PublicVisualReader } from "../src/foundation/features/visual/PublicVisualReader";
import type { PublishedWork } from "../src/foundation/features/catalog/repository";
import type { PublicVisualRepository } from "../src/foundation/features/visual/public";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
const workId = "10000000-0000-0000-0000-000000000001",
  entryId = "20000000-0000-0000-0000-000000000001",
  nextId = "20000000-0000-0000-0000-000000000002";
const canvas = document.createElement("canvas");
canvas.width = 80;
canvas.height = 120;
canvas.getContext("2d")!.fillRect(0, 0, 80, 120);
const png = canvas.toDataURL();
let requests: number[] = [],
  offline = false,
  withdrawn = false,
  networkRequests = 0;
const originalFetch = window.fetch;
window.fetch = async () => {
  networkRequests++;
  throw Error("Unexpected external request");
};
const repository: PublicVisualRepository = {
  async pages(_work, entry, offset) {
    requests.push(offset);
    if (offline) throw Error("Falha de rede de teste");
    if (withdrawn) return null;
    const total = entry === entryId ? 45 : 1;
    return {
      total,
      items: Array.from(
        { length: Math.min(20, Math.max(0, total - offset)) },
        (_, i) => ({
          id: `30000000-0000-0000-0000-${String(offset + i + 1).padStart(12, "0")}`,
          position: offset + i + 1,
          width: 80,
          height: 120,
        }),
      ),
    };
  },
};
let work: PublishedWork;
function seed(format: "Mangá" | "HQ / Comic" = "Mangá", vertical = false) {
  work = {
    id: workId,
    title: "Obra visual pública",
    author: "Autora real de teste",
    authorUsername: "autora",
    authorId: "autora",
    createdAt: "2026-01-02",
    format,
    genre: "",
    tags: [],
    synopsis: "Sinopse",
    cover: 1,
    origin: "user-publication",
    language: "pt",
    ageRating: "Livre",
    contentWarnings: [],
    firstPublishedAt: "2026-01-01",
    lastPublishedAt: "2026-01-02",
    hasVisualPublication: true,
    visualSettings: {
      format: vertical ? "webtoon" : format === "Mangá" ? "manga" : "hq",
      mode: vertical ? "vertical" : "paged",
      direction: format === "Mangá" ? "rtl" : "ltr",
    },
    chapters: [
      {
        id: entryId,
        number: 1,
        title: "Capítulo 1",
        content: "",
        publicVisualPageCount: 45,
      },
      {
        id: nextId,
        number: 2,
        title: "Capítulo 2",
        content: "",
        publicVisualPageCount: 1,
      },
    ],
  };
  requests = [];
  offline = false;
  withdrawn = false;
}
function Harness() {
  const { entry } = useParams();
  const chapter = work.chapters.find((e) => e.id === entry);
  return chapter ? (
    <PublicVisualReader
      key={chapter.id}
      work={work}
      chapter={chapter}
      repository={repository}
      imageUrl={() => png}
    />
  ) : (
    <p>Capítulo indisponível</p>
  );
}
const pause = () => new Promise((r) => setTimeout(r, 90));
async function settle() {
  await act(async () => {
    await pause();
    await pause();
  });
}
async function mount() {
  await act(async () => {
    root.render(
      <MemoryRouter
        key={crypto.randomUUID()}
        initialEntries={[`/obras/${workId}/capitulos/${entryId}`]}
      >
        <Routes>
          <Route path="/obras/:work/capitulos/:entry" element={<Harness />} />
          <Route path="/obras/:work" element={<p>Detalhes da obra</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await pause();
  });
  await settle();
}
function check(value: unknown, message: string) {
  if (!value) throw Error(message);
}
async function click(text: string) {
  const button = Array.from(fixture.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  check(button, "Botão ausente: " + text);
  check(!button!.disabled, "Botão desativado: " + text);
  await act(async () => {
    button!.click();
    await pause();
  });
  await settle();
}
async function select(value: string) {
  const field = Array.from(fixture.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === value),
  )!;
  check(field, "Select ausente: " + value);
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await pause();
  });
  await settle();
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
  await settle();
}
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
seed();
await mount();
await run(
  "Leitura anónima usa apenas um lote público e mostra título, autor, progresso e proporção",
  async () => {
    check(requests.join(",") === "0", "Não limitado a 20 metadados");
    check(
      fixture.textContent?.includes("Autora real de teste"),
      "Autor ausente",
    );
    check(
      fixture.querySelector("h1")?.textContent === "Capítulo 1",
      "Título incorreto",
    );
    check(
      fixture.querySelectorAll(".public-visual-image").length === 1,
      "Transferência de capítulo inteiro",
    );
    const image = fixture.querySelector<HTMLImageElement>(
      ".public-visual-image img",
    )!;
    check(image?.naturalWidth === 80, "Imagem não carregada");
    const box = image.getBoundingClientRect();
    check(
      Math.abs(box.width / box.height - 2 / 3) < 0.02,
      "Imagem cortada/deformada",
    );
    check(networkRequests === 0, "Consultou serviço externo");
  },
);
await run(
  "Mangá RTL: setas reais, ordem editorial e controlos de formulário preservados",
  async () => {
    fixture.querySelector<HTMLElement>(".public-visual-canvas")!.focus();
    await driver({ kind: "key", key: "ArrowLeft" });
    check(
      fixture
        .querySelector('[aria-label="Progresso do capítulo"]')
        ?.getAttribute("value") === "2",
      "RTL não avançou",
    );
    await driver({ kind: "key", key: "ArrowRight" });
    check(
      fixture
        .querySelector('[aria-label="Progresso do capítulo"]')
        ?.getAttribute("value") === "1",
      "RTL não recuou",
    );
    const field = fixture.querySelector("select")!;
    field.focus();
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
    check(
      fixture
        .querySelector('[aria-label="Progresso do capítulo"]')
        ?.getAttribute("value") === "1",
      "Tecla em controlo mudou página",
    );
  },
);
await run("Gesto tátil RTL avança sem inverter a sequência", async () => {
  const node = fixture.querySelector<HTMLElement>(".public-visual-canvas")!;
  await act(async () => {
    const start = new Touch({
        identifier: 1,
        target: node,
        clientX: 80,
        clientY: 120,
      }),
      end = new Touch({
        identifier: 1,
        target: node,
        clientX: 200,
        clientY: 120,
      });
    node.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [start] }),
    );
    node.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
    );
    await pause();
  });
  check(
    fixture
      .querySelector('[aria-label="Progresso do capítulo"]')
      ?.getAttribute("value") === "2",
    "Gesto não avançou",
  );
});
await run(
  "Zoom, ajuste à altura, tema local e saída imersiva com Escape",
  async () => {
    const appTheme = document.documentElement.dataset.theme;
    await act(async () =>
      fixture
        .querySelector<HTMLButtonElement>('[aria-label="Aumentar zoom"]')!
        .click(),
    );
    check(
      fixture.querySelector("output")?.textContent === "125%",
      "Zoom falhou",
    );
    await select("height");
    check(fixture.querySelector(".fit-height"), "Ajuste falhou");
    await select("light");
    check(
      document.documentElement.dataset.theme === appTheme,
      "Alterou tema global",
    );
    await click("Modo imersivo");
    check(
      fixture.querySelector(".public-visual-immersive"),
      "Modo imersivo ausente",
    );
    await driver({ kind: "key", key: "Escape" });
    check(
      !fixture.querySelector(".public-visual-immersive"),
      "Escape não saiu",
    );
  },
);
await run(
  "Erro de imagem visível com repetição e navegação entre capítulos publicados",
  async () => {
    const image = fixture.querySelector<HTMLImageElement>(
      ".public-visual-image img",
    )!;
    await act(async () => {
      image.dispatchEvent(new Event("error"));
      await pause();
    });
    check(fixture.querySelector('[role="alert"]'), "Erro de imagem oculto");
    await click("Repetir imagem 2");
    check(fixture.querySelector(".public-visual-image img"), "Não repetiu");
    const link = Array.from(fixture.querySelectorAll("a")).find(
      (a) => a.textContent === "Capítulo 2 →",
    )!;
    await act(async () => {
      link.click();
      await pause();
    });
    await settle();
    check(
      fixture.querySelector("h1")?.textContent === "Capítulo 2",
      "Não navegou",
    );
    check(
      fixture
        .querySelector('[aria-label="Progresso do capítulo"]')
        ?.getAttribute("max") === "1",
      "Progresso não reiniciou",
    );
  },
);
await run(
  "HQ LTR e fronteira de lotes: apenas os metadados necessários",
  async () => {
    seed("HQ / Comic");
    await mount();
    for (let i = 0; i < 20; i++) await click("Página seguinte");
    check(requests.join(",") === "0,20", "Paginação inesperada");
    check(
      fixture
        .querySelector('[aria-label="Progresso do capítulo"]')
        ?.getAttribute("value") === "21",
      "Fronteira perdeu a página",
    );
    check(
      fixture.querySelectorAll(".public-visual-image").length === 1,
      "Renderizou lote completo no modo paginado",
    );
  },
);
await run(
  "Webtoon: modo vertical, ordem preservada, imagens distantes diferidas e carregamento incremental",
  async () => {
    seed("HQ / Comic", true);
    await mount();
    check(
      fixture.querySelector('[data-mode="vertical"]'),
      "Não respeitou padrão Webtoon",
    );
    check(
      fixture.querySelectorAll(".public-visual-image").length === 20,
      "Lote inicial incorreto",
    );
    check(
      fixture.querySelectorAll(".public-visual-image img").length < 20,
      "Descarregou lote inteiro",
    );
    await click("Carregar próximas imagens");
    const positions = Array.from(
      fixture.querySelectorAll<HTMLElement>("[data-reader-page]"),
    ).map((n) => Number(n.dataset.readerPage));
    check(
      positions.length === 40 && positions.every((n, i) => n === i + 1),
      "Ordem vertical alterada",
    );
    check(requests.join(",") === "0,20", "Transferiu todo o capítulo");
  },
);
await run(
  "Rede indisponível: erro, repetição e capítulo retirado sem conteúdo residual",
  async () => {
    seed();
    offline = true;
    await mount();
    check(
      fixture.textContent?.includes("Falha de rede de teste"),
      "Erro de rede oculto",
    );
    offline = false;
    await click("Repetir carregamento");
    check(fixture.querySelector(".public-visual-image"), "Não recuperou");
    withdrawn = true;
    await mount();
    check(
      fixture.textContent?.includes("Capítulo indisponível"),
      "Retirada não bloqueou",
    );
    check(!fixture.querySelector("img"), "Conteúdo residual");
  },
);
for (const width of [360, 1280])
  for (const theme of ["light", "dark"])
    await run(`Responsividade e teclado ${width}px ${theme}`, async () => {
      seed("HQ / Comic");
      await mount();
      await driver({ kind: "viewport", width });
      await select(theme);
      check(
        document.documentElement.scrollWidth <= innerWidth + 1,
        "Overflow horizontal",
      );
      const b = fixture.querySelector<HTMLButtonElement>(
        '[aria-label="Aumentar zoom"]',
      )!;
      b.focus();
      check(document.activeElement === b, "Foco inacessível");
      check(
        getComputedStyle(fixture.querySelector(".public-visual-reader")!)
          .backgroundColor !== "rgba(0, 0, 0, 0)",
        "Tema sem fundo",
      );
      await driver({
        kind: "screenshot",
        label: `public-visual-${width}-${theme}`,
      });
    });
await act(async () => root.unmount());
window.fetch = originalFetch;
document.getElementById("results")!.textContent = JSON.stringify(
  results,
  null,
  2,
);
document.documentElement.dataset.tests = results.every((r) => r.ok)
  ? "passed"
  : "failed";
