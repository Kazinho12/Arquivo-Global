import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../src/foundation/features/auth/AuthProvider";
import { initialAuthState } from "../src/foundation/features/auth/controller";
import AdminPage from "../src/foundation/features/center/AdminPage";
import { MemberCenter } from "../src/foundation/features/center/MemberCenter";
import { PublicCenterPage } from "../src/foundation/features/center/PublicCenter";
import {
  AdminNotFound,
  createCenterRepository,
} from "../src/foundation/features/center/repository";
import "../src/foundation/styles/global.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const root = createRoot(document.getElementById("fixture")!),
  fixture = document.getElementById("fixture")!,
  results: any[] = [];
const adminId = "10000000-0000-4000-8000-000000000001",
  userId = "20000000-0000-4000-8000-000000000002";
let calls: any[] = [],
  items: any[] = [],
  tickets: any[] = [],
  messages: any[] = [],
  notifications: any[] = [],
  official = false,
  fail = false;
const repo = {
  ...createCenterRepository(null),
  member: async (
    action: string,
    data: any = {},
    write = false,
  ): Promise<any> => {
    calls.push({ action, data, write });
    if (fail) throw Error("Falha de rede do centro");
    if (action === "tickets") return tickets.map((t) => ({ ...t }));
    if (action === "messages") return messages.map((m) => ({ ...m }));
    if (action === "reports") return [];
    if (action === "preferences") return { official };
    if (action === "set_preferences") {
      official = data.official;
      return { ok: true };
    }
    if (action === "notifications") return notifications.map((n) => ({ ...n }));
    if (action === "read_notification") {
      notifications.find((n) => n.id === data.id).read_at =
        new Date().toISOString();
      return { ok: true };
    }
    if (action === "create_ticket") {
      const id = crypto.randomUUID();
      tickets.push({
        id,
        title: data.title,
        category: data.category,
        status: "open",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      messages.push({
        id: crypto.randomUUID(),
        body: data.body,
        administrative: false,
        created_at: new Date().toISOString(),
      });
      return { ok: true, id };
    }
    if (action === "reply_ticket") {
      messages.push({
        id: crypto.randomUUID(),
        body: data.body,
        administrative: false,
        created_at: new Date().toISOString(),
      });
      return { ok: true };
    }
    if (action === "report")
      return { ok: true, id: crypto.randomUUID(), source: "center" };
    return { ok: true };
  },
  publicItems: async () => items,
};
let allow = true;
const adminRepo = {
  call: async (action: string, data: any = {}, write = false): Promise<any> => {
    calls.push({ action, data, write });
    if (!allow) throw new AdminNotFound();
    if (fail) throw Error("Falha administrativa");
    if (action === "bootstrap") return { id: adminId, authorized: true };
    if (action === "dashboard")
      return {
        users: 4,
        registrations_7d: 2,
        registrations_30d: 4,
        works: 3,
        publications: 1,
        consented_views: 12,
        chapter_reads: 5,
        likes: 2,
        favorites: 1,
        comments: 1,
        author_follows: 2,
        work_follows: 1,
        open_reports: 1,
        open_tickets: 0,
        as_of: new Date().toISOString(),
      };
    if (action === "reports")
      return [
        {
          id: userId,
          source: "center",
          target_kind: "profile",
          target_id: userId,
          category: "other",
          description: "Pedido de revisão real de teste",
          status: "new",
          revision: 2,
          created_at: new Date().toISOString(),
        },
      ];
    if (action === "items") return items;
    if (action === "save_item") {
      const item = {
        ...data,
        id: data.id ?? crypto.randomUUID(),
        revision: (data.revision ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
      items = [item];
      return { ok: true, id: item.id, revision: item.revision };
    }
    return write ? { ok: true } : [];
  },
};
const wait = () => new Promise((r) => setTimeout(r, 30));
async function settle() {
  await act(async () => {
    await wait();
  });
}
async function mount(
  element: React.ReactNode,
  user: string | null = adminId,
  entry = "/",
) {
  const snapshot = {
    ...initialAuthState,
    status: user ? "authenticated" : "unauthenticated",
    user: user ? { id: user } : null,
  };
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    start: async () => {},
    stop: () => {},
  } as any;
  await act(async () =>
    root.render(
      <MemoryRouter key={crypto.randomUUID()} initialEntries={[entry]}>
        <AuthProvider controller={controller}>{element}</AuthProvider>
      </MemoryRouter>,
    ),
  );
  await settle();
}
function check(v: unknown, message: string) {
  if (!v) throw Error(message);
}
function button(label: string) {
  return Array.from(fixture.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  )!;
}
async function click(label: string) {
  check(button(label), "Botão ausente: " + label);
  await act(async () => button(label).click());
  await settle();
}
async function input(label: string, value: string) {
  const host = Array.from(fixture.querySelectorAll("label")).find((l) =>
    l.textContent?.includes(label),
  );
  const field = host?.querySelector(
    "input,textarea,select",
  ) as HTMLInputElement;
  check(field, "Campo ausente: " + label);
  await act(async () => {
    const proto =
      field.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : field.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
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
  calls = [];
  items = [];
  tickets = [];
  messages = [];
  notifications = [];
  official = false;
  fail = false;
  allow = true;
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: (e as Error).message });
  }
}
await run("Admin anónimo e não autorizado veem 404 sem dados", async () => {
  await mount(<AdminPage repository={adminRepo} />, null);
  check(
    !fixture.textContent?.includes("Centro Administrativo"),
    "admin visível ao anónimo",
  );
  allow = false;
  await mount(<AdminPage repository={adminRepo} />, userId);
  check(!fixture.textContent?.includes("Utilizadores"), "dados expostos");
  check(
    fixture.textContent?.includes("404") ||
      fixture.textContent?.includes("não encontr"),
    "sem 404",
  );
});
await run(
  "Dashboard autorizado apresenta agregados reais do serviço",
  async () => {
    await mount(<AdminPage repository={adminRepo} />);
    check(
      fixture.textContent?.includes("Centro Administrativo"),
      "painel ausente",
    );
    check(
      fixture.textContent?.includes("Cadastros em 7 dias"),
      "agregado ausente",
    );
    check(!fixture.textContent?.includes("email"), "dados pessoais no painel");
  },
);
await run(
  "Decisão envia revisão e estado esperados e requer confirmação",
  async () => {
    await mount(<AdminPage repository={adminRepo} />);
    await click("Denúncias");
    const prompt = window.prompt,
      confirm = window.confirm;
    window.prompt = () => "Fundamentação administrativa de teste";
    window.confirm = () => false;
    await click("Advertir");
    check(
      !calls.some((c) => c.action === "decide_report"),
      "decidiu sem confirmação",
    );
    window.confirm = () => true;
    try {
      await click("Advertir");
      const decision = calls.find((c) => c.action === "decide_report");
      check(
        decision?.data.revision === 2 &&
          decision.data.expected_status === "new",
        "controlo de concorrência ausente",
      );
    } finally {
      window.prompt = prompt;
      window.confirm = confirm;
    }
  },
);
await run("Suporte cria pedido privado, abre conversa e responde", async () => {
  await mount(
    <MemberCenter mode="support" repository={repo} />,
    userId,
    "/suporte",
  );
  await input("Assunto", "Ajuda técnica");
  await input("Descrição", "Descrição privada de teste");
  await submit();
  check(tickets.length === 1, "pedido não criado");
  await click("Abrir conversa");
  check(
    fixture.textContent?.includes("Descrição privada de teste"),
    "mensagem ausente",
  );
  const textareas = fixture.querySelectorAll("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textareas[1], "Esclarecimento de teste");
    textareas[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    fixture
      .querySelectorAll("form")[1]
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
  check(messages.length === 2, "resposta não guardada");
});
await run(
  "Falha de suporte preserva o formulário e não anuncia sucesso",
  async () => {
    await mount(<MemberCenter mode="support" repository={repo} />, userId);
    await input("Assunto", "Ajuda técnica");
    await input("Descrição", "Descrição antes da falha");
    fail = true;
    await submit();
    check(
      fixture
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Falha de rede"),
      "erro invisível",
    );
    check(
      (fixture.querySelector("textarea") as HTMLTextAreaElement).value ===
        "Descrição antes da falha",
      "perdeu descrição",
    );
    check(tickets.length === 0, "sucesso falso");
  },
);
await run("Denúncia usa UUID público pré-preenchido na ligação", async () => {
  await mount(
    <MemberCenter mode="reports" repository={repo} />,
    userId,
    `/denunciar?tipo=profile&id=${adminId}`,
  );
  await input("Descrição", "Alegação para análise administrativa");
  await submit();
  const report = calls.find((c) => c.action === "report");
  check(
    report?.data.target_id === adminId && report.data.kind === "profile",
    "destino incorreto",
  );
});
await run(
  "Notificações persistem leitura e preferência explícita",
  async () => {
    notifications = [
      {
        id: adminId,
        title: "Comunicado",
        body: "Texto institucional",
        kind: "official",
        read_at: null,
        context: {},
        created_at: new Date().toISOString(),
      },
    ];
    await mount(
      <MemberCenter mode="notifications" repository={repo} />,
      userId,
    );
    await click("Marcar como lida");
    check(!!notifications[0].read_at, "leitura não guardada");
    const checkbox = fixture.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    await act(async () => checkbox.click());
    await settle();
    check(official, "preferência não guardada");
  },
);
await run(
  "Campanha tem pré-visualização e só guarda mediante ação",
  async () => {
    await mount(<AdminPage repository={adminRepo} />);
    await click("Campanhas e informação");
    await input("Identificador de URL", "campanha-browser");
    await input("Título", "Campanha de teste");
    await input(
      "Descrição / conteúdo",
      "Texto da campanha para pré-visualização",
    );
    check(
      fixture.textContent?.includes("PRÉ-VISUALIZAÇÃO LOCAL"),
      "sem pré-visualização",
    );
    check(
      !calls.some((c) => c.action === "save_item"),
      "guardou automaticamente",
    );
    await click("Guardar versão");
    check(
      items.length === 1 && items[0].state === "draft",
      "rascunho não persistido",
    );
  },
);
await run("Transparência vazia não inventa saúde operacional", async () => {
  await mount(<PublicCenterPage kind="status" repository={repo} />, null);
  check(
    fixture.textContent?.includes("Nenhuma informação publicada"),
    "vazio ausente",
  );
  check(!fixture.querySelector(".center-item"), "estado fictício");
});
await run(
  "Textos públicos são escapados e políticas não são aprovadas por omissão",
  async () => {
    items = [
      {
        id: adminId,
        kind: "campaign",
        slug: "teste",
        title: "Teste público",
        body: '<img src=x onerror="window.__centerXss=true">',
        severity: "information",
        starts_at: new Date().toISOString(),
        ends_at: null,
        updated_at: new Date().toISOString(),
        verified_at: null,
        image: null,
      },
    ];
    await mount(<PublicCenterPage repository={repo} />, null);
    check(!fixture.querySelector("img"), "HTML executável");
    check(!(window as any).__centerXss, "XSS");
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
    await run(`Centro responsivo ${theme} ${width}px`, async () => {
      await driver({ kind: "viewport", width });
      document.documentElement.dataset.theme = theme;
      await mount(<AdminPage repository={adminRepo} />);
      check(
        document.documentElement.scrollWidth <= window.innerWidth + 1,
        "deslocamento horizontal",
      );
      button("Suporte").focus();
      check(document.activeElement === button("Suporte"), "foco indisponível");
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
