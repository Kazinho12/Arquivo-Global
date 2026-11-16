import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../src/foundation/features/auth/AuthProvider";
import { initialAuthState } from "../src/foundation/features/auth/controller";
import {
  Inbox,
  NotificationInbox,
  NotificationCountProvider,
  NotificationHeader,
} from "../src/foundation/features/notifications/Notifications";
import { Analytics } from "../src/foundation/features/notifications/AuthorAnalytics";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = document.getElementById("fixture")!,
  root = createRoot(fixture),
  results: any[] = [];
const user = "10000000-0000-4000-8000-000000000001",
  work = "20000000-0000-4000-8000-000000000001";
const emptyPref = {
  followers: false,
  likes: false,
  comments: false,
  replies: false,
  authors: false,
  works: false,
  official: true,
  revision: 0,
};
let rows: any[] = [],
  prefs = { ...emptyPref },
  calls: any[] = [],
  fail = false,
  days: any[] = [];
const repo: any = {
  async member(action: string, data: any = {}, write = false) {
    calls.push({ action, data, write });
    if (fail) throw Error("Falha de rede de teste");
    if (action === "count")
      return {
        unread: rows.filter((n) => !n.read_at && !n.hidden).length,
        as_of: "2026-11-16T12:00:00Z",
      };
    if (action === "list") {
      let list = rows.filter(
        (n) =>
          !n.hidden &&
          (data.filter === "all" ||
            data.filter === undefined ||
            data.filter === n.kind ||
            data.filter === n.category ||
            (data.filter === "unread" && !n.read_at) ||
            (data.filter === "interactions" &&
              ["likes", "comments", "replies"].includes(n.category))),
      );
      if (data.before_id)
        list = list.slice(list.findIndex((n) => n.id === data.before_id) + 1);
      return list.slice(0, 20).map((n) => ({ ...n }));
    }
    if (action === "preferences") return { ...prefs };
    if (action === "preferences_save") {
      prefs = { ...data, revision: prefs.revision + 1 };
      return { ok: true };
    }
    if (action === "read")
      rows.find((n) => n.id === data.id).read_at = "2026-11-16T12:00:00Z";
    if (action === "read_all")
      rows.forEach((n) => (n.read_at = "2026-11-16T12:00:00Z"));
    if (action === "hide") rows.find((n) => n.id === data.id).hidden = true;
    return { ok: true };
  },
  async analytics(
    action: string,
    selected?: string,
    before?: string,
    period?: number,
  ) {
    calls.push({ action, selected, before, period });
    if (fail) throw Error("Estatísticas indisponíveis");
    if (action === "overview")
      return {
        published: 1,
        writer_followers: 4,
        writer_followers_change: 1,
        as_of: "2026-11-16T12:00:00Z",
        stats_since: "2026-11-16T10:00:00Z",
        partial_period: true,
        totals: {
          views: 123,
          reads: 7,
          likes: 2,
          chapter_likes: 1,
          comments: 3,
          favorites: 2,
          followers: 4,
        },
      };
    if (action === "works")
      return [
        {
          id: work,
          title: "Publicação real de teste",
          is_public: true,
          views: 123,
          reads: 7,
          likes: 2,
          favorites: 2,
          followers: 4,
        },
      ];
    if (action === "daily") return days;
    if (action === "chapters")
      return [
        {
          id: user,
          title: "Capítulo",
          current_entry: true,
          reads: 7,
          likes: 1,
          comments: 3,
        },
      ];
    return [];
  },
};
const notice = (id: string, kind = "social", category = "likes") => ({
  id,
  kind,
  category,
  title: "Aviso de teste",
  body: "Uma interação real de teste.",
  created_at: "2026-11-16T11:00:00Z",
  read_at: null,
  group_count: 1,
  path: "/obras/" + work,
  context: {},
});
function check(v: any, m: string) {
  if (!v) throw Error(m);
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
function button(text: string) {
  const node = [...fixture.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!node) throw Error("Botão não encontrado: " + text);
  return node;
}
function field(text: string) {
  const node = [...fixture.querySelectorAll("label")]
    .find(
      (l) =>
        l.textContent?.startsWith(text) || l.textContent?.trim().endsWith(text),
    )
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input,select");
  if (!node) throw Error("Campo não encontrado: " + text);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => {
    node.click();
    await wait();
  });
}
async function select(node: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
  });
}
async function mount(node: React.ReactNode, owner: string | null = user) {
  const state = {
    ...initialAuthState,
    status: owner ? "authenticated" : "unauthenticated",
    user: owner ? { id: owner } : null,
  };
  const controller = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    start: async () => {},
    stop: () => {},
  } as any;
  await act(async () =>
    root.render(
      <MemoryRouter key={crypto.randomUUID()}>
        <AuthProvider controller={controller}>{node}</AuthProvider>
      </MemoryRouter>,
    ),
  );
  await act(async () => {
    await wait();
  });
}
async function reset() {
  await act(async () => root.render(null));
  rows = [];
  prefs = { ...emptyPref };
  calls = [];
  fail = false;
  days = [];
}
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
await run("Anónimo não consulta caixa privada", async () => {
  await reset();
  await mount(<NotificationInbox repository={repo} />, null);
  check(fixture.textContent?.includes("Inicia sessão"), "login ausente");
  check(calls.length === 0, "consulta anónima");
});
await run("Vazio real e preferências oficiais preservadas", async () => {
  await reset();
  await mount(<Inbox owner={user} repository={repo} />);
  check(
    fixture.textContent?.includes("Ainda não há notificações"),
    "vazio ausente",
  );
  check(
    (field("Comunicados oficiais opcionais") as HTMLInputElement).checked,
    "preferência F5.2 perdida",
  );
});
await run("Filtros não lidas e mensagens de serviço", async () => {
  await reset();
  rows = [notice("one"), notice("two", "service")];
  await mount(<Inbox owner={user} repository={repo} />);
  await select(field("Mostrar") as HTMLSelectElement, "service");
  check(
    calls.some((c) => c.action === "list" && c.data.filter === "service"),
    "filtro ausente",
  );
  check(
    fixture.querySelectorAll(".center-list li").length === 1,
    "filtro não aplicado",
  );
});
await run("Ler, marcar todas e ocultar com ACK", async () => {
  await reset();
  rows = [notice("one"), notice("two")];
  await mount(<Inbox owner={user} repository={repo} />);
  await click(button("Marcar como lida"));
  check(rows[0].read_at, "leitura não guardada");
  await click(button("Marcar todas como lidas"));
  check(
    rows.every((r) => r.read_at),
    "marcar todas falhou",
  );
  await click(button("Ocultar notificação"));
  check(rows[0].hidden, "ocultação falhou");
});
await run("Preferência social só persiste ao guardar", async () => {
  await reset();
  await mount(<Inbox owner={user} repository={repo} />);
  await click(fixture.querySelector("summary")!);
  await click(field("Novos seguidores"));
  check(
    !calls.some((c) => c.action === "preferences_save"),
    "guardou sem confirmação",
  );
  await click(button("Guardar preferências"));
  check(prefs.followers, "preferência não persistida");
});
await run("Falha de rede conserva preferências selecionadas", async () => {
  await reset();
  await mount(<Inbox owner={user} repository={repo} />);
  await click(fixture.querySelector("summary")!);
  await click(field("Curtidas"));
  fail = true;
  await click(button("Guardar preferências"));
  check((field("Curtidas") as HTMLInputElement).checked, "rascunho perdido");
  check(fixture.textContent?.includes("Falha de rede"), "erro oculto");
});
await run(
  "Conteúdo retirado não mantém ligação e texto é escapado",
  async () => {
    await reset();
    rows = [
      { ...notice("one"), path: null, body: "<img src=x onerror=alert(1)>" },
      {
        ...notice("two", "official"),
        body: "<script>window.xss=true</script>",
        path: null,
      },
    ];
    await mount(<Inbox owner={user} repository={repo} />);
    check(!fixture.querySelector("script,img"), "HTML executável");
    check(
      ![...fixture.querySelectorAll("a")].some(
        (a) => a.textContent === "Abrir contexto",
      ),
      "link retirado",
    );
    check(
      fixture.textContent?.includes("deixou") ||
        fixture.textContent?.includes("já não está disponível"),
      "indisponível ausente",
    );
  },
);
await run("Paginação mantém os avisos existentes", async () => {
  await reset();
  rows = Array.from({ length: 22 }, (_, i) => notice("n-" + i));
  await mount(<Inbox owner={user} repository={repo} />);
  check(
    fixture.querySelectorAll(".center-list li").length === 20,
    "página inicial",
  );
  await click(button("Carregar mais notificações"));
  check(
    fixture.querySelectorAll(".center-list li").length === 22,
    "paginação perdeu linhas",
  );
});
await run("Cabeçalho consulta apenas contador agregado", async () => {
  await reset();
  rows = [notice("one"), notice("two")];
  await mount(
    <NotificationCountProvider enabled repositoryFactory={() => repo}>
      <NotificationHeader enabled />
    </NotificationCountProvider>,
  );
  check(
    !!fixture.querySelector('a[aria-label="Notificações: 2 não lidas"]'),
    "contador ausente",
  );
  check(
    calls.every((c) => c.action === "count"),
    "histórico descarregado no cabeçalho",
  );
});
await run("Troca de conta limpa avisos anteriores", async () => {
  await reset();
  rows = [notice("private-A")];
  await mount(<Inbox key={user} owner={user} repository={repo} />);
  rows = [];
  await mount(<Inbox key="B" owner="B" repository={repo} />, work);
  check(!fixture.querySelector(".center-list li"), "aviso de A em B");
});
await run("Estatísticas acumuladas e ausência histórica honestas", async () => {
  await reset();
  await mount(<Analytics owner={user} repository={repo} />);
  check(fixture.textContent?.includes("123"), "acumulado ausente");
  check(
    fixture.textContent?.includes("passado não foi reconstruído"),
    "limitação ausente",
  );
  check(
    fixture.textContent?.includes("Ainda não há eventos agregados"),
    "histórico inventado",
  );
  check(!fixture.querySelector("svg.analytics-chart"), "gráfico fictício");
});
await run(
  "Filtros de obra, capítulos e gráfico com tabela acessível",
  async () => {
    await reset();
    days = [
      {
        day: "2026-11-16",
        views: 2,
        reads: 3,
        likes_change: 1,
        comments_change: 0,
        favorites_change: 0,
        followers_change: 1,
      },
    ];
    await mount(<Analytics owner={user} repository={repo} />);
    await select(field("Obra") as HTMLSelectElement, work);
    check(
      calls.some((c) => c.action === "chapters" && c.selected === work),
      "capítulos ausentes",
    );
    check(
      !!fixture.querySelector('svg[role="img"] title'),
      "gráfico sem alternativa",
    );
    check(
      fixture.querySelector("caption")?.textContent?.includes("observados"),
      "tabela alternativa ausente",
    );
  },
);
await run(
  "Falha inicial das preferências permite recuperação sem perder a sessão",
  async () => {
    await reset();
    fail = true;
    await mount(<Inbox owner={user} repository={repo} />);
    check(
      fixture.textContent?.includes("Falha de rede"),
      "erro inicial ausente",
    );
    fail = false;
    await click(fixture.querySelector("summary")!);
    await click(button("Recarregar preferências da conta"));
    check(!!field("Novos seguidores"), "preferências não recuperadas");
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
for (const theme of ["light", "dark"])
  for (const width of [360, 1280])
    await run(`Notificações e estatísticas ${theme} ${width}px`, async () => {
      await reset();
      document.documentElement.dataset.theme = theme;
      await driver({ kind: "viewport", width });
      await mount(<Analytics owner={user} repository={repo} />);
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        "overflow estatísticas",
      );
      await mount(<Inbox owner={user} repository={repo} />);
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        "overflow notificações",
      );
      button("Atualizar").focus();
      check(document.activeElement === button("Atualizar"), "foco ausente");
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
