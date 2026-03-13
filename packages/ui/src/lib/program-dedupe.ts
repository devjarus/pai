import type { Program } from "@/api";

interface ProgramMatchInput {
  title: string;
  question: string;
  executionMode?: Program["executionMode"];
  programId?: string | null;
  threadId?: string | null;
}

function normalizeProgramKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function findMatchingProgram(programs: Program[], input: ProgramMatchInput): Program | undefined {
  const normalizedTitle = normalizeProgramKey(input.title);
  const normalizedQuestion = normalizeProgramKey(input.question);
  const executionMode = input.executionMode ?? "research";

  return programs.find((program) => {
    if (input.programId && program.id === input.programId) {
      return true;
    }
    if (input.threadId && program.threadId && program.threadId === input.threadId) {
      return true;
    }
    return (
      program.executionMode === executionMode &&
      normalizeProgramKey(program.title) === normalizedTitle &&
      normalizeProgramKey(program.question) === normalizedQuestion
    );
  });
}
