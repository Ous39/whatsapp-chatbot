import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODELS,
  generateReply,
  resolveAiProvider,
  type AiConfig,
  type ReplyContext,
} from "./ai.js";

const knowledge = [
  {
    id: "hours-1",
    title: "Opening hours",
    content: "We open Monday to Friday, from 9 AM to 5 PM.",
  },
];

const context = (message = "What are your opening hours?"): ReplyContext => ({
  businessName: "Test Business",
  industry: "retail",
  knowledge,
  history: [],
  message,
  now: new Date("2026-10-24T12:00:00.000Z"),
});

function mockFetch(reply: string) {
  return vi.fn<typeof fetch>(async () =>
    new Response(
      JSON.stringify({
        message: { role: "assistant", content: reply },
        done: true,
        prompt_eval_count: 25,
        eval_count: 15,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
}

describe("Ollama AI provider", () => {
  it("recognizes Ollama and uses Qwen3 4B as its default model", () => {
    expect(resolveAiProvider("ollama")).toBe("ollama");
    expect(DEFAULT_MODELS.ollama).toBe("qwen3:4b");
  });

  it("uses native Ollama chat, disables thinking, and normalizes Qwen3 output", async () => {
    const fetchImpl = mockFetch(
      JSON.stringify({
        reply: "We open Monday to Friday, from 9 AM to 5 PM.",
        action: "direct_answer",
        sources: ["Source 1"],
      }),
    );

    const cfg: AiConfig = {
      provider: "ollama",
      fetchImpl,
    };

    const result = await generateReply(cfg, context());

    expect(result.provider).toBe("ollama");
    expect(result.simulated).toBe(false);
    expect(result.action).toBe("ANSWER");
    expect(result.sources).toEqual([
      { id: "hours-1", title: "Opening hours" },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 25,
      outputTokens: 15,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://ollama:11434/api/chat");
    expect(init?.method).toBe("POST");

    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("qwen3:4b");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options.num_predict).toBe(400);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Opening hours");
  });

  it("supports a custom Ollama endpoint and model", async () => {
    const fetchImpl = mockFetch(
      JSON.stringify({
        reply: "We open Monday to Friday.",
        action: "ANSWER",
        sources: [1],
      }),
    );

    await generateReply(
      {
        provider: "ollama",
        baseUrl: "http://ollama:11434/api/chat",
        model: "qwen3:4b",
        fetchImpl,
      },
      context(),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "http://ollama:11434/api/chat",
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.model).toBe("qwen3:4b");
    expect(body.think).toBe(false);
  });

  it("returns a clarification instead of accepting malformed model output", async () => {
    const fetchImpl = mockFetch("This is not valid JSON.");

    const result = await generateReply(
      { provider: "ollama", fetchImpl },
      context(),
    );

    expect(result.action).toBe("CLARIFY");
    expect(result.sources).toEqual([]);
    expect(result.text).toContain("approved information");
    expect(result.simulated).toBe(false);
  });

  it("does not call the model when nothing relevant matches", async () => {
    const fetchImpl = mockFetch(
      JSON.stringify({
        reply: "We open Monday to Friday.",
        action: "ANSWER",
        sources: [1],
      }),
    );

    const result = await generateReply(
      { provider: "ollama", fetchImpl },
      context("What is your delivery tracking policy?"),
    );

    expect(result.action).toBe("CLARIFY");
    expect(result.sources).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an answer without a cited source", async () => {
    const fetchImpl = mockFetch(
      JSON.stringify({
        reply: "We can certainly help you with that.",
        action: "ANSWER",
        sources: [],
      }),
    );

    const result = await generateReply(
      { provider: "ollama", fetchImpl },
      context(),
    );

    expect(result.action).toBe("CLARIFY");
    expect(result.sources).toEqual([]);
    expect(result.text).toContain("approved information");
  });

  it("does not call the model when a customer asks for a human", async () => {
    const fetchImpl = mockFetch("{}");

    const result = await generateReply(
      { provider: "ollama", fetchImpl },
      context("I want to speak to a human agent."),
    );

    expect(result.action).toBe("HANDOVER");
    expect(result.provider).toBe("ollama");
    expect(result.sources).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
