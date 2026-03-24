import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinearIssue, isLinearIssueIntakeConfigured } from "../src/linear.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Linear integration", () => {
  it("reports whether issue intake is configured", () => {
    expect(isLinearIssueIntakeConfigured(undefined)).toBe(false);
    expect(isLinearIssueIntakeConfigured({ enabled: true })).toBe(false);
    expect(isLinearIssueIntakeConfigured({ enabled: true, apiKey: "lin_api_key" })).toBe(true);
  });

  it("creates an issue using the only available team", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          teams: {
            nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-1",
              identifier: "ENG-123",
              title: "Add digest snooze",
              url: "https://linear.app/acme/issue/ENG-123/add-digest-snooze",
              team: { id: "team-1", key: "ENG", name: "Engineering" },
              project: null,
            },
          },
        },
      }), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    const issue = await createLinearIssue(
      { enabled: true, apiKey: "lin_api_key" },
      {
        title: "Add digest snooze",
        description: "Need a way to snooze noisy daily digests.",
      },
    );

    expect(issue.identifier).toBe("ENG-123");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.linear.app/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "lin_api_key" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.linear.app/graphql",
      expect.objectContaining({
        body: expect.stringContaining("\"teamId\":\"team-1\""),
      }),
    );
  });

  it("resolves configured team and project by friendly references", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          teams: {
            nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          projects: {
            nodes: [{ id: "project-1", name: "Inbox polish", slugId: "inbox-polish" }],
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-2",
              identifier: "ENG-124",
              title: "Improve issue intake",
              url: "https://linear.app/acme/issue/ENG-124/improve-issue-intake",
              team: { id: "team-1", key: "ENG", name: "Engineering" },
              project: { id: "project-1", name: "Inbox polish", slugId: "inbox-polish" },
            },
          },
        },
      }), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    await createLinearIssue(
      {
        enabled: true,
        apiKey: "lin_api_key",
        defaultTeam: "ENG",
        defaultProject: "Inbox polish",
      },
      {
        title: "Improve issue intake",
        description: "Users should only answer a few questions before an issue is filed.",
        priority: 2,
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.linear.app/graphql",
      expect.objectContaining({
        body: expect.stringContaining("\"projectId\":\"project-1\""),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.linear.app/graphql",
      expect.objectContaining({
        body: expect.stringContaining("slugId"),
      }),
    );
  });

  it("throws a helpful error when multiple teams exist and no default is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          teams: {
            nodes: [
              { id: "team-1", key: "ENG", name: "Engineering" },
              { id: "team-2", key: "OPS", name: "Operations" },
            ],
          },
        },
      }), { status: 200 }),
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(createLinearIssue(
      { enabled: true, apiKey: "lin_api_key" },
      {
        title: "Improve issue intake",
        description: "Users should only answer a few questions before an issue is filed.",
      },
    )).rejects.toThrow("Linear team is not configured");
  });
});
