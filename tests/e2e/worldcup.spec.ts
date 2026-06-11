import { expect, test } from "@playwright/test";

// World Cup feature smoke test. Mocks /api/worldcup/data so it runs without
// Redis/Claude. Delete this file when removing the feature (see
// src/features/worldcup/README.md).
test.describe("World Cup feature", () => {
  test("renders schedule, prediction pick and graded result", async ({ page }) => {
    // Stub the on-demand refresh so the test never hits Redis/Claude.
    await page.route("**/api/worldcup/refresh", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, newlyPredicted: 0 }),
      });
    });

    await page.route("**/api/worldcup/data", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fixtures: [
            {
              id: "m1",
              round: "Matchday 1",
              stage: "group",
              group: "Group A",
              date: "2026-06-11",
              timeRaw: "13:00 UTC-6",
              kickoffUtc: "2026-06-11T19:00:00.000Z",
              team1: "Mexico",
              team2: "South Africa",
              ground: "Mexico City",
            },
            {
              id: "m2",
              round: "Matchday 1",
              stage: "group",
              group: "Group B",
              date: "2030-06-12",
              timeRaw: "12:00 UTC-7",
              kickoffUtc: "2030-06-12T19:00:00.000Z",
              team1: "Spain",
              team2: "Brazil",
              ground: "Dallas",
            },
          ],
          predictions: {
            m1: {
              matchId: "m1",
              generatedAt: "2026-06-11T09:00:00.000Z",
              model: "claude-sonnet-4-6",
              score: "2-0",
              winProb: { home: 60, draw: 25, away: 15 },
              confidence: "medium",
              oneLiner: "Mexico edge it at altitude.",
              detail: { prediction: { score: "2-0" }, factors: {}, key_players: [] },
            },
            m2: {
              matchId: "m2",
              generatedAt: "2026-06-11T09:00:00.000Z",
              model: "claude-sonnet-4-6",
              score: "1-1",
              winProb: { home: 33, draw: 34, away: 33 },
              confidence: "high",
              oneLiner: "Tight one.",
              detail: { prediction: { score: "1-1" }, factors: {}, key_players: [] },
            },
          },
          results: {
            m1: {
              matchId: "m1",
              gradedAt: "2026-06-11T23:00:00.000Z",
              homeScore: 2,
              awayScore: 0,
              outcomeHit: true,
              exactHit: true,
            },
          },
          meta: {
            lastSyncAt: "2026-06-12T09:00:00.000Z",
            fixturesCount: 2,
            predictionsCount: 2,
            resultsCount: 1,
            accuracy: { graded: 1, outcomeHits: 1, exactHits: 1 },
          },
        }),
      });
    });

    await page.goto("/worldcup");

    // Schedule lists both fixtures (assert language-independent venues, since
    // team names are localized to Chinese in zh mode)
    await expect(page.getByText("Mexico City").first()).toBeVisible();
    await expect(page.getByText("Dallas").first()).toBeVisible();

    // Graded result for the finished match (rendered as "2–0", en dash)
    await expect(page.getByText("2–0").first()).toBeVisible();

    // AI pick for the upcoming match
    await expect(page.getByText("1-1").first()).toBeVisible();
  });
});
