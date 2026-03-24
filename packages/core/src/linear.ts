import type { Config } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

type LinearConfig = Config["linear"];

interface LinearGraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearTeamNode {
  id: string;
  key: string;
  name: string;
}

interface LinearProjectNode {
  id: string;
  name: string;
  slugId: string;
}

export interface LinearIssueInput {
  title: string;
  description: string;
  priority?: number;
  team?: string;
  project?: string;
}

export interface LinearIssueResult {
  id: string;
  identifier: string;
  title: string;
  url: string;
  team: { id: string; key: string; name: string };
  project: { id: string; name: string; slugId: string } | null;
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

function matchRef(
  ref: string,
  fields: Array<string | null | undefined>,
): boolean {
  const normalized = normalizeRef(ref);
  return fields.some((field) => Boolean(field) && normalizeRef(field as string) === normalized);
}

function assertLinearEnabled(config: LinearConfig | undefined): asserts config is NonNullable<LinearConfig> {
  if (!config?.enabled) {
    throw new Error("Linear issue intake is disabled in Settings.");
  }
  if (!config.apiKey) {
    throw new Error("Linear API key is missing in Settings.");
  }
}

async function linearGraphQL<TData>(
  config: NonNullable<LinearConfig>,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: config.apiKey!,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json() as LinearGraphqlEnvelope<TData>;
  if (!response.ok) {
    const detail = payload.errors?.map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(detail || `Linear API request failed (${response.status})`);
  }
  if (payload.errors && payload.errors.length > 0) {
    const detail = payload.errors.map((entry) => entry.message).filter(Boolean).join("; ");
    throw new Error(detail || "Linear API returned an error");
  }
  if (!payload.data) {
    throw new Error("Linear API returned an empty response");
  }
  return payload.data;
}

async function listTeams(config: NonNullable<LinearConfig>): Promise<LinearTeamNode[]> {
  const data = await linearGraphQL<{ teams: { nodes: LinearTeamNode[] } }>(
    config,
    `query LinearTeams {
      teams {
        nodes {
          id
          key
          name
        }
      }
    }`,
  );
  return data.teams.nodes;
}

async function listProjects(config: NonNullable<LinearConfig>): Promise<LinearProjectNode[]> {
  const data = await linearGraphQL<{ projects: { nodes: LinearProjectNode[] } }>(
    config,
    `query LinearProjects {
      projects {
        nodes {
          id
          name
          slugId
        }
      }
    }`,
  );
  return data.projects.nodes;
}

async function resolveTeam(config: NonNullable<LinearConfig>, teamRef?: string): Promise<LinearTeamNode> {
  const teams = await listTeams(config);
  const target = teamRef?.trim() || config.defaultTeam?.trim();
  if (target) {
    const match = teams.find((team) => matchRef(target, [team.id, team.key, team.name]));
    if (!match) {
      throw new Error(`Linear team "${target}" was not found.`);
    }
    return match;
  }

  if (teams.length === 1) {
    return teams[0]!;
  }

  throw new Error("Linear team is not configured. Set a default team in Settings or specify one in the request.");
}

async function resolveProject(config: NonNullable<LinearConfig>, projectRef?: string): Promise<LinearProjectNode | null> {
  const target = projectRef?.trim() || config.defaultProject?.trim();
  if (!target) return null;

  const projects = await listProjects(config);
  const match = projects.find((project) => matchRef(target, [project.id, project.slugId, project.name]));
  if (!match) {
    throw new Error(`Linear project "${target}" was not found.`);
  }
  return match;
}

export function isLinearIssueIntakeConfigured(config: LinearConfig | undefined): boolean {
  return config?.enabled === true && typeof config.apiKey === "string" && config.apiKey.trim().length > 0;
}

export async function createLinearIssue(
  config: LinearConfig | undefined,
  input: LinearIssueInput,
): Promise<LinearIssueResult> {
  assertLinearEnabled(config);

  const team = await resolveTeam(config, input.team);
  const project = await resolveProject(config, input.project);

  const variables = {
    input: {
      title: input.title.trim(),
      description: input.description.trim(),
      teamId: team.id,
      ...(typeof input.priority === "number" ? { priority: input.priority } : {}),
      ...(project ? { projectId: project.id } : {}),
    },
  };

  const data = await linearGraphQL<{
    issueCreate: {
      success: boolean;
      issue: {
        id: string;
        identifier: string;
        title: string;
        url: string;
        team: { id: string; key: string; name: string };
        project: { id: string; name: string; slugId: string } | null;
      } | null;
    };
  }>(
    config,
    `mutation LinearIssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          team {
            id
            key
            name
          }
          project {
            id
            name
            slugId
          }
        }
      }
    }`,
    variables,
  );

  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error("Linear issue creation did not return an issue.");
  }

  return data.issueCreate.issue;
}
