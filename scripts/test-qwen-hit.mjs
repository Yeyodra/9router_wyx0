import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const result = JSON.parse(readFileSync(path.join(__dirname, "qwen-dot-result.json"), "utf8"));
const KEY = result.apiKey;
const BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// 1. List models
console.log("📋 Fetching model list...");
const modelsRes = await fetch(`${BASE}/models`, {
  headers: { Authorization: `Bearer ${KEY}` },
});
const models = await modelsRes.json();
const ids = (models.data || []).map((m) => m.id);
console.log(`\nTotal models: ${ids.length}`);
ids.slice(0, 20).forEach((id) => console.log(`  ${id}`));
if (ids.length > 20) console.log(`  ... +${ids.length - 20} more`);

// 2. Chat
const chatModel = ids.find((id) => id === "qwen3.5-plus") || ids[0];
console.log(`\n💬 Chatting with: ${chatModel}`);

const chatRes = await fetch(`${BASE}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: chatModel,
    messages: [{ role: "user", content: "Siapa kamu? Jawab singkat 1 kalimat." }],
    max_tokens: 100,
  }),
});
const chat = await chatRes.json();
const reply = chat.choices?.[0]?.message?.content ?? JSON.stringify(chat).slice(0, 300);
const usage = chat.usage ?? {};
console.log(`\n🤖 Reply: ${reply}`);
console.log(`   tokens — prompt: ${usage.prompt_tokens}  completion: ${usage.completion_tokens}  total: ${usage.total_tokens}`);
