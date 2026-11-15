import { AuthProvider } from "../src/foundation/features/auth/AuthProvider";
import { initialAuthState } from "../src/foundation/features/auth/controller";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  ReadingContext,
  ReadingProvider,
  useReadingSync,
  ReadingSession,
  ChapterReadingIndicator,
} from "../src/foundation/features/library/ReadingProvider";
import { AdvancedLibrary } from "../src/foundation/features/library/AdvancedLibrary";
import { ReadingSync } from "../src/foundation/features/library/syncEngine";
import { ReadingError } from "../src/foundation/features/library/syncRepository";
import {
  putPoint,
  point,
  captureReading,
  connectReading,
  clearPoints,
} from "../src/foundation/features/library/readingCache";
import { selectScope } from "../src/foundation/features/local/persistence";
import { ProseReader } from "../src/foundation/features/reader/ProseReader";
import { PoetryReader } from "../src/foundation/features/reader/PoetryReader";
import { PublicVisualReader } from "../src/foundation/features/visual/PublicVisualReader";
import type { PublishedWork } from "../src/foundation/features/catalog/repository";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
const id = "10000000-0000-4000-8000-000000000001",
  entry = "20000000-0000-4000-8000-000000000001";
const work = {
  id,
  title: "Obra do teste",
  author: "Autora",
  format: "Romance",
  lastPublishedAt: "2026-11-15T12:00:00Z",
  chapters: [
    {
      id: entry,
      title: "Capítulo",
      number: 1,
      content: "Um parágrafo de leitura.\n\nOutro parágrafo.",
    },
  ],
} as PublishedWork;
let calls: any[] = [],
  fail = false,
  items: any[] = [],
  lists: any[] = [];
