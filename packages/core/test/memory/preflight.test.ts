import { describe, it, expect } from "vitest";
import { needsMemoryPreflight } from "../../src/memory/preflight.js";

describe("needsMemoryPreflight", () => {
  const shouldTrigger = [
    "what do you know about me",
    "what do you remember about my setup",
    "do you remember my favorite color",
    "do you recall our last discussion",
    "my preference for editors",
    "our decision on the database",
    "check your memory for X",
    "check memory for auth stuff",
    "recall my preferences",
    "who is Monica?",
    "who's Suraj?",
    "tell me about me",
    "tell me about Suraj",
    "tell me about Monica",
    "have we discussed this before?",
    "have you talked about testing?",
    "about me?",
    "what do you know about Suraj?",
    "look up my preferences",
    "my favorite language",
    "what does Monica like",
    "what does Suraj prefer for testing",
    "does Monica like pizza",
    "what's Suraj's favorite editor",
    "how is Monica doing",
  ];

  const shouldNotTrigger = [
    "tell me about quantum physics",
    "tell me about the weather",
    "tell me about Docker containers",
    "tell me about TypeScript generics",
    "what about this code?",
    "how do I set up Docker?",
    "hello, how are you?",
    "what is the capital of France?",
    "explain async await",
    "about time we fixed this",
    "who is responsible for this error?",
    "what does javascript do differently",
    "how does docker work",
    "does python support async",
  ];

  for (const msg of shouldTrigger) {
    it(`SHOULD trigger for: "${msg}"`, () => {
      expect(needsMemoryPreflight(msg)).toBe(true);
    });
  }

  for (const msg of shouldNotTrigger) {
    it(`should NOT trigger for: "${msg}"`, () => {
      expect(needsMemoryPreflight(msg)).toBe(false);
    });
  }
});
