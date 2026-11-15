import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../src/foundation/features/auth/AuthProvider";
import { initialAuthState } from "../src/foundation/features/auth/controller";
import { SocialPanel } from "../src/foundation/features/social/SocialPanel";
import { ReadingMetric } from "../src/foundation/features/social/metrics";
import { AuthorFollow } from "../src/foundation/features/social/AuthorFollow";
import { SocialLibrary } from "../src/foundation/features/social/SocialLibrary";
import {
  createSocialRepository,
  type SocialComment,
  type SocialState,
} from "../src/foundation/features/social/repository";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
const work = "10000000-0000-4000-8000-000000000001",
  user = "20000000-0000-4000-8000-000000000002",
  author = "30000000-0000-4000-8000-000000000003";
let state: SocialState,
  comments: SocialComment[],
  calls: any[],
  failure = false,
  delay: Promise<void> | null = null,
  readsFail = false;
function reset() {
  state = {
    likes: 0,
    comments: 0,
    followers: 0,
    views: 0,
    visitors: 0,
    liked: false,
    following: false,
    saved: false,
    favorite: false,
    later: false,
    can_moderate: false,
  };
  comments = [];
  calls = [];
  failure = false;
  delay = null;
  readsFail = false;
}
const repo = {
  ...createSocialRepository(null),
  state: async () => {
    if (readsFail) throw Error("Falha ao atualizar");
    return { ...state };
  },
  comments: async (_w: string, _e?: string, before?: SocialComment) =>
    before ? [] : comments.map((c) => ({ ...c })),
  mutate: async (
    _w: string,
    _e: string | undefined,
    action: string,
    payload: any,
  ) => {
    calls.push({ action, payload });
    if (delay) await delay;
    if (failure) throw Error("Falha de rede de teste");
    if (action === "like") {
      state.liked = payload.value;
      state.likes = payload.value ? 1 : 0;
    }
    if (action === "favorite") state.favorite = payload.value;
    if (action === "saved") state.saved = payload.value;
    if (action === "comment") {
      comments.unshift({
        id: crypto.randomUUID(),
        parent_id: payload.parent_id ?? null,
        body: payload.body,
        created_at: new Date().toISOString(),
        edited_at: null,
        status: "visible",
        author_name: "Autora",
        author_username: "autora",
        own: true,
        likes: 0,
        liked: false,
      });
      state.comments++;
    }
    if (action === "edit_comment") {
      comments.find((c) => c.id === payload.comment_id)!.body = payload.body;
    }
    if (action === "delete_comment") {
      const c = comments.find((c) => c.id === payload.comment_id)!;
      c.status = "deleted";
      c.body = "";
      state.comments--;
    }
    return { ok: true };
  },
  author: async () => ({ followers: 0, followed: 0, following: false }),
  followAuthor: async (_id: string, value: boolean) => {
    calls.push({ action: "author", value });
    return { followers: value ? 1 : 0, followed: 0, following: value };
  },
  library: async () => [
    {
      id: work,
      title: "Obra guardada",
      format: "Mangá",
      available: true,
      saved: true,
      favorite: false,
      later: false,
      updated_at: new Date().toISOString(),
    },
  ],
  removeLibrary: async (id: string, field?: string) => {
    calls.push({ action: "remove_library", id, field });
  },
};
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function mount(
  kind: "panel" | "author" | "library" = "panel",
  authenticated = true,
  id = author,
) {
  const snapshot = {
    ...initialAuthState,
    status: authenticated ? "authenticated" : "unauthenticated",
    user: authenticated ? { id: user } : null,
  };
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    start: async () => {},
    stop: () => {},
  } as any;
  await act(async () => {
    root.render(
      <MemoryRouter key={crypto.randomUUID()}>
        <AuthProvider controller={controller}>
          {kind === "panel" ? (
            <SocialPanel workId={work} enabled repository={repo} />
          ) : kind === "author" ? (
            <AuthorFollow id={id} enabled repository={repo} />
          ) : (
            <SocialLibrary enabled repository={repo} />
          )}
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  await settle();
}
const check = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
const button = (text: string) =>
  Array.from(fixture.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
async function click(text: string) {
  check(button(text), "Botão não encontrado: " + text);
  await act(async () => button(text).click());
  await settle();
}
async function text(value: string) {
  const input = fixture.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    fixture
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
}
async function run(name: string, fn: () => Promise<void>) {
  try {
    reset();
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: (e as Error).message });
  }
}
await run("Anónimo lê contagens/comentários e não pode escrever", async () => {
  await mount("panel", false);
  check(button("Curtir").disabled, "anónimo não bloqueado");
  check(fixture.textContent?.includes("Inicia sessão"), "sem convite de login");
  check(calls.length === 0, "operação inesperada");
});
await run(
  "Curtir otimista, duplo clique bloqueado e rollback de rede",
  async () => {
    await mount();
    let release!: () => void;
    delay = new Promise<void>((r) => (release = r));
    await act(async () => {
      button("Curtir").click();
      button("Curtir").click();
    });
    check(calls.length === 1, "duplo clique duplicou");
    check(button("Retirar curtida").disabled, "pedido não bloqueado");
    failure = true;
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await settle();
    check(
      button("Curtir").getAttribute("aria-pressed") === "false",
      "rollback ausente",
    );
    check(
      fixture
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Falha de rede"),
      "erro invisível",
    );
  },
);
await run("Favoritar e guardar são distintos", async () => {
  await mount();
  await click("Favoritar");
  check(state.favorite && !state.saved, "favorito confundido com guardado");
  await click("Guardar na biblioteca");
  check(state.favorite && state.saved, "guardar perdeu favorito");
});
await run(
  "Criar, responder, editar e remover comentário com confirmação",
  async () => {
    await mount();
    await text("Primeiro comentário");
    await submit();
    check(comments.length === 1, "não criou comentário");
    await click("Responder");
    await text("Resposta");
    await submit();
    check(comments[0].parent_id === comments[1].id, "resposta sem pai");
    await act(async () => {
      Array.from(fixture.querySelectorAll("button"))
        .find((b) => b.textContent === "Editar")!
        .click();
    });
    await text("Resposta editada");
    await submit();
    check(comments[0].body === "Resposta editada", "não editou");
    const original = window.confirm;
    window.confirm = () => false;
    await click("Eliminar comentário");
    check(comments[0].status === "visible", "cancelar eliminou");
    window.confirm = () => true;
    await click("Eliminar comentário");
    window.confirm = original;
    check(comments[0].status === "deleted", "não eliminou");
    check(
      fixture.textContent?.includes("Comentário removido."),
      "sem estado removido",
    );
  },
);
await run(
  "ACK de comentário não é perdido quando falha a atualização",
  async () => {
    await mount();
    const mutate = repo.mutate;
    repo.mutate = async (...args) => {
      const result = await mutate(...args);
      readsFail = true;
      return result;
    };
    await text("Confirmado");
    await submit();
    check(
      (fixture.querySelector("textarea") as HTMLTextAreaElement).value === "",
      "comentário confirmado continuou pronto para reenviar",
    );
    check(
      fixture.textContent?.includes("Operação confirmada"),
      "ACK não indicado",
    );
    repo.mutate = mutate;
  },
);
await run("Seguir escritor e bloquear auto-seguimento", async () => {
  await mount("author");
  await click("Seguir escritor");
  check(button("Deixar de seguir escritor"), "estado não atualizado");
  await click("Deixar de seguir escritor");
  await mount("author", true, user);
  check(!button("Seguir escritor"), "auto-seguimento exposto");
});
await run(
  "Biblioteca da conta lista itens reais e mantém significado de favorito",
  async () => {
    await mount("library");
    check(fixture.textContent?.includes("Obra guardada"), "item ausente");
    check(!fixture.textContent?.includes("Favorita"), "favorito inventado");
    await click("Remover guardado");
    check(
      calls.some((c) => c.action === "remove_library" && c.field === "saved"),
      "remoção incorreta",
    );
  },
);
await run(
  "Texto malicioso é apresentado como texto, sem execução",
  async () => {
    comments = [
      {
        id: crypto.randomUUID(),
        parent_id: null,
        body: '<img src=x onerror="window.__socialXss=true">',
        created_at: new Date().toISOString(),
        edited_at: null,
        status: "visible",
        author_name: "Autora",
        author_username: "autora",
        own: false,
        likes: 0,
        liked: false,
      },
    ];
    await mount();
    check(!fixture.querySelector("img"), "HTML executável inserido");
    check(!(window as any).__socialXss, "XSS executado");
  },
);

await run("Denúncia confirma envio sem expor dados internos", async () => {
  comments = [
    {
      id: crypto.randomUUID(),
      parent_id: null,
      body: "Comentário a denunciar",
      created_at: new Date().toISOString(),
      edited_at: null,
      status: "visible",
      author_name: "Autora",
      author_username: "autora",
      own: false,
      likes: 0,
      liked: false,
    },
  ];
  await mount();
  const original = window.prompt;
  window.prompt = () => "Motivo de teste";
  try {
    await click("Denunciar");
    check(
      calls.some(
        (c) => c.action === "report" && c.payload.reason === "Motivo de teste",
      ),
      "denúncia não enviada",
    );
    check(
      fixture.textContent?.includes("Denúncia enviada para análise."),
      "sem confirmação",
    );
  } finally {
    window.prompt = original;
  }
});
await run(
  "Autor pode remover comentário ocultado sem expor o texto",
  async () => {
    comments = [
      {
        id: crypto.randomUUID(),
        parent_id: null,
        body: "",
        created_at: new Date().toISOString(),
        edited_at: null,
        status: "hidden",
        author_name: "Autora",
        author_username: "autora",
        own: true,
        likes: 0,
        liked: false,
      },
    ];
    await mount();
    const original = window.confirm;
    window.confirm = () => true;
    try {
      await click("Eliminar comentário");
      check(comments[0].status === "deleted", "remoção de ocultado falhou");
    } finally {
      window.confirm = original;
    }
  },
);
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
await run(
  "Métricas: sem pré-carga, exige interação real e tempo visível; apenas um envio",
  async () => {
    const originalInterval = window.setInterval,
      originalClear = window.clearInterval,
      originalFetch = window.fetch;
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now"),
      visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let now = 0,
      tick = () => {},
      visible = "visible",
      sent = 0;
    localStorage.setItem("ag_social_metrics_optin_v1", "true");
    window.setInterval = ((fn: () => void) => {
      tick = fn;
      return 12345;
    }) as any;
    window.clearInterval = ((id: number) => {
      if (id !== 12345) originalClear(id);
    }) as any;
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => now,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visible,
    });
    window.fetch = async (_url, init) => {
      check(JSON.parse(String(init?.body)).work === work, "alvo errado");
      sent++;
      return Response.json({ counted: true });
    };
    const advance = async (n: number) => {
      await act(async () => {
        for (let i = 0; i < n; i++) {
          now += 1000;
          tick();
        }
        await Promise.resolve();
      });
    };
    try {
      await act(async () =>
        root.render(
          <ReadingMetric workId={work} entryId={author} onCount={() => {}} />,
        ),
      );
      await advance(25);
      check(sent === 0, "contou sem interação");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      await advance(25);
      check(sent === 0, "evento sintético contou");
      await driver({ kind: "key", key: "Tab" });
      visible = "hidden";
      await advance(25);
      check(sent === 0, "contou em segundo plano");
      visible = "visible";
      await advance(19);
      check(sent === 0, "contou antes do tempo");
      await advance(1);
      check(sent === 1, "não contou leitura qualificada");
      await advance(30);
      check(sent === 1, "duplicou envio");
    } finally {
      await act(async () => root.render(<></>));
      window.setInterval = originalInterval;
      window.clearInterval = originalClear;
      window.fetch = originalFetch;
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else delete (performance as any).now;
      if (visibility)
        Object.defineProperty(document, "visibilityState", visibility);
      else delete (document as any).visibilityState;
      localStorage.removeItem("ag_social_metrics_optin_v1");
    }
  },
);
for (const theme of ["light", "dark"])
  for (const width of [360, 1280])
    await run(`Social responsivo ${theme} ${width}px`, async () => {
      await driver({ kind: "viewport", width });
      document.documentElement.dataset.theme = theme;
      await mount();
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        "deslocamento horizontal",
      );
      const like = button("Curtir");
      like.focus();
      check(document.activeElement === like, "foco indisponível");
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
