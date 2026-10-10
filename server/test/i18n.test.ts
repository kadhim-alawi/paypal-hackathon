import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

describe("Spanish-speaking applicants", () => {
  it("get the greeting, notes and progress labels in Spanish", async () => {
    const ctx = await makeApp();
    try {
      const start = await ctx.app.inject({ method: "POST", url: "/api/funds/eastside/applications", payload: { language: "es" } });
      expect(start.statusCode).toBe(201);
      const { id, token } = start.json();
      const headers = { "x-applicant-token": token };

      const view = (await ctx.app.inject({ method: "GET", url: `/api/applications/${id}`, headers })).json();
      expect(view.language).toBe("es");
      expect(view.messages[0].content).toMatch(/^Hola, soy el asistente de Eastside Neighbors Emergency Fund/);
      expect(view.timeline.map((s: { label: string }) => s.label)).toEqual(["Solicitud escrita", "Revisada", "Dinero enviado", "Recibido"]);

      const english = (await ctx.app.inject({ method: "POST", url: "/api/funds/eastside/applications", payload: {} })).json();
      const en = (await ctx.app.inject({ method: "GET", url: `/api/applications/${english.id}`, headers: { "x-applicant-token": english.token } })).json();
      expect(en.messages[0].content).toMatch(/^Hi, I'm the Eastside Neighbors Emergency Fund assistant/);
      expect(en.timeline[0].label).toBe("Request written");
    } finally {
      await ctx.close();
    }
  });
});