const repo = {
  async call(action: string, data: any = {}, operation?: string): Promise<any> {
    calls.push({ action, data, operation });
    if (fail) throw new ReadingError("Falha de rede do teste");
    if (action === "library" || action === "history") return items;
    if (action === "lists") return lists;
    if (action === "list") {
      const l = lists.find((l) => l.id === data.id);
      if (!l) throw Error("Lista indisponível");
      return structuredClone(l);
    }
    if (action === "work")
      return { generation: 0, revision: 0, state: null, entries: [] };
    if (action === "settings")
      return { sync: true, history: true, revision: 1, epoch: 1 };
    if (
      [
        "forget_history",
        "clear_history",
        "clear_all",
        "remove_completed",
      ].includes(action)
    )
      return { sync: false, history: false, revision: 2, epoch: 2 };
    if (action === "save_settings") return { ...data, revision: 2, epoch: 2 };
    if (action === "save_list") {
      const l = {
        ...data,
        id: data.id ?? "new-list",
        revision: 2,
        items: (data.items ?? []).map((id: string, position: number) => ({
          id,
          position,
          title: id,
          available: true,
        })),
      };
      lists = [l];
      return l;
    }
    if (action === "progress" || action === "complete")
      return {
        publication_id: data.work,
        entry_id: data.entry,
        revision: 1,
        position: data.position,
        locator: data.locator,
        completed: data.completed ?? false,
        edition: work.lastPublishedAt,
      };
    return { ok: true };
  },
};
let engine = new ReadingSync("browser-initial", repo as any);
const check = (v: unknown, m: string) => {
  if (!v) throw Error(m);
};
const wait = (n = 60) => new Promise((r) => setTimeout(r, n));
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
function button(text: string) {
  const e = [...fixture.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!e) throw Error("Botão ausente: " + text);
  return e;
}
function field(text: string) {
  const e = [...fixture.querySelectorAll("label")]
    .find((l) => l.textContent?.trim().startsWith(text))
    ?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea");
  if (!e) throw Error("Campo ausente: " + text);
  return e;
}
async function click(e: HTMLElement) {
  await act(async () => {
    e.click();
    await wait();
  });
}
async function set(
  e: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  v: string,
) {
  await act(async () => {
    const proto =
      e instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : e instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(e, v);
    e.dispatchEvent(
      new Event(e instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await wait(260);
  });
}
async function mount(path = "/biblioteca", child?: React.ReactNode) {
  await act(async () =>
    root.render(
      <MemoryRouter key={path + Math.random()} initialEntries={[path]}>
        <ReadingContext.Provider value={engine}>
          <Routes>
            <Route path="*" element={child ?? <AdvancedLibrary />} />
            <Route
              path="/biblioteca/listas/:id"
              element={<AdvancedLibrary />}
            />
          </Routes>
        </ReadingContext.Provider>
      </MemoryRouter>,
    ),
  );
  await act(async () => {
    await wait(300);
  });
}
async function reset() {
  await act(async () => root.render(null));
  localStorage.removeItem("ag:reading:queue:v1:browser");
  engine?.dispose();
  selectScope("user:browser");
  engine = new ReadingSync("browser", repo as any);
  engine.settings = { sync: false, history: false, epoch: 1, revision: 1 };
  engine.ready = true;
  calls = [];
  items = [];
  lists = [];
  fail = false;
  clearPoints(undefined, "user:browser");
}
window.confirm = () => true;
await run("Biblioteca vazia real, navegação e privacidade", async () => {
  await reset();
  await mount();
  check(
    fixture.textContent?.includes("Ainda não existem itens"),
    "vazio ausente",
  );
  check(fixture.textContent?.includes("Listas privadas"), "rotas ausentes");
  check(
    !calls.some((c) => ["progress", "visit"].includes(c.action)),
    "importação/gravação sem leitura",
  );
});
await run("Filtros e ordenação enviados ao servidor", async () => {
  await reset();
  await mount();
  await set(field("Pesquisar"), "História");
  await set(field("Ordenar"), "title");
  await set(field("Organização"), "following");
  const call = calls.filter((c) => c.action === "library").at(-1);
  check(
    call.data.q === "História" &&
      call.data.sort === "title" &&
      call.data.filter === "following",
    "filtros não aplicados",
  );
});
await run("Obra retirada nunca oferece conteúdo privado", async () => {
  await reset();
  items = [
    {
      id,
      available: false,
      title: null,
      author: null,
      format: null,
      genre: null,
      state: null,
      revision: 0,
      generation: 0,
    },
  ];
  await mount();
  check(
    fixture.textContent?.includes("Obra indisponível"),
    "indisponível ausente",
  );
  check(
    ![...fixture.querySelectorAll("a")].some((a) =>
      a.href.includes("/capitulos/"),
    ),
    "retoma privada exposta",
  );
});
await run(
  "Histórico aponta para capítulos públicos e permite remoção explícita",
  async () => {
    await reset();
    items = [
      {
        id,
        entry_id: entry,
        title: "Obra",
        chapter: "Capítulo",
        available: true,
        seen_at: "2026-11-15T12:00:00Z",
        completed: false,
      },
    ];
    await mount("/biblioteca/historico");
    check(
      !!fixture.querySelector(`a[href="/obras/${id}/capitulos/${entry}"]`),
      "link ausente",
    );
    await click(button("Remover do histórico"));
    check(
      calls.some(
        (c) => c.action === "forget_history" && c.data.entry === entry,
      ),
      "remoção não enviada",
    );
  },
);
await run(
  "Criar lista privada só depois de guardar; erro preserva texto",
  async () => {
    await reset();
    await mount("/biblioteca/listas");
    await set(field("Nome"), "Minha lista");
    await set(field("Descrição"), "Descrição própria");
    fail = true;
    await click(button("Guardar lista"));
    check(field("Nome").value === "Minha lista", "texto perdido");
    check(fixture.textContent?.includes("Falha de rede"), "erro invisível");
    fail = false;
    await click(button("Guardar lista"));
    const writes = calls.filter((c) => c.action === "save_list");
    check(
      writes.length === 2 && writes[0].operation === writes[1].operation,
      "repetição sem idempotência",
    );
  },
);
await run("Reordenar lista usa revisão e preserva conjunto único", async () => {
  await reset();
  lists = [
    {
      id: "one",
      name: "Lista",
      description: "Privada",
      revision: 5,
      created_at: "2026-11-15",
      updated_at: "2026-11-15",
      items: [
        { id, title: "Primeira", available: true },
        { id: "second", title: "Segunda", available: true },
      ],
    },
  ];
  await mount("/biblioteca/listas/one");
  await click(button("Descer"));
  const write = calls.find((c) => c.action === "save_list");
  check(
    write.data.revision === 5 &&
      write.data.items[0] === "second" &&
      write.data.items[1] === id,
    "ordem/revisão incorreta",
  );
});
await run(
  "Ativar sincronização é explícito e não importa posições antigas",
  async () => {
    await reset();
    putPoint(
      {
        work: id,
        entry,
        position: 0.7,
        locator: { kind: "prose" },
        time: new Date().toISOString(),
      },
      "guest",
    );
    await mount();
    await click(fixture.querySelector("summary")!);
    await click(field("Sincronizar progresso"));
    check(
      calls.some((c) => c.action === "save_settings" && c.data.sync),
      "preferência não guardada",
    );
    check(
      !calls.some((c) => c.action === "progress"),
      "progresso importado automaticamente",
    );
  },
);
await run("Prosa recupera posição antes de apresentar o leitor", async () => {
  await reset();
  engine.settings!.sync = true;
  engine.works.set(id, {
    generation: 0,
    revision: 1,
    state: "reading",
    entries: [],
  });
  putPoint({
    work: id,
    entry,
    position: 0.4,
    locator: { kind: "prose", block: 1, offset: 0.2 },
    time: new Date().toISOString(),
  });
  await mount(
    "/leitor",
    <ReadingSession work={work} chapter={entry}>
      <ProseReader
        workId={id}
        workTitle={work.title}
        author={work.author}
        chapters={work.chapters}
        currentChapter={work.chapters[0]}
        trackProgress
      />
    </ReadingSession>,
  );
  check(!!fixture.querySelector("h1"), "leitor não apresentado");
  check(point(id, entry)?.locator.block === 1, "âncora perdida ao abrir");
});
await run(
  "Poema preserva estrutura e marcação manual de conclusão",
  async () => {
    await reset();
    const poetry = {
      ...work,
      format: "Poesia",
      chapters: [
        {
          ...work.chapters[0],
          content: "Primeiro verso\nSegundo verso\n\nOutra estrofe",
        },
      ],
    } as PublishedWork;
    await mount(
      "/poema",
      <ReadingSession work={poetry} chapter={entry}>
        <PoetryReader
          workId={id}
          workTitle={work.title}
          author={work.author}
          chapters={poetry.chapters}
          currentChapter={poetry.chapters[0]}
          trackProgress
        />
      </ReadingSession>,
    );
    check(fixture.textContent?.includes("Segundo verso"), "poema perdido");
    engine.settings!.sync = true;
    await act(async () => engine.emit());
    await click(button("Marcar capítulo como concluído"));
    check(point(id, entry)?.completed, "conclusão não marcada");
    await click(button("Remover marca de concluído"));
    check(!point(id, entry)?.completed, "conclusão não removida");
  },
);
await run(
  "Leitor anónimo continua com posições separadas por capítulo",
  async () => {
    await reset();
    selectScope("guest");
    const off = connectReading((p, s) => engine.record(p, s));
    captureReading({
      work: id,
      entry,
      position: 0.2,
      locator: { kind: "manga", page: 1, direction: "rtl" },
      time: new Date().toISOString(),
    });
    captureReading({
      work: id,
      entry: "other",
      position: 0.8,
      locator: { kind: "webtoon", page: 4, offset: 0.2, vertical: true },
      time: new Date().toISOString(),
    });
    off();
    check(engine.pending.length === 0, "anónimo enviado para conta");
    check(
      point(id, entry)?.locator.direction === "rtl" &&
        point(id, "other")?.position === 0.8,
      "capítulos misturados",
    );
  },
);
await run("Mangá público recupera página e direção RTL", async () => {
  await reset();
  putPoint({
    work: id,
    entry,
    position: 0.5,
    locator: { kind: "manga", page: 1, direction: "rtl" },
    time: new Date().toISOString(),
  });
  const visual = {
    ...work,
    format: "Mangá",
    hasVisualPublication: true,
    visualSettings: { format: "manga", mode: "paged", direction: "rtl" },
    chapters: [{ ...work.chapters[0], publicVisualPageCount: 3 }],
  } as PublishedWork;
  const repository = {
    pages: async () => ({
      total: 3,
      items: [1, 2, 3].map((n) => ({
        id: `page-${n}`,
        position: n,
        width: 100,
        height: 150,
      })),
    }),
  };
  await mount(
    "/manga",
    <PublicVisualReader
      work={visual}
      chapter={visual.chapters[0]}
      repository={repository as any}
      imageUrl={() =>
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="150"/%3E'
      }
    />,
  );
  check(fixture.textContent?.includes("Página 2 de 3"), "página não retomada");
  check(
    !!fixture.querySelector('select option[value="rtl"]:checked'),
    "direção não retomada",
  );
});
await run(
  "Webtoon recupera a página vertical e guarda deslocamento aproximado",
  async () => {
    await reset();
    putPoint({
      work: id,
      entry,
      position: 0.5,
      locator: {
        kind: "webtoon",
        page: 2,
        offset: 0.2,
        vertical: true,
        direction: "ltr",
      },
      time: new Date().toISOString(),
    });
    const visual = {
      ...work,
      format: "HQ / Comic",
      hasVisualPublication: true,
      visualSettings: { format: "webtoon", mode: "vertical", direction: "ltr" },
      chapters: [{ ...work.chapters[0], publicVisualPageCount: 4 }],
    } as PublishedWork;
    const repository = {
      pages: async () => ({
        total: 4,
        items: [1, 2, 3, 4].map((n) => ({
          id: `page-${n}`,
          position: n,
          width: 100,
          height: 800,
        })),
      }),
    };
    await mount(
      "/webtoon",
      <PublicVisualReader
        work={visual}
        chapter={visual.chapters[0]}
        repository={repository as any}
        imageUrl={() =>
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="800"/%3E'
        }
      />,
    );
    await act(async () => {
      await wait(350);
    });
    check(
      fixture.querySelector('select option[value="vertical"]:checked'),
      "modo vertical não retomado",
    );
    check(
      point(id, entry)?.locator.kind === "webtoon",
      "localizador incorreto",
    );
    check(
      (point(id, entry)?.locator.page ?? 0) >= 2,
      "página de retoma perdida",
    );
  },
);
function LifecycleProbe() {
  const sync = useReadingSync();
  return (
    <p>
      {sync?.active && sync.ready ? "Sincronização preparada" : "A preparar"}
    </p>
  );
}
await run(
  "Provider de produção mantém a sincronização ativa em React StrictMode",
  async () => {
    await reset();
    const snapshot = {
      ...initialAuthState,
      status: "authenticated",
      user: { id: "strict-owner" },
    };
    const controller = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      start: async () => {},
      stop: () => {},
    } as any;
    await act(async () =>
      root.render(
        <React.StrictMode>
          <AuthProvider controller={controller}>
            <ReadingProvider enabled repositoryFactory={() => repo as any}>
              <LifecycleProbe />
            </ReadingProvider>
          </AuthProvider>
        </React.StrictMode>,
      ),
    );
    await act(async () => {
      await wait(100);
    });
    check(
      fixture.textContent?.includes("Sincronização preparada"),
      "provider inativo após cleanup StrictMode",
    );
  },
);
async function driver(request: any) {
  return new Promise<void>((resolve) => {
    const id = crypto.randomUUID();
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
for (const theme of ["light", "dark"])
  for (const width of [360, 1280])
    await run(`Biblioteca ${theme} ${width}px e foco por teclado`, async () => {
      await reset();
      await driver({ kind: "viewport", width });
      document.documentElement.dataset.theme = theme;
      await mount();
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        "deslocamento horizontal",
      );
      field("Pesquisar").focus();
      check(document.activeElement === field("Pesquisar"), "foco indisponível");
    });
engine.dispose();
await act(async () => root.unmount());
document.getElementById("results")!.textContent = JSON.stringify(
  results,
  null,
  2,
);
document.documentElement.dataset.tests = results.every((r) => r.ok)
  ? "passed"
  : "failed";
