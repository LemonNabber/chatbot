# Cleverbot Clone — Prompt Log

Prompt Log: Cleverbot-style Chatbot (Transparency Project)

Log date: October 7, 2026 Stack: Supabase (Postgres, storage, RPC functions) and an HTML/CSS/JS front end.

Project in one paragraph

A chatbot modeled on Cleverbot that generates nothing. Every bot line is a real user's message from a past conversation, reused recursively. Simple mode hides this so the user can feel they're talking to an individual. Transparent mode shows a receipt for every message: who said it, their photo, their conversation, and further back through the archive. The point is a critique of how modern LLM chatbots are perceived (the Eliza effect, sycophancy, obscured training data).

| # | Prompt (summary) | Result |
|---|---|---|
| 1 | Is the Cleverbot/Evie algorithm public? | Explained it's retrieval-based, not AI/generative; outlined how to build a clone. |
| 2 | How to host dynamically and view the database? | Recommended GitHub Pages + Supabase (Postgres), with schema sketch. |
| 3 | No backend yet, want it free, want per-conversation storage with user/date | Confirmed Supabase free tier works; proposed `conversations` + `messages` schema. |
| 4 | Want ephemeral per-session identity (name only, no login) | Updated schema: `display_name`, `extra_info` jsonb, no auth. |
| 5 | Confirmed: no persistence across refresh (Option A) | Locked in ephemeral design; raised cold-start and first-message questions. |
| 6 | Seed data: yes; bot never speaks first | Confirmed design; outlined build order. |
| 7 | Ready to set up the database first | — |
| 8 | Setting up Supabase project, asked about GitHub schema sync, security toggles | Recommended SQL Editor over GitHub-managed schema for now; explained Data API / RLS toggles. |
| 9 | "Success. No rows returned" after running SQL — did it work? | Confirmed this is normal for DDL; gave 4 verification queries. |
| 10 | Shared anon key, couldn't find Project URL | Located it via the key's JWT payload / Integrations page. |
| 11 | Confirmed API URL page and auth error | Verified setup is correct and live. |
| 12 | Shared verification query results | Confirmed tables, function, RLS policies, and extension all correctly in place. |
| 13 | Ready for seed data: mix of small talk and silly, 20 conversations | Generated `seed_data.sql` — 20 fake conversations, ~100 messages. |
| 14 | Seed data loaded successfully | — |
| 15 | How does `find_best_response` work? | Walked through the trigram-matching SQL logic step by step. |
| 16 | Raised issue: recycled bot lines should also be usable as match triggers, with source tracking | Redesigned function to allow any sender as trigger (`m1`); proposed `source_message_id` column. |
| 17 | Randomize among tied top matches | Added `random()` as secondary sort key. |
| 18 | Function update failed (return type change) | Explained need to `DROP FUNCTION` before `CREATE OR REPLACE`. |
| 19 | Add source tracking | Added `source_message_id` column + explained frontend insert pattern. |
| 20 | Can the full original conversation be traced from a bot message? | Confirmed yes via `source_message_id → conversation_id`; noted multi-hop caveat. |
| 21 | Seed data should stop being used as replies once real data exists | Added `is_seed` flag + excluded seed from being returned as `m2`. |
| 22 | Clarified: seed should be deprioritized, not hard-excluded, until real alternatives exist | Rewrote ordering to rank `is_seed` before similarity, so real data wins immediately once available. |
| 23 | Build the frontend, minimal, show bot's source (seed or user name) | Built `index.html`: name form + chat, Supabase JS client, source labels. |
| 24 | Runtime error: duplicate `supabase` variable; "nothing is saved" copy was misleading | Renamed client variable; fixed UI copy. |
| 25 | 401 error on conversations insert | Diagnosed missing `SELECT` triggered by `.select().single()`; switched to client-generated UUIDs. |
| 26 | Still 401 on conversations insert | Identified missing base `GRANT INSERT` (separate from RLS); added grants for both tables + function. |
| 27 | 401 on messages insert (sequence) | Granted `USAGE, SELECT` on `messages_id_seq`. |
| 28 | Exclude the user's own live conversation from matching; show source date | Added `current_conversation_id` param to exclude self-matches; added `started_at` to output and UI. |
| 29 | Provided anon key to hardcode | Inserted key directly into `index.html`. |
| 30 | Delete all real data; keep seed data until 25 real user messages, then prioritize real | Added real-message counter + threshold logic (`plpgsql`) to the matching function. |
| 31 | Let users click a bot message to view its source conversation | Added `get_conversation_transcript` function + modal UI. |
| 32 | Show the real user's name instead of "User" in the transcript | Passed `display_name` into the modal instead of generic label. |
| 33 | Add a toggle between plain chat view and a "see sources" view | Added `show-sources` mode toggle controlling visibility/clickability via CSS class. |
| 34 | Modal should show user's name, not "user" | Already satisfied by #32; confirmed. |
| 35 | Allow drilling into nested bot-message sources recursively, with Back button; seed = dead end | Extended transcript function with nested source columns; added navigation stack + Back button. |
| 36 | Fixed drop/create ordering error for transcript function | Clarified running statements together in one script. |
| 37 | Deprioritize bot messages reused in the last 3 replies | Added recency check against last 3 `source_message_id`s in sort order. |
| 38 | Highlight user lines grey; show "You" in live chat | Added `.user-line` grey styling; confirmed "You" labeling already existed. |
| 39 | Does `find_best_response` use AI? | Explained it's pure trigram similarity (`pg_trgm`), no ML/LLM involved. |
| 40 | Add a required photo of each user, tied to their conversation | Flagged privacy/moderation considerations; added Storage bucket, `photo_path` column, camera capture UI, avatar thumbnails in chat and transcript modal. |
| 41 | Make the photo step non-skippable | Removed skip link; "Use this photo" is now the only way to proceed. |
| 42 | How to clear the data? | Gave SQL to delete real conversations/seed data. |
| 43 | Deletion of storage objects failed (SQL blocked) | Explained Storage API restriction; gave dashboard and scripted (JS) alternatives. |
| 44	| Shared project philosophy, v1 schema, photo-feature SQL, and current index.html	| Reviewed the setup. Flagged gaps: camera failure traps the user, seed conversations have no photos, orphaned uploads, no avatar on own messages. Listed design decisions (public photos, simple vs. transparent mode, graph).
| 45	| In transparent mode, show own face top right and contributor faces on bot messages; archived conversations use the same layout | Gave front-end-only changes (no SQL needed), reusing source_photo_path. Added avatar helpers, corner display for the chatting user, per-line contributor avatars, and initial placeholders for seed users.
| 46 |	Update the code	Produced the full updated index.html with all changes merged.
| 47 |	Replicate the UI from photos	No images came through; asked for a re-upload.
| 48 | Match the supplied screenshots: dreamy desktop, pixel titles, profile flow, normal/transparent chat, and dark recursive archives; any questions before building? | Established the visual and interaction requirements, including synchronized contributor selection and camera dithering. |
| 49 | Add the TTF font placed in the folder. | Loaded local Chikarego for decorative titles. |
| 50 | Implement the agreed UI changes. | Built the desktop window, onboarding, two chat views, contributor sidebar, and dark archive navigation. |
| 51 | Crop seed profile pictures from the supplied 3×3 image; increase dither contrast and add a threshold. | Used random seed portrait crops and added stronger contrast with thresholding. |
| 52 | Use bot.png; increase dither resolution; store original profile images for future filter changes. | Added the bot asset, finer dithering, and original-image storage with display-time filtering. |
| 53 | Filter the bot image, use intermediate dot sizes, and remove the threshold. | Applied the shared effect to the bot and adjusted dot spacing without thresholding. |
| 54 | Restore the threshold and the original larger pixels. | Restored thresholding and coarser dots. |
| 55 | Make thumbnails image-only; hovering should preview that user's profile card. | Removed thumbnail captions and added hover previews. |
| 56 | Scale the number of dots with image pixel size. | Made dither resolution adapt to rendered portrait size. |
| 57 | Keep starting windows near 5:4 and chat windows near 9:6; adapt gradually to unusual viewport shapes. | Requested proportional window sizing with gradual aspect-ratio adjustment. |
| 58 | Clarify that ratios should change only on dramatically wide or narrow viewports. | Refined responsive window sizing around the default ratios. |
| 59 | Make message bars thinner and text smaller; match sender size and lighten bot captions. | Reduced message sizing and distinguished bot sender labels with lighter grey. |
| 60 | Fit whole messages in the feed and ease-scroll to the closest aligned set. | Added whole-message height fitting and scroll snapping. |
| 61 | Delay snapping 0.25 seconds, animate for about 1 second, and interrupt on renewed scrolling. | Added delayed, eased snapping that cancels on user input. |
| 62 | Why is window scaling jittery? | Raised the resize-jitter issue for investigation. |
| 63 | Clarify that the jitter is in the text/message window. | Focused the investigation on feed measurement and resizing. |
| 64 | Resize only from the top; keep the composer fixed, use a maximum feed height, and minimize cropped messages and jitter. | Anchored the feed bottom and fitted whole-message groups beneath a fixed height cap. |
| 65 | Fix the thin sliver of a message showing at the top. | Corrected boundary alignment and fractional-height clipping. |
| 66 | Restore the profile-to-chat window transition animation. | Restored the onboarding window resize transition. |
| 67 | Why does resizing still jitter after calculation is finished? | Continued refining measurement and animation coordination for smoother feed resizing. |
| 68 | Remove the composer underline and enter icon; slide in new messages and fade-type bot letters. | Simplified the composer, added message entrance animations, and animated bot text letter by letter. |
| 69 | Fit the maximum whole-message group below a fixed cap, starting from the nearest bottom-aligned message. | Refined feed fitting to use the fixed maximum height and bottom anchor. |
| 70 | Match composer text size to messages. | Applied the message font size to the input. |
| 71 | Match archived-conversation button text and bubble height to messages. | Matched archive-link typography and bar height. |
| 72 | Keep a selected message visible after snapping when more than half is already visible. | Added selected-message preservation to snap alignment. |
| 73 | If the selected message would be topmost, include the preceding user prompt. | Adjusted snapping to retain the selected reply's prompting message. |
| 74 | Give the eye button the window glow; pulse Begin Session and slow opacity hover transitions. | Added eye glow, a slow brightness pulse, and longer eased hover fades. |
| 75 | Increase the visible feed maximum slightly and move pictures upward. | Adjusted the visible feed cap and portrait placement. |
| 76 | Increase that maximum about 25% more. | Increased the requested feed-height allowance. |
| 77 | Correction: restore visible mode and increase obscured mode by 25% instead. | Reverted the visible adjustment and enlarged the obscured feed cap. |
| 78 | Use a 3×3 thumbnail grid and remove unselected outlines. | Changed the contributor grid to three columns with selection-only outlines. |
| 79 | Make the thumbnail grid as wide as its profile card. | Expanded the grid to the full sidebar width. |
| 80 | Animate the message column shrinking/growing between views and sequence other element fades. | Added coordinated mode-transition geometry and detail fades. |
| 81 | Explain before coding: keep the same feed visible, pin its bottom message, and reveal selection only after the switch. | Clarified the intended continuous column movement and delayed selected-photo reveal. |
| 82 | Collapse selection during the reverse switch; slide the composer instead of fading it. | Kept feed and composer visible during movement and collapsed the source photo on exit. |
| 83 | Keep message padding consistent between modes. | Unified message spacing across both views. |
| 84 | Reveal selected portraits by cropping/sliding, not scaling; use the same animation for manual selection. | Added fixed-size portrait reveals and shared automatic/manual selection animation. |
| 85 | Pulse archive links like Begin Session and fade them in near the end of selection expansion. | Added archive-link brightness pulses and delayed eased fades. |
| 86 | Show a new visible-mode bot reply normally first, then select it and close the previous selection. | Delayed contributor expansion until the reply's entrance and typing finished. |
| 87 | Make the bot hop briefly when speaking in obscured mode. | Added a small portrait hop animation. |
| 88 | Scale bot hops with text length; hop the user once per submit in either view; make the obscured bot black. | Added length-based bot hops, user submission hops, and full bot-image opacity. |
| 89 | Fix profile-screen overlap and small notes; keep the camera blank while permission is pending. | Reworked onboarding layout and text sizes; added a blank waiting camera state. |
| 90 | Bottom-align the 3×3 thumbnail grid. | Anchored the grid to the bottom of the contributor column. |
| 91 | Clicking an open reply should collapse its photo while preserving sidebar selection. | Added collapse toggling without changing the selected contributor. |
| 92 | Reveal the profile card first, then fade thumbnails in individually; repeat across visible conversations and archives. | Added a staggered sidebar reveal for mode switches and archive navigation. |
| 93 | Continue the interrupted work. | Continued the sidebar reveal work and adjusted its timing to start after portrait preparation. |
| 94 | Tighten letter spacing in Chikarego text. | Changed decorative-title spacing from 0.015em to -0.025em. |
| 95 | Reduce the large gap around the apostrophe in WHAT’S. | Added -0.12em margins around that title apostrophe. |
| 96 | Update the log with each prompt from 48 onward, using concise prompts and results. | Added entries 48–96 and updated the log date and front-end description. |
