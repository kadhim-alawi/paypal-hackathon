import { describe, expect, it } from "vitest";
import { ensureStaffAccounts } from "../src/seed.js";
import { makeApp } from "./helpers.js";

const login = (ctx: Awaited<ReturnType<typeof makeApp>>, email: string, password: string) =>
  ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });

describe("staff accounts", () => {
  it("exist without demo data and follow password changes in the environment", async () => {
    const ctx = await makeApp({ SEED_DEMO: "false" });
    try {
      expect((await ctx.app.inject({ method: "GET", url: "/api/funds" })).json()).toEqual([]);
      expect((await login(ctx, "admin@tideover.app", "tideover-admin")).statusCode).toBe(200);
      expect((await ctx.app.inject({ method: "GET", url: "/api/config" })).json().demoLogins).toBe(true);

      const config = { ...ctx.s.config, admin: { ...ctx.s.config.admin, password: "a-much-better-secret" } };
      expect((await ensureStaffAccounts({ ...ctx.s, config })).changed).toBe(1);
      expect((await login(ctx, "admin@tideover.app", "tideover-admin")).statusCode).toBe(401);
      expect((await login(ctx, "admin@tideover.app", "a-much-better-secret")).statusCode).toBe(200);
      expect((await ensureStaffAccounts({ ...ctx.s, config })).changed).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it("hides one-click demo sign-in once real passwords are configured", async () => {
    const ctx = await makeApp({ ADMIN_PASSWORD: "admin-secret-123", REVIEWER_PASSWORD: "review-secret-123" });
    try {
      expect((await ctx.app.inject({ method: "GET", url: "/api/config" })).json().demoLogins).toBe(false);
      expect((await login(ctx, "reviewer@tideover.app", "review-secret-123")).statusCode).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});
