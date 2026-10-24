import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req) => {
  const store = getStore("torneio");

  // Leitura pública (modo ?view=1 e carga inicial do admin)
  if (req.method === "GET") {
    const dados = await store.get("dados", { type: "json" });
    return json(dados);
  }

  // Gravação: só com a senha de administrador
  if (req.method === "PUT") {
    const senha = Netlify.env.get("ADMIN_TOKEN");
    if (!senha || req.headers.get("x-admin-token") !== senha) {
      return json({ erro: "Não autorizado" }, 401);
    }
    const corpo = await req.text();
    try {
      const d = JSON.parse(corpo);
      if (!d || !d.state || !Array.isArray(d.state.players)) throw 0;
    } catch {
      return json({ erro: "Dados inválidos" }, 400);
    }
    await store.set("dados", corpo);
    return json({ ok: true });
  }

  return json({ erro: "Método não permitido" }, 405);
};

export const config = { path: "/api/state" };
