# Bot Friend

A chatbot modeled on Cleverbot, built as a critique of how modern AI chatbots are presented and used.

Nothing the bot says is generated. Every reply is a message a real person typed in an earlier conversation, reused as the bot's answer in a new one. The bot has no voice of its own. It reflects the people who talked to it.

---

## Why this exists

Chatbots that present as individuals invite the **Eliza effect**: people attribute feelings, understanding, and intelligence to a program. That can lead to unhealthy attachment, AI psychosis, and misplaced trust. Interfaces that hide how a model works make it worse, and a "smart individual" is profitable.

Modern chatbots also separate the model from the human data it was trained on. That gives the model an authority no single person would have, and it distances the system from the biases in its data. Users are part of that data too (for example, picking the response they prefer during reinforcement learning), but the interface doesn't show it.

Bot Friend makes the parallel visible. Cleverbot is simpler than a modern LLM, but it works on a similar principle: the bot is a reflection of its data, not an individual. Here that is literal. Every line was written by a person, and it stays attributed to them even when taken out of context.

## Two modes

**Simple mode.** The interface hides how the bot works. The user's face sits on one side, the bot has a single placeholder face on the other, and the conversation feels like talking to one individual.

**Transparent mode.** Everything is laid out.

- Every bot message has a receipt: who wrote it, and when.
- The bot's single face breaks apart into the photos of the people behind its replies.
- Clicking a bot message opens the original conversation it came from. Bot messages inside that conversation can be opened too, so a user can trace a line back through the archive as far as they want.
- Each person who contributed to the current conversation appears in a thumbnail grid. Selecting a message or a thumbnail updates the profile card, highlights that person, and opens their photo above their message.
- A graph view (planned) shows each conversation as a node, so the user can see where they sit in the data.

Each user makes an avatar at the start of the conversation. It is a conceptual face, shown as a black and white dot-dithered photo, that personifies the data.

---

## How the bot works

1. The user sends a message. It is saved to `messages`.
2. The database function `find_best_response` finds past messages in *other* conversations that are most similar to the input, using trigram similarity (`pg_trgm`).
3. For the best match, the bot replies with the **next thing a user said** in that conversation.
4. The reply is saved with `source_message_id` pointing at the original message. That pointer makes every reply traceable.

Ranking rules in `find_best_response`:

- The active conversation is excluded, so the bot never quotes you back to yourself.
- **Seed data is phased out.** Seed conversations are deprioritized once 25 real user messages exist.
- The last 3 reused replies are deprioritized, to reduce repetition.
- Ties are broken randomly.

This is pure text similarity. There is no machine learning, language model, or generation involved.

---

## Tech stack

