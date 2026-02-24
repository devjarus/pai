/**
 * Recall benchmark — measures semanticSearch latency over 500+ seeded beliefs.
 *
 * Usage:
 *   npx tsx packages/core/test/bench/recall-benchmark.ts
 *   pnpm bench:recall
 *
 * Outputs p50 / p95 / p99 latencies to stdout and writes per-query timings
 * to recall-benchmark-results.csv in the working directory.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStorage } from "../../src/storage.js";
import {
  memoryMigrations,
  createBelief,
  storeEmbedding,
  semanticSearch,
} from "../../src/memory/memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a random float in [lo, hi). */
function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Generate a random unit-length embedding of the given dimension. */
function randomEmbedding(dim: number): number[] {
  const vec = Array.from({ length: dim }, () => rand(-1, 1));
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / mag);
}

/** Pick a random element from an array. */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Compute a percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ---------------------------------------------------------------------------
// Realistic belief corpus
// ---------------------------------------------------------------------------

const BELIEF_TEMPLATES: readonly string[] = [
  // Factual
  "User's full name is {name}",
  "User lives in {city}, {country}",
  "User works as a {role} at {company}",
  "User's birthday is {date}",
  "User graduated from {university} in {year}",
  "User speaks {language} fluently",
  "User's email address is {email}",
  "User drives a {color} {car}",
  "User has {count} years of experience with {tech}",
  "User's team uses {tool} for project management",

  // Preferences
  "User prefers {editor} over {editor2} for {lang} development",
  "User likes {food} cuisine, especially {dish}",
  "User prefers dark mode in all applications",
  "User prefers tabs over spaces for indentation",
  "User likes to start the day with {beverage}",
  "User prefers functional programming patterns over OOP",
  "User favors {framework} for building web applications",
  "User prefers {db} for relational data storage",
  "User prefers morning meetings over afternoon ones",
  "User likes {genre} music while coding",

  // Procedural
  "When deploying to production, user always runs the full test suite first",
  "User reviews pull requests by checking tests before code changes",
  "User uses {tool} for database migrations in {framework} projects",
  "User's workflow includes running linters before every commit",
  "User creates feature branches from the main branch",
  "User writes unit tests before integration tests",
  "User uses {ci} for continuous integration",
  "When debugging, user starts by checking the logs",
  "User backs up the database every {frequency}",
  "User prefers rebasing over merging for clean Git history",

  // Architectural
  "User's project uses a monorepo structure with {tool}",
  "User's API follows REST conventions with JSON responses",
  "User's frontend is built with {framework} and {css}",
  "User's backend uses {runtime} with {framework} for HTTP",
  "User stores configuration in environment variables",
  "User's system uses SQLite for local-first data storage",
  "User's microservices communicate via {protocol}",
  "User's authentication is handled by {auth}",
  "User's project targets Node.js {version} or higher",
  "User's CI pipeline runs on {platform}",

  // Insights
  "User finds {tech} helpful for rapid prototyping",
  "User noticed that {optimization} improved query performance by {percent}%",
  "User believes code reviews catch more bugs than automated testing alone",
  "User values documentation that includes code examples",
  "User thinks {pattern} is underused in modern web development",
  "User found that pair programming works best for complex features",
  "User considers type safety more important than development speed",
  "User learned that {approach} reduced deployment failures significantly",
  "User believes monitoring should be set up before the first production deploy",
  "User thinks {tool} is the best option for {task} in {year}",
];

const FILLERS: Record<string, readonly string[]> = {
  name: ["Alex Rivera", "Jordan Chen", "Sam Patel", "Morgan Kim", "Casey Brooks"],
  city: ["San Francisco", "Berlin", "Tokyo", "London", "Toronto", "Sydney", "Amsterdam"],
  country: ["USA", "Germany", "Japan", "UK", "Canada", "Australia", "Netherlands"],
  role: ["software engineer", "senior developer", "tech lead", "staff engineer", "engineering manager"],
  company: ["Acme Corp", "Widgets Inc", "DataFlow", "CloudNine", "ByteForge"],
  date: ["March 15", "July 4", "December 22", "September 1", "January 30"],
  university: ["MIT", "Stanford", "ETH Zurich", "University of Toronto", "Imperial College"],
  year: ["2015", "2018", "2020", "2022", "2024"],
  language: ["English", "Spanish", "Mandarin", "German", "Japanese", "French"],
  email: ["alex@example.com", "user@personal.dev", "dev@mycompany.io"],
  color: ["black", "white", "blue", "silver", "red"],
  car: ["Tesla Model 3", "Honda Civic", "BMW 3 Series", "Toyota Camry", "Subaru Outback"],
  count: ["3", "5", "8", "10", "15"],
  tech: ["TypeScript", "Python", "React", "PostgreSQL", "Kubernetes", "Docker", "Rust", "Go"],
  editor: ["VS Code", "Neovim", "WebStorm", "Zed", "Sublime Text"],
  editor2: ["IntelliJ", "Atom", "Emacs", "Vim", "Eclipse"],
  lang: ["TypeScript", "Python", "Go", "Rust", "Java"],
  food: ["Japanese", "Italian", "Mexican", "Thai", "Indian", "Korean"],
  dish: ["sushi", "pasta carbonara", "tacos al pastor", "pad thai", "butter chicken"],
  beverage: ["black coffee", "green tea", "espresso", "matcha latte", "cold brew"],
  framework: ["Next.js", "Fastify", "Express", "Remix", "SvelteKit", "Nuxt"],
  db: ["PostgreSQL", "SQLite", "MySQL", "DuckDB"],
  genre: ["lo-fi", "ambient", "jazz", "classical", "electronic"],
  tool: ["pnpm", "Turborepo", "Nx", "Lerna", "Jira", "Linear", "Notion", "Prisma", "Drizzle"],
  ci: ["GitHub Actions", "CircleCI", "GitLab CI", "Jenkins"],
  css: ["Tailwind CSS", "CSS Modules", "styled-components", "vanilla-extract"],
  runtime: ["Node.js", "Bun", "Deno"],
  protocol: ["gRPC", "REST", "GraphQL", "message queues"],
  auth: ["JWT tokens", "OAuth 2.0", "session cookies", "Passport.js"],
  version: ["18", "20", "22"],
  platform: ["GitHub Actions", "Vercel", "AWS CodePipeline", "Fly.io"],
  optimization: ["adding indexes", "query batching", "connection pooling", "caching"],
  percent: ["30", "50", "65", "80"],
  pattern: ["event sourcing", "CQRS", "hexagonal architecture", "domain-driven design"],
  approach: ["canary deployments", "feature flags", "blue-green deploys", "trunk-based development"],
  task: ["log aggregation", "container orchestration", "API documentation", "load testing"],
  frequency: ["night", "week", "hour"],
};

