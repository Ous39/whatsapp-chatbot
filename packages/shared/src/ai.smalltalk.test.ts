import { describe, expect, it, vi } from "vitest";
import { generateReply, isSmallTalk, type AiConfig, type ReplyContext } from "./ai.js";

// Reproduces the "Hello, how are you?" → handover bug and guards the fix.
const knowledge = [
  { id: "hours-1", title: "Opening hours", content: "We open Monday to Friday, from 9 AM to 5 PM." },
  { id: "team-1", title: "About our team", content: "Our team member will help with any information you need." },
];
const CLARIFY_EN = "I don't have approved information about that yet. Could you share a little more detail, or would you like a human team member?";

const ctx = (message: string, history: ReplyContext["history"] = []): ReplyContext => ({
  businessName: "Test Business",
  industry: "retail",
  knowledge,
  history,
  message,
  language: "en",
  now: new Date("2026-10-25T12:00:00.000Z"),
});

const ollamaReply = (content: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, done: true }), { status: 200, headers: { "Content-Type": "application/json" } }));

const cfg = (fetchImpl: typeof fetch): AiConfig => ({ provider: "ollama", fetchImpl });

describe("small talk detection", () => {
  it.each(["Hello, how are you?", "hi", "Good morning!", "hey there 👋", "thanks", "Bonjour, ça va ?", "Salut", "Salaam aleekum, nanga def?", "Asalaa maalekum", "Na nga def", "jërëjëf"])("treats %j as small talk", message => {
    expect(isSmallTalk(message)).toBe(true);
  });

  it.each(["Hello, what are your opening hours?", "How much is delivery?", "hi I want a refund", "Bonjour, vous livrez à Serrekunda ?", ""])("does not treat %j as small talk", message => {
    expect(isSmallTalk(message)).toBe(false);
  });
});

