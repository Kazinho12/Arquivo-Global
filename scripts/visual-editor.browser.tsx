import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { VisualChapterEditor } from "../src/foundation/features/visual/VisualChapterEditor";
import { RemoteWorksProvider } from "../src/foundation/features/studio/RemoteWorksProvider";
import { WorksController } from "../src/foundation/features/studio/worksController";
import type { WorksRepository } from "../src/foundation/features/studio/worksRepository";
import type { StudioWork } from "../src/foundation/features/studio/types";
import { VISUAL_LIMITS } from "../src/foundation/features/visual/types";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
const pause = () => new Promise((r) => setTimeout(r, 100));
const check = (v: unknown, m: string) => {
  if (!v) throw Error(m);
};
let stored: StudioWork = {
  id: crypto.randomUUID(),
  ownerId: crypto.randomUUID(),
  title: "Teste privado",
  synopsis: "",
  format: "Mangá",
  mode: "manga",
  genre: "",
  language: "pt",
  tags: [],
  ageRating: "Livre",
  contentWarnings: [],
  status: "draft",
  coverAccentColor: "#123456",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  revision: 1,
  chapters: [
    {
      id: crypto.randomUUID(),
      number: 1,
      title: "Ato antigo",
      content: "Guião preservado",
      revision: 1,
      entryType: "visual",
    },
  ],
};
let conflict = false,
  attempts: string[] = [],
  fail = true,
  controller: WorksController;