function fillTemplate(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const options = FILLERS[key];
    return options ? pick(options) : key;
  });
}

const BELIEF_TYPES = ["factual", "preference", "procedural", "architectural", "insight"] as const;

// ---------------------------------------------------------------------------
// Main benchmark
// ---------------------------------------------------------------------------

const EMBED_DIM = 384; // MiniLM-L6-v2
const NUM_BELIEFS = 500;
const NUM_QUERIES = 100;
const SEARCH_LIMIT = 10;

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pai-bench-"));
  const dbPath = path.join(tmpDir, "bench.db");

  console.log(`Benchmark: ${NUM_BELIEFS} beliefs, ${NUM_QUERIES} queries, dim=${EMBED_DIM}`);
  console.log(`Database: ${dbPath}\n`);

  // ---- Setup ----
  const storage = createStorage(dbPath);
  storage.migrate("memory", memoryMigrations);

  // ---- Seed beliefs ----
  const seedStart = performance.now();
  for (let i = 0; i < NUM_BELIEFS; i++) {
    const template = pick(BELIEF_TEMPLATES);
    const statement = fillTemplate(template);
    const type = pick(BELIEF_TYPES);
    const confidence = rand(0.3, 1.0);
    const importance = Math.round(rand(1, 10));
    const subject = pick(["owner", "project", "team", "general"]);

    const belief = createBelief(storage, { statement, confidence, type, importance, subject });
    const embedding = randomEmbedding(EMBED_DIM);
    storeEmbedding(storage, belief.id, embedding);
  }
  const seedMs = performance.now() - seedStart;
  console.log(`Seeded ${NUM_BELIEFS} beliefs in ${seedMs.toFixed(1)} ms`);

  // ---- Run queries ----
  const timings: number[] = [];
  const queryTexts = [
    "programming language preference",
    "database choice for the project",
    "deployment workflow",
    "favorite food and cuisine",
    "morning routine and habits",
    "testing framework and strategy",
    "code review process",
    "team communication tools",
    "frontend framework preference",
    "authentication approach",
    "user birthday and personal info",
    "CI/CD pipeline setup",
    "coding music preference",
    "monorepo tooling",
    "debugging workflow",
    "backup and disaster recovery",
    "API design patterns",
    "type safety and TypeScript",
    "editor and IDE preference",
    "career and work experience",
  ];

  for (let i = 0; i < NUM_QUERIES; i++) {
    const queryEmb = randomEmbedding(EMBED_DIM);
    const queryText = queryTexts[i % queryTexts.length]!;

    const t0 = performance.now();
    semanticSearch(storage, queryEmb, SEARCH_LIMIT, queryText);
    const elapsed = performance.now() - t0;
    timings.push(elapsed);
  }

  // ---- Compute stats ----
  const sorted = [...timings].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const mean = timings.reduce((s, v) => s + v, 0) / timings.length;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;

  console.log(`\n--- Recall Latency (${NUM_QUERIES} queries, top-${SEARCH_LIMIT}) ---`);
  console.log(`  min:  ${min.toFixed(3)} ms`);
  console.log(`  mean: ${mean.toFixed(3)} ms`);
  console.log(`  p50:  ${p50.toFixed(3)} ms`);
  console.log(`  p95:  ${p95.toFixed(3)} ms`);
  console.log(`  p99:  ${p99.toFixed(3)} ms`);
  console.log(`  max:  ${max.toFixed(3)} ms`);

  // ---- Write CSV ----
  const csvPath = path.resolve("recall-benchmark-results.csv");
  const csvLines = ["query_index,query_text,latency_ms"];
  for (let i = 0; i < timings.length; i++) {
    const queryText = queryTexts[i % queryTexts.length]!;
    csvLines.push(`${i},"${queryText}",${timings[i]!.toFixed(4)}`);
  }
  csvLines.push("");
  csvLines.push(`# beliefs=${NUM_BELIEFS} queries=${NUM_QUERIES} dim=${EMBED_DIM} limit=${SEARCH_LIMIT}`);
  csvLines.push(`# p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms mean=${mean.toFixed(3)}ms`);
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
  console.log(`\nCSV written to ${csvPath}`);

  // ---- Cleanup ----
  storage.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("Temp database cleaned up.");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
