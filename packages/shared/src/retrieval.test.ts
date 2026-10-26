import { describe, expect, it, vi } from "vitest";
import { generateReply, rankKnowledge, type ReplyContext } from "./ai.js";
import { detectLanguageRequest } from "./voice.js";

const docs = [
  { id: "about", title: "About OceanBrown", content: "OceanBrown Creative Studio is a Gambian digital and technology business." },
  { id: "services", title: "Services", content: "OceanBrown offers software development, web design and digital marketing." },
  { id: "hours", title: "Opening hours", content: "We are open Monday to Friday." },
];

describe("search matches singular and plural", () => {
  it.each([["service", "services"], ["hour", "hours"], ["what services", "services"]])("%j finds the %j answer", (query, id) => {
    expect(rankKnowledge(query, docs, 1)[0]?.doc.id).toBe(id);
  });
});

describe("misheard business names still find the business", () => {
  const ctx = (message: string): ReplyContext => ({ businessName: "OceanBrown", knowledge: docs, history: [], message, language: "en" });
  const reply = () => vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ reply: "OceanBrown Creative Studio is a Gambian digital and technology business.", action: "ANSWER", sources: [1] }) } }), { status: 200 }));

  it.each(["What is Ozone Brown?", "tell me about ocean brown", "Qu'est-ce que OceanBrown ?"])("%j reaches the model with the About answer", async message => {
    const fetchImpl = reply();
    const result = await generateReply({ provider: "ollama", fetchImpl }, ctx(message));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("ANSWER");
    expect(result.sources[0]?.id).toBe("about");
  });

  it("does not treat an unrelated word as the business name", async () => {
    const fetchImpl = reply();
    await generateReply({ provider: "ollama", fetchImpl }, ctx("Do you sell brown sugar?"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("explicit language requests", () => {
  it.each([
    ["make it english", "en"], ["Could you convert to English is better?", "en"], ["please reply in English", "en"], ["speak english", "en"],
    ["en français s'il vous plaît", "fr"], ["can you speak French", "fr"], ["parle français", "fr"],
    ["can you speak wolof", "wo"], ["wax ci wolof", "wo"],
  ])("%j → %s", (text, lang) => {
    expect(detectLanguageRequest(text)).toBe(lang);
  });

  it.each(["Could you speak Arabic?", "I like English tea", "Hello, how are you?", "We need a French website"])("%j is not a request", text => {
    expect(detectLanguageRequest(text)).toBeNull();
  });
});