const assets = new Map<string, any>();
const canvas = document.createElement("canvas");
canvas.width = 80;
canvas.height = 120;
canvas.getContext("2d")!.fillRect(0, 0, 80, 120);
const png = await new Promise<Blob>((r) =>
  canvas.toBlob((b) => r(b!), "image/png"),
);
const media = {
  limits: async () => VISUAL_LIMITS,
  upload: async (_w: string, _e: string, f: File) => {
    attempts.push(f.name);
    if (f.name === "2.png" && fail) {
      fail = false;
      throw Error("Rede indisponível");
    }
    const a = {
      id: crypto.randomUUID(),
      filename: f.name,
      mime: f.type,
      bytes: f.size,
      width: 80,
      height: 120,
    };
    assets.set(a.id, a);
    return a;
  },
  read: async () => png,
  cleanup: async () => 0,
};
const repository = {
  list: async () => [stored],
  saveVisual: async (_w: any, _e: any, _r: any, input: any) => {
    if (conflict)
      throw Error("Conflito de revisão. Recupera a versão guardada.");
    stored = {
      ...stored,
      revision: stored.revision! + 1,
      visualSettings: input.settings,
      chapters: [
        {
          ...stored.chapters[0],
          title: input.title,
          content: input.script,
          revision: stored.chapters[0].revision! + 1,
          visualPages: input.pages.map((p: any, i: number) => ({
            id: p.id,
            position: i + 1,
            asset: assets.get(p.assetId),
          })),
        },
      ],
    };
    return structuredClone(stored);
  },
} as unknown as WorksRepository;
async function mount() {
  controller = new WorksController(repository);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <RemoteWorksProvider key={crypto.randomUUID()} controller={controller}>
          <VisualChapterEditor
            work={structuredClone(stored)}
            entry={structuredClone(stored.chapters[0])}
            media={media as any}
          />
        </RemoteWorksProvider>
      </MemoryRouter>,
    );
    await pause();
  });
}
async function click(text: string) {
  const b = Array.from(fixture.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  check(b, `Botão ausente: ${text}`);
  for (let i = 0; b!.matches(":disabled") && i < 50; i++)
    await act(async () => {
      await pause();
    });
  check(!b!.matches(":disabled"), `Botão desativado: ${text}`);
  await act(async () => {
    b!.click();
    await pause();
    await pause();
  });
}
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
await mount();
await run("Seleção múltipla não envia nem altera guião antigo", async () => {
  const input = fixture.querySelector<HTMLInputElement>("input[multiple]")!;
  check(!input.disabled, "Limites não carregados");
  Object.defineProperty(input, "files", {
    value: [
      new File([png], "10.png", { type: "image/png" }),
      new File([png], "2.png", { type: "image/png" }),
    ],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await pause();
    await pause();
  });
  check(
    fixture.querySelectorAll(".visual-page-list > li").length === 2,
    "Sequência incompleta",
  );
  check(attempts.length === 0, "Envio automático");
  check(stored.chapters[0].content === "Guião preservado", "Guião alterado");
});
await run(
  "Falha parcial mantém sucesso e repetição envia apenas falhada",
  async () => {
    await click("Enviar pendentes / repetir falhadas");
    check(fixture.textContent?.includes("Rede indisponível"), "Erro oculto");
    await click("Enviar pendentes / repetir falhadas");
    check(attempts.join(",") === "10.png,2.png,2.png", "Reenvio incorreto");
    check(!stored.chapters[0].visualPages, "Associação prematura");
  },
);
await run(
  "Reordenar por botão, guardar e reabrir recupera ordem e preferências",
  async () => {
    await act(async () => {
      fixture
        .querySelector<HTMLButtonElement>('[aria-label="Subir imagem 2"]')!
        .click();
      await pause();
    });
    await click("Guardar capítulo");
    check(
      stored.chapters[0].visualPages?.[0].asset.filename === "2.png",
      "Ordem não persistida",
    );
    check(stored.visualSettings?.direction === "rtl", "Direção perdida");
    check(
      stored.chapters[0].title === "Ato antigo" &&
        stored.chapters[0].content === "Guião preservado",
      "Legado alterado",
    );
    await mount();
    check(
      fixture.querySelectorAll(".visual-page-list > li").length === 2,
      "Recuperação falhou",
    );
  },
);
await run("Pré-visualização privada e Webtoon vertical sem corte", async () => {
  await click("Pré-visualizar");
  check(
    fixture.querySelector('[aria-label="Pré-visualização privada"]'),
    "Preview ausente",
  );
  const select = Array.from(fixture.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "webtoon"),
  )!;
  await act(async () => {
    select.value = "webtoon";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await pause();
  });
  check(
    fixture.textContent?.includes("Guardar episódio"),
    "Terminologia errada",
  );
  check(
    fixture.querySelector('[id="visual-preview-0"]'),
    "Preview vertical ausente",
  );
});
await run(
  "Conflito visível preserva sequência e não anuncia sucesso",
  async () => {
    conflict = true;
    await click("Guardar episódio");
    check(
      fixture.textContent?.includes("Conflito de revisão"),
      "Conflito oculto",
    );
    check(
      stored.visualSettings?.format === "manga",
      "Conflito sobrescreveu servidor",
    );
    check(
      fixture.querySelectorAll(".visual-page-list > li").length === 2,
      "Perda local",
    );
    conflict = false;
  },
);
async function viewport(width: number) {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    const done = (e: Event) => {
      if ((e as CustomEvent).detail === id) {
        window.removeEventListener("test-driver-done", done);
        resolve();
      }
    };
    window.addEventListener("test-driver-done", done);
    (window as any).testDriver(JSON.stringify({ kind: "viewport", width, id }));
  });
}
for (const theme of ["light", "dark"])
  for (const width of [360, 1280])
    await run(
      `Layout ${theme} ${width}px com controlos por teclado`,
      async () => {
        await viewport(width);
        document.documentElement.dataset.theme = theme;
        await pause();
        check(
          document.documentElement.scrollWidth <= innerWidth + 1,
          "Overflow horizontal",
        );
        const b = fixture.querySelector<HTMLButtonElement>(
          '[aria-label="Subir imagem 2"]',
        )!;
        b.focus();
        check(document.activeElement === b, "Foco inacessível");
        check(
          fixture.querySelector("details.visual-chapter-nav"),
          "Navegação não recolhível",
        );
      },
    );
await act(async () => root.unmount());
document.getElementById("results")!.textContent = JSON.stringify(
  results,
  null,
  2,
);
document.documentElement.dataset.tests = results.every((r) => r.ok)
  ? "passed"
  : "failed";