- **Frontend:** a single static `index.html` (vanilla JS, no build step)
- **Backend:** [Supabase](https://supabase.com) (Postgres, Storage, Row Level Security)
- **Hosting:** any static host, such as GitHub Pages
- **Client library:** `@supabase/supabase-js` v2 from a CDN

---

## Data model

| Table | Purpose |
|---|---|
| `conversations` | One row per session: `display_name`, `photo_path`, `extra_info` (jsonb), `started_at`, `last_active_at`, `is_seed` |
| `messages` | Every message: `conversation_id`, `sender` (`user` or `bot`), `content`, `source_message_id` |

| Function | Purpose |
|---|---|
| `find_best_response(input_text, current_conversation_id)` | Returns the best reply plus its source (name, date, conversation, photo) |
| `get_conversation_transcript(target_conversation_id)` | Returns a full conversation, with source info for each bot message so the UI can drill deeper |

Both functions run as `security definer`. The anonymous role can insert conversations and messages, and can call these two functions, but it has no direct read access to the tables.

**Storage:** a public bucket named `conversation-photos` holds one JPEG per conversation, named `<conversation-id>.jpg`.

---

## Setup

### 1. Create a Supabase project
A free tier project is enough.

### 2. Run the base schema
In the SQL Editor, run the full setup script (v1). It creates the extension, tables, RLS policies, grants, both functions, and 20 seed conversations.

### 3. Add the photo feature
Run these in order:

```sql
alter table conversations add column photo_path text;

create policy "Anyone can upload conversation photos"
on storage.objects for insert
to anon
with check (bucket_id = 'conversation-photos');
```

Then re-create the two functions with the `source_photo_path` column added (drop each first, since the return type changes):

- `find_best_response(text, uuid)`
- `get_conversation_transcript(uuid)`

Run each `drop function` together with its `create function` in the same script, and re-run the `grant execute ... to anon` lines.

### 4. Create the storage bucket
In Supabase, go to Storage and create a bucket named **`conversation-photos`**. Make it **public**, because the frontend reads photos with `getPublicUrl`.

### 5. Configure the frontend
In `index.html`, set your project values:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

The anon key is designed to be public, but only because Row Level Security and the grants above restrict what it can do. Never put a `service_role` key in the frontend.

### 6. Deploy
Commit `index.html` and enable GitHub Pages, or open it locally. The camera step needs HTTPS or `localhost`.

---

## Clearing data

- **Database rows:** delete from `conversations` where `is_seed = false`. Messages cascade.
- **Photos:** SQL can't delete storage objects. Use the Storage dashboard, or a script using the Storage API.

---

## Project status

**Working now**

- Name entry, required camera photo, and chat
- Retrieval-based replies with source tracking
- Seed data phase-out and recency deprioritization
- Source toggle, clickable bot messages, nested archive navigation with Back
- Contributor avatars in the chat and in archived conversations

**Planned**

- Full UI redesign: an early-web, Frutiger Aero desktop with a blurred sky wallpaper and the chat inside an app window
  - Fonts: Doto for body text, a pixel font for titles
  - Dot-dither filter on the camera and the saved profile photo
  - Profile creation and "profile created" ID card screens
  - Transparent mode with a pinned profile card and a thumbnail grid of contributors
  - Dark-mode archive view
- Generated placeholder faces for seed users
- A fallback avatar when the camera is unavailable
- The conversation graph view
- Optional profile field(s) stored in `extra_info`

---

## Known limitations and open questions

- **Public face photos.** Photos are visible to anyone using the bot, including through other people's conversations. The consent text says so, but there is currently no way for someone to request removal other than contacting the project owner. A deletion path is worth adding.
- **Minors.** If the audience could include minors, consider a notice or age gate before photo capture.
- **Moderation.** User messages are replayed verbatim to other users. There is no filtering.
- **Orphaned photos.** If a photo uploads but the conversation insert fails, the file stays in the bucket.
- **Camera failure.** The photo step is required, and the current error text mentions skipping, which isn't possible yet.
- **Seed users have no photos.** They currently show an initial instead of a face.
- **Ephemeral sessions.** There are no accounts. A conversation can't be resumed after a refresh.

---

## Files

| File | Description |
|---|---|
| `index.html` | Frontend entry point and screen markup: landing, profile creation, chat, and archive controls. Loads the stylesheet, app script, Google Fonts Doto, and the Supabase JS client from a CDN. |
| `app.js` | Application state and behavior: Supabase configuration, session creation, original-photo uploads, camera capture, adaptive dot dithering, reply retrieval, contributor selection, recursive archives, feed sizing/snapping, and animations. |
| `styles.css` | Desktop wallpaper and window styling, responsive layouts, normal/transparent and dark archive views, typography, and visual transitions. Defines the local Chikarego font. |
| `ChiKareGo2.ttf` | Local pixel font used for decorative titles. |
| `bot.png` | Bot portrait source; the shared dither effect is applied when displayed. |
| `seed data profile pic.png` | 3×3 portrait sheet used to create randomly cropped seed-user profile images. |
| `prompt_log.md` | Numbered development prompts and concise results. |
| `readme.md` | Project overview, architecture, backend setup, and usage notes. |

The frontend is served as static files with no build step or local backend server. Supabase provides the database, photo storage, and response/transcript RPC functions; their SQL definitions are managed outside this folder. Captured original profile images are uploaded to Supabase Storage, while the dithered versions are rendered in the browser.