describe("greetings get a natural reply, never a handover", () => {
  it("answers a greeting with the model's reply and sends no business documents", async () => {
    const fetchImpl = ollamaReply({ reply: "Hello! I'm doing well, thank you for asking. How can I assist you today?", action: "ANSWER", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("Hello, how are you?"));
    expect(result.action).toBe("ANSWER");
    expect(result.text).toBe("Hello! I'm doing well, thank you for asking. How can I assist you today?");
    expect(result.sources).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.messages[0].content).toContain("only a greeting, thanks or small talk");
    expect(body.messages[0].content).toContain("do not mention prices, opening hours");
    expect(body.messages.at(-1).content).toBe("Hello, how are you?");
  });

  it("does not hand over a greeting even after the bot offered a human", async () => {
    const fetchImpl = ollamaReply({ reply: "I'll connect you with our team.", action: "HANDOVER", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("Hello, how are you?", [{ role: "customer", text: "hi" }, { role: "agent", text: CLARIFY_EN }]));
    expect(result.action).toBe("ANSWER");
    expect(result.text).toContain("How can I help");
  });

  it("falls back to a fixed greeting when Ollama fails, instead of throwing (which hands over)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("connect ECONNREFUSED"); });
    const result = await generateReply(cfg(fetchImpl), ctx("Good morning"));
    expect(result.action).toBe("ANSWER");
    expect(result.text).toContain("Test Business");
  });

  it("never lets a greeting reply state facts", async () => {
    const fetchImpl = ollamaReply({ reply: "Hi! Call us on 7123456 or visit www.example.gm", action: "ANSWER", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("hi"));
    expect(result.text).not.toMatch(/\d|www\./);
    expect(result.action).toBe("ANSWER");
  });

  it("replies in French and Wolof when the model is unavailable", async () => {
    const down = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
    expect((await generateReply(cfg(down), { ...ctx("Bonjour"), language: "fr" })).text).toMatch(/Bonjour/);
    expect((await generateReply(cfg(down), { ...ctx("Salaam aleekum"), language: "wo" })).text).toMatch(/Salaam/);
  });

  it("still hands over an explicit request for a person", async () => {
    const fetchImpl = ollamaReply("{}");
    const result = await generateReply(cfg(fetchImpl), ctx("Hello, I want to speak to a human"));
    expect(result.action).toBe("HANDOVER");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("retrieval only uses what the customer wrote", () => {
  it("ignores words from the bot's own previous reply", async () => {
    const fetchImpl = ollamaReply({ reply: "Our team member will help.", action: "ANSWER", sources: [1] });
    // "team", "member", "information" appear only in the bot's clarify text, never from the customer.
    const result = await generateReply(cfg(fetchImpl), ctx("Do you deliver to Serrekunda?", [{ role: "customer", text: "hi" }, { role: "agent", text: CLARIFY_EN }]));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.action).toBe("CLARIFY");
  });

  it("still uses the customer's earlier message as context", async () => {
    const fetchImpl = ollamaReply({ reply: "We open Monday to Friday, from 9 AM to 5 PM.", action: "ANSWER", sources: [1] });
    const result = await generateReply(cfg(fetchImpl), ctx("and on Friday?", [{ role: "customer", text: "What are your opening hours?" }, { role: "agent", text: "Could you tell me which day?" }]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("ANSWER");
    expect(result.sources).toEqual([{ id: "hours-1", title: "Opening hours" }]);
  });
});

describe("Ollama request", () => {
  it("keeps the model loaded between messages", async () => {
    const fetchImpl = ollamaReply({ reply: "We open Monday to Friday.", action: "ANSWER", sources: [1] });
    await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.keep_alive).toBe(-1);
  });
});

describe("the model must not parrot its earlier greeting", () => {
  const GREETING = "Hello! How can I assist you today?";
  const parrotHistory: ReplyContext["history"] = [
    { role: "customer", text: "Hello, how are you?" },
    { role: "agent", text: GREETING },
    { role: "customer", text: "hello" },
    { role: "agent", text: GREETING },
  ];

  it("turns a greeting given in reply to a real question into a clarifying question", async () => {
    const fetchImpl = ollamaReply({ reply: GREETING, action: "ANSWER", sources: [1] });
    const result = await generateReply(cfg(fetchImpl), ctx("What are your opening hours today?", parrotHistory));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("CLARIFY");
    expect(result.text).not.toBe(GREETING);
  });

  it("does not send the bot's repeated greetings to the model as history", async () => {
    const fetchImpl = ollamaReply({ reply: "We open Monday to Friday, from 9 AM to 5 PM.", action: "ANSWER", sources: [1] });
    await generateReply(cfg(fetchImpl), ctx("What are your opening hours?", parrotHistory));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    const assistantTurns = body.messages.filter((m: { role: string }) => m.role === "assistant").map((m: { content: string }) => m.content);
    expect(assistantTurns.join(" ")).not.toContain("How can I assist you today");
    expect(body.messages[0].content).toContain("Do not repeat");
  });

  it.each(["good", "ok", "fine thanks", "great", "Cool!"])("treats the acknowledgement %j as small talk", message => {
    expect(isSmallTalk(message)).toBe(true);
  });
});

describe("the assistant speaks for the business, never as 'an AI'", () => {
  it("replaces a model-written clarification that claims to be an AI with the standard one", async () => {
    const fetchImpl = ollamaReply({ reply: "I'm an AI assistant, so I don't have physical opening hours. Do you need help with something specific?", action: "CLARIFY", sources: [1] });
    const result = await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    expect(result.action).toBe("CLARIFY");
    expect(result.text).toBe(CLARIFY_EN);
  });

  it("keeps a useful clarifying question written by the model", async () => {
    const fetchImpl = ollamaReply({ reply: "Which day would you like to visit?", action: "CLARIFY", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    expect(result.text).toBe("Which day would you like to visit?");
  });

  it("does not let an answer present itself as an AI", async () => {
    const fetchImpl = ollamaReply({ reply: "As an AI language model I cannot open, but we open Monday to Friday.", action: "ANSWER", sources: [1] });
    const result = await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    expect(result.action).toBe("CLARIFY");
  });

  it("uses the fixed greeting if the small-talk reply says it is an AI", async () => {
    const fetchImpl = ollamaReply({ reply: "Hi! I'm just an AI, but I'm here to help.", action: "ANSWER", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("hello"));
    expect(result.text).toContain("Test Business");
  });

  it("tells the model to speak for the business", async () => {
    const fetchImpl = ollamaReply({ reply: "We open Monday to Friday, from 9 AM to 5 PM.", action: "ANSWER", sources: [1] });
    await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.messages[0].content).toContain("Never say you are an AI");
  });
});

describe("French replies are not mistaken for 'AI' claims", () => {
  it("keeps a French clarifying question that uses j'ai / n'ai", async () => {
    const fetchImpl = ollamaReply({ reply: "Je n'ai pas encore cette information. Quel jour souhaitez-vous venir ?", action: "CLARIFY", sources: [] });
    const result = await generateReply(cfg(fetchImpl), { ...ctx("Opening hours ?"), language: "fr" });
    expect(result.text).toBe("Je n'ai pas encore cette information. Quel jour souhaitez-vous venir ?");
  });
});

describe("prompt is ordered for Ollama's prompt cache", () => {
  const systemOf = (f: ReturnType<typeof ollamaReply>) => JSON.parse(String(f.mock.calls[0]![1]?.body)).messages[0].content as string;
  const cut = (p: string) => p.slice(0, p.indexOf("For this message:"));

  it("starts identically for different questions, greetings and times", async () => {
    const a = ollamaReply({ reply: "We open Monday to Friday.", action: "ANSWER", sources: [1] });
    const b = ollamaReply({ reply: "Our team will help.", action: "ANSWER", sources: [2] });
    const c = ollamaReply({ reply: "Hello! How can we help?", action: "ANSWER", sources: [] });
    await generateReply(cfg(a), ctx("What are your opening hours?"));
    await generateReply(cfg(b), { ...ctx("Tell me about your team"), now: new Date("2026-10-26T08:30:00.000Z") });
    await generateReply(cfg(c), ctx("hello"));
    expect(cut(systemOf(a)).length).toBeGreaterThan(200);
    expect(cut(systemOf(b))).toBe(cut(systemOf(a)));
    expect(cut(systemOf(c))).toBe(cut(systemOf(a)));
    // Everything that changes per message comes after the knowledge.
    expect(systemOf(a).indexOf("Current time")).toBeGreaterThan(systemOf(a).indexOf("Approved knowledge"));
  });

  it("includes every published answer in a fixed order when they fit", async () => {
    const a = ollamaReply({ reply: "We open Monday to Friday.", action: "ANSWER", sources: [2] });
    const result = await generateReply(cfg(a), ctx("What are your opening hours?"));
    const prompt = systemOf(a);
    expect(prompt).toContain("Opening hours");
    expect(prompt).toContain("About our team");
    // Sources are numbered in the fixed order (by id): 1 = hours-1, 2 = team-1.
    expect(result.sources).toEqual([{ id: "team-1", title: "About our team" }]);
  });
});

describe("'we' greetings and guessed answers", () => {
  const WE_GREETING = "Hello! Welcome to Test Business. How can we help you today?";

  it("recognises a greeting phrased with 'we' as a repeated greeting", async () => {
    const fetchImpl = ollamaReply({ reply: WE_GREETING, action: "ANSWER", sources: [2] });
    const result = await generateReply(cfg(fetchImpl), ctx("Tell me about your team", [{ role: "customer", text: "hello" }, { role: "agent", text: WE_GREETING }]));
    expect(result.action).toBe("CLARIFY");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.messages.filter((m: { role: string }) => m.role === "assistant")).toEqual([]);
  });

  it("tells the model not to guess what the knowledge doesn't say", async () => {
    const fetchImpl = ollamaReply({ reply: "We open Monday to Friday.", action: "ANSWER", sources: [1] });
    await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.messages[0].content).toContain("do not guess");
  });
});

describe("claims that the business lacks something must come from the knowledge", () => {
  it("rejects an invented 'we don't have opening hours'", async () => {
    const fetchImpl = ollamaReply({ reply: "We don't have specific opening hours as we're a digital service company.", action: "ANSWER", sources: [2] });
    const result = await generateReply(cfg(fetchImpl), ctx("What are your opening hours?"));
    expect(result.action).toBe("CLARIFY");
    expect(result.text).toBe(CLARIFY_EN);
  });

  it("keeps a 'we don't…' answer that the cited knowledge actually states", async () => {
    const fetchImpl = ollamaReply({ reply: "We don't offer delivery on Sundays.", action: "ANSWER", sources: [1] });
    const result = await generateReply(cfg(fetchImpl), { ...ctx("Do you deliver on Sunday?"), knowledge: [{ id: "a-delivery", title: "Delivery", content: "We deliver Monday to Saturday. We do not offer delivery on Sundays." }] });
    expect(result.action).toBe("ANSWER");
    expect(result.text).toBe("We don't offer delivery on Sundays.");
  });

  it("asks the model to reply 'you're welcome' to thanks", async () => {
    const fetchImpl = ollamaReply({ reply: "You're welcome! Anything else we can help with?", action: "ANSWER", sources: [] });
    const result = await generateReply(cfg(fetchImpl), ctx("thank"));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.messages[0].content).toContain("you're welcome");
    expect(result.text).toBe("You're welcome! Anything else we can help with?");
  });
});
