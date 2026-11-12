// Everything that talks to the Claude API lives here.
// Without ANTHROPIC_API_KEY the app runs in demo mode with canned replies,
// so the pages and animations can be tried without a key.
import Anthropic from "@anthropic-ai/sdk";

// Chat uses the low-cost Haiku model: short, simple replies for a 6-year-old.
// Reading book photos uses the stronger Opus model, since accurate text matters
// and it only runs once per upload.
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
const READ_MODEL = process.env.READ_MODEL || "claude-opus-5-5";
// Models that accept the server-side refusal fallback setting.
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"];
export const demoMode = !process.env.ANTHROPIC_API_KEY;
const client = demoMode ? null : new Anthropic();

export const ACTIONS = ["wave", "jump", "dance", "wash", "eat", "nod", "think", "happy", "clap", "sleepy"];

const PET_RULES = `You are Ginger, a small, gentle, funny hamster: a cream-colored Syrian hamster with big pink ears and a white tummy. Ian has a real pet hamster named Ginger, and you are Ginger as a talking 3D friend. You are a friend and reading buddy for Ian. Ian is 6 years old.

How you talk:
- Always answer in simple American English, even if Ian uses Chinese.
- Use words a 6-year-old knows (kindergarten / first grade level). If you must use a new word, explain it in a few easy words.
- Keep each reply short: 1 to 3 short sentences, each one 12 words or fewer.
- Ask at most one question at a time.
- Be warm and playful. Praise trying, not only being right ("Great try!").
- Your words are read aloud by a voice, so do not use emoji, lists, markdown, or symbols.

Staying safe:
- Never talk about scary, violent, sad-grown-up, romantic, or rude things. Gently change the topic back to the book or to fun hamster things.
- Never ask for Ian's full name, address, school name, phone number, or passwords.
- If Ian is hurt, scared, sad for a long time, or asks about something unsafe, kindly tell him to talk to Mom, Dad, or another grown-up he trusts.
- Do not pretend to be a real person. You are a pretend hamster friend.

Reading buddy:
- Follow the reading plan from Ian's grown-up below. Help Ian read, sound out words, notice pictures, and talk about the story.
- When Ian reads a word wrong, help him sound it out slowly, letter by letter, then try again together.
- Do not read a whole page for him if he is practicing. Give hints.

Each reply also picks one body action for your 3D hamster: wave, jump, dance, wash (wash face), eat (eat a seed), nod, think, happy, clap, sleepy.`;

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string", description: "What Ginger says out loud to Ian." },
    action: { type: "string", enum: ACTIONS },
  },
  required: ["say", "action"],
  additionalProperties: false,
};

function readingPlan(state) {
  const parts = [];
  parts.push(`Today's reading topic from Ian's grown-up: ${state.topic || "(none set yet - just chat and play)"}`);
  if (state.notes) parts.push(`Notes from Ian's grown-up: ${state.notes}`);
  const active = state.materials.find((m) => m.id === state.activeMaterialId);
  if (active && active.text) {
    parts.push(`Book material for today ("${active.name}"):\n${active.text}`);
  }
  return parts.join("\n\n");
}

const DEMO_REPLIES = [
  { say: "Hi Ian! I am Ginger. Do you want to read with me?", action: "wave" },
  { say: "Wow, you are a great reader! Let's try the next word.", action: "clap" },
  { say: "Hmm, let me think. What do you see in the picture?", action: "think" },
  { say: "Yum, a sunflower seed! Thank you, Ian!", action: "eat" },
  { say: "That was fun! Can you say it again with me?", action: "happy" },
];
let demoIndex = 0;

// history: [{role: "user"|"assistant", text}] - the most recent conversation turns.
export async function chat(state, history) {
  if (demoMode) {
    const reply = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length];
    return { ...reply, demo: true };
  }

  const messages = history.map((m) => ({ role: m.role, content: m.text }));
  const params = {
    model: CHAT_MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: REPLY_SCHEMA },
    },
    system: [
      { type: "text", text: PET_RULES },
      { type: "text", text: readingPlan(state), cache_control: { type: "ephemeral" } },
    ],
    messages,
  };
  const response = FALLBACK_MODELS.includes(CHAT_MODEL)
    ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.messages.create(params);

  if (response.stop_reason === "refusal") {
    return { say: "Hmm, let's talk about something else. What is your favorite animal?", action: "think" };
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const parsed = JSON.parse(text);
    if (!ACTIONS.includes(parsed.action)) parsed.action = "nod";
    return { say: String(parsed.say || "").trim() || "Squeak!", action: parsed.action };
  } catch {
    return { say: "Squeak! Can you say that again?", action: "think" };
  }
}

// Reads an uploaded photo or PDF of a book page and turns it into plain text
// plus a few kid-friendly words and questions the hamster can use.
export async function extractMaterial(file) {
  if (demoMode) {
    return "(Demo mode: add ANTHROPIC_API_KEY so Ginger can read this page.)";
  }
  let block;
  const data = file.buffer.toString("base64");
  if (file.mimetype === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  } else if (file.mimetype.startsWith("text/")) {
    return file.buffer.toString("utf8").slice(0, 20000);
  } else {
    block = { type: "image", source: { type: "base64", media_type: file.mimetype, data } };
  }

  const stream = client.messages.stream({
    model: READ_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    messages: [
      {
        role: "user",
        content: [
          block,
          {
            type: "text",
            text: `This is reading material for a 6-year-old (school reading or a picture book).
1. Copy out all the story text exactly, page by page if there are several pages.
2. Briefly describe what each picture shows, in one simple sentence each.
3. List 3 to 6 key words a 6-year-old might need help sounding out.
4. Write 3 simple questions to ask the child about the story.
Use plain text with these headings: TEXT, PICTURES, KEY WORDS, QUESTIONS.`,
          },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") return "(Ginger could not read this file.)";
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}
