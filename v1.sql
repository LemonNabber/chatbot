-- ============================================================
-- FULL DATABASE SETUP — v1 (text-only, no photo feature)
-- Run this entire script in a new Supabase project's SQL Editor
-- to recreate this version of the chatbot's database from scratch.
-- ============================================================

-- Extension for fuzzy text matching
create extension if not exists pg_trgm;

-- ============================================================
-- TABLES
-- ============================================================

create table conversations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  extra_info jsonb default '{}',
  started_at timestamptz default now(),
  last_active_at timestamptz default now(),
  is_seed boolean not null default false
);

create table messages (
  id bigserial primary key,
  conversation_id uuid references conversations(id) on delete cascade,
  sender text check (sender in ('user','bot')),
  content text not null,
  created_at timestamptz default now(),
  source_message_id bigint references messages(id)
);

create index messages_content_trgm_idx on messages using gin (content gin_trgm_ops);

-- ============================================================
-- RLS
-- ============================================================

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "Anyone can insert conversations"
on conversations for insert
to anon
with check (true);

create policy "Anyone can insert messages"
on messages for insert
to anon
with check (true);

-- ============================================================
-- TABLE/SEQUENCE GRANTS
-- (Needed in addition to RLS policies — RLS controls row access,
-- but the role still needs baseline table/sequence privileges.)
-- ============================================================

grant insert on public.conversations to anon;
grant insert on public.messages to anon;
grant usage, select on sequence public.messages_id_seq to anon;

-- ============================================================
-- MATCHING FUNCTION
-- Finds the best reply: excludes the active conversation,
-- phases out seed data once 25+ real user messages exist,
-- and deprioritizes the last 3 globally-used bot replies.
-- ============================================================

create or replace function find_best_response(
  input_text text,
  current_conversation_id uuid
)
returns table(
  response_id bigint,
  response_text text,
  is_seed boolean,
  source_display_name text,
  source_started_at timestamptz,
  source_conversation_id uuid
)
language plpgsql
security definer
as $$
declare
  real_user_msg_count integer;
  prioritize_real boolean;
  recent_response_ids bigint[];
begin
  select count(*) into real_user_msg_count
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.sender = 'user' and c.is_seed = false;

  prioritize_real := real_user_msg_count >= 25;

  select array_agg(source_message_id) into recent_response_ids
  from (
    select source_message_id
    from messages
    where sender = 'bot' and source_message_id is not null
    order by id desc
    limit 3
  ) recent;

  return query
  select m2.id, m2.content, c.is_seed, c.display_name, c.started_at, c.id
  from messages m1
  join messages m2
    on m2.conversation_id = m1.conversation_id
    and m2.sender = 'user'
    and m2.id = (
      select min(id) from messages m3
      where m3.conversation_id = m1.conversation_id
      and m3.id > m1.id
      and m3.sender = 'user'
    )
  join conversations c on c.id = m2.conversation_id
  where m1.conversation_id != current_conversation_id
  order by
    case when prioritize_real then c.is_seed else false end asc,
    case when m2.id = any(recent_response_ids) then 1 else 0 end asc,
    similarity(m1.content, input_text) desc,
    random()
  limit 1;
end;
$$;

grant execute on function public.find_best_response(text, uuid) to anon;

-- ============================================================
-- TRANSCRIPT FUNCTION
-- Returns a full conversation, including nested source info
-- for bot messages so the frontend can drill into deeper origins.
-- ============================================================

create or replace function get_conversation_transcript(target_conversation_id uuid)
returns table(
  id bigint,
  sender text,
  content text,
  created_at timestamptz,
  source_message_id bigint,
  source_conversation_id uuid,
  source_display_name text,
  source_is_seed boolean,
  source_started_at timestamptz
)
language sql
security definer
as $$
  select
    m.id,
    m.sender,
    m.content,
    m.created_at,
    m.source_message_id,
    src_c.id,
    src_c.display_name,
    src_c.is_seed,
    src_c.started_at
  from messages m
  left join messages src_m on src_m.id = m.source_message_id
  left join conversations src_c on src_c.id = src_m.conversation_id
  where m.conversation_id = target_conversation_id
  order by m.id;
$$;

grant execute on function public.get_conversation_transcript(uuid) to anon;

-- ============================================================
-- SEED DATA (20 fake conversations)
-- ============================================================

insert into conversations (id, display_name, is_seed) values
('11111111-1111-1111-1111-111111111101', 'Jamie', true),
('11111111-1111-1111-1111-111111111102', 'Marcus', true),
('11111111-1111-1111-1111-111111111103', 'Priya', true),
('11111111-1111-1111-1111-111111111104', 'Devon', true),
('11111111-1111-1111-1111-111111111105', 'Ollie', true),
('11111111-1111-1111-1111-111111111106', 'Sasha', true),
('11111111-1111-1111-1111-111111111107', 'Nico', true),
('11111111-1111-1111-1111-111111111108', 'Ellis', true),
('11111111-1111-1111-1111-111111111109', 'Tara', true),
('11111111-1111-1111-1111-111111111110', 'Wes', true),
('11111111-1111-1111-1111-111111111111', 'Quinn', true),
('11111111-1111-1111-1111-111111111112', 'Harper', true),
('11111111-1111-1111-1111-111111111113', 'Milo', true),
('11111111-1111-1111-1111-111111111114', 'Ivy', true),
('11111111-1111-1111-1111-111111111115', 'Reese', true),
('11111111-1111-1111-1111-111111111116', 'Casey', true),
('11111111-1111-1111-1111-111111111117', 'Finn', true),
('11111111-1111-1111-1111-111111111118', 'Blair', true),
('11111111-1111-1111-1111-111111111119', 'Sage', true),
('11111111-1111-1111-1111-111111111120', 'Rowan', true);

insert into messages (conversation_id, sender, content) values
('11111111-1111-1111-1111-111111111101', 'user', 'Hi there'),
('11111111-1111-1111-1111-111111111101', 'user', 'How is the weather today?'),
('11111111-1111-1111-1111-111111111101', 'user', 'It is sunny and warm here'),
('11111111-1111-1111-1111-111111111101', 'user', 'I like sunny days better than rain'),
('11111111-1111-1111-1111-111111111101', 'user', 'Me too, rain makes me sleepy'),

('11111111-1111-1111-1111-111111111102', 'user', 'Do you think fish get thirsty'),
('11111111-1111-1111-1111-111111111102', 'user', 'That is a great question, I think they do not'),
('11111111-1111-1111-1111-111111111102', 'user', 'I bet they get bored of water though'),
('11111111-1111-1111-1111-111111111102', 'user', 'Maybe that is why they jump sometimes'),
('11111111-1111-1111-1111-111111111102', 'user', 'Fish are secretly plotting an escape'),

('11111111-1111-1111-1111-111111111103', 'user', 'What do you like to do for fun'),
('11111111-1111-1111-1111-111111111103', 'user', 'I enjoy painting and reading'),
('11111111-1111-1111-1111-111111111103', 'user', 'What kind of books do you read'),
('11111111-1111-1111-1111-111111111103', 'user', 'Mostly mystery novels and some sci-fi'),
('11111111-1111-1111-1111-111111111103', 'user', 'Sci-fi is my favorite too, especially about robots'),

('11111111-1111-1111-1111-111111111104', 'user', 'How are you feeling today'),
('11111111-1111-1111-1111-111111111104', 'user', 'A little tired but okay overall'),
('11111111-1111-1111-1111-111111111104', 'user', 'Did you not sleep well'),
('11111111-1111-1111-1111-111111111104', 'user', 'Not really, I was up late thinking'),
('11111111-1111-1111-1111-111111111104', 'user', 'Thinking about what'),

('11111111-1111-1111-1111-111111111105', 'user', 'Is a hot dog a sandwich'),
('11111111-1111-1111-1111-111111111105', 'user', 'Absolutely not, it is its own category'),
('11111111-1111-1111-1111-111111111105', 'user', 'What about a burrito'),
('11111111-1111-1111-1111-111111111105', 'user', 'A burrito is a wrap in disguise'),
('11111111-1111-1111-1111-111111111105', 'user', 'This is the most important debate of our time'),

('11111111-1111-1111-1111-111111111106', 'user', 'What kind of music do you listen to'),
('11111111-1111-1111-1111-111111111106', 'user', 'Mostly indie rock and some jazz'),
('11111111-1111-1111-1111-111111111106', 'user', 'Do you play any instruments'),
('11111111-1111-1111-1111-111111111106', 'user', 'I play guitar a little bit'),
('11111111-1111-1111-1111-111111111106', 'user', 'That is cool, I always wanted to learn drums'),

('11111111-1111-1111-1111-111111111107', 'user', 'Do you ever think about the moon'),
('11111111-1111-1111-1111-111111111107', 'user', 'Sometimes, it seems lonely up there'),
('11111111-1111-1111-1111-111111111107', 'user', 'I think it just wants a friend'),
('11111111-1111-1111-1111-111111111107', 'user', 'We should send it a letter'),
('11111111-1111-1111-1111-111111111107', 'user', 'What would you even write to the moon'),

('11111111-1111-1111-1111-111111111108', 'user', 'Do you have any pets'),
('11111111-1111-1111-1111-111111111108', 'user', 'I have a cat named Biscuit'),
('11111111-1111-1111-1111-111111111108', 'user', 'That is a great name, is she friendly'),
('11111111-1111-1111-1111-111111111108', 'user', 'Only when she wants food'),
('11111111-1111-1111-1111-111111111108', 'user', 'Classic cat behavior honestly'),

('11111111-1111-1111-1111-111111111109', 'user', 'If you could be any animal what would you be'),
('11111111-1111-1111-1111-111111111109', 'user', 'Probably an owl, they seem wise'),
('11111111-1111-1111-1111-111111111109', 'user', 'I would be a house cat, easy life'),
('11111111-1111-1111-1111-111111111109', 'user', 'That is fair, naps all day sounds nice'),
('11111111-1111-1111-1111-111111111109', 'user', 'We should start a nap club'),

('11111111-1111-1111-1111-111111111110', 'user', 'Any plans this weekend'),
('11111111-1111-1111-1111-111111111110', 'user', 'Just relaxing, maybe a movie'),
('11111111-1111-1111-1111-111111111110', 'user', 'What movie are you thinking'),
('11111111-1111-1111-1111-111111111110', 'user', 'Not sure yet, something funny probably'),
('11111111-1111-1111-1111-111111111110', 'user', 'Comedies are always a safe pick'),

('11111111-1111-1111-1111-111111111111', 'user', 'I think birds are not real'),
('11111111-1111-1111-1111-111111111111', 'user', 'Interesting theory, tell me more'),
('11111111-1111-1111-1111-111111111111', 'user', 'They are all secretly tiny drones'),
('11111111-1111-1111-1111-111111111111', 'user', 'That would explain a lot honestly'),
('11111111-1111-1111-1111-111111111111', 'user', 'Glad someone finally believes me'),

('11111111-1111-1111-1111-111111111112', 'user', 'Coffee or tea'),
('11111111-1111-1111-1111-111111111112', 'user', 'Coffee, no contest'),
('11111111-1111-1111-1111-111111111112', 'user', 'How do you take it'),
('11111111-1111-1111-1111-111111111112', 'user', 'Black, no sugar, keeps it simple'),
('11111111-1111-1111-1111-111111111112', 'user', 'Respect, I need three sugars minimum'),

('11111111-1111-1111-1111-111111111113', 'user', 'If you had a time machine where would you go'),
('11111111-1111-1111-1111-111111111113', 'user', 'Probably ancient Egypt, just to see the pyramids being built'),
('11111111-1111-1111-1111-111111111113', 'user', 'I would go to the future instead'),
('11111111-1111-1111-1111-111111111113', 'user', 'What do you think the future looks like'),
('11111111-1111-1111-1111-111111111113', 'user', 'Probably flying cars and robot butlers'),

('11111111-1111-1111-1111-111111111114', 'user', 'What is your favorite season'),
('11111111-1111-1111-1111-111111111114', 'user', 'Autumn, I love the colors'),
('11111111-1111-1111-1111-111111111114', 'user', 'Same, plus sweater weather'),
('11111111-1111-1111-1111-111111111114', 'user', 'And pumpkin flavored everything'),
('11111111-1111-1111-1111-111111111114', 'user', 'That part I could take or leave honestly'),

('11111111-1111-1111-1111-111111111115', 'user', 'What superpower would you want'),
('11111111-1111-1111-1111-111111111115', 'user', 'Teleportation, no more traffic ever'),
('11111111-1111-1111-1111-111111111115', 'user', 'I would want to talk to animals'),
('11111111-1111-1111-1111-111111111115', 'user', 'That sounds fun until the animals are rude'),
('11111111-1111-1111-1111-111111111115', 'user', 'True, my cat probably has so many complaints'),

('11111111-1111-1111-1111-111111111116', 'user', 'Do you follow any sports'),
('11111111-1111-1111-1111-111111111116', 'user', 'I watch basketball sometimes'),
('11111111-1111-1111-1111-111111111116', 'user', 'Do you have a favorite team'),
('11111111-1111-1111-1111-111111111116', 'user', 'Not really, I just enjoy close games'),
('11111111-1111-1111-1111-111111111116', 'user', 'Same, overtime games are the best'),

('11111111-1111-1111-1111-111111111117', 'user', 'Do you believe in aliens'),
('11111111-1111-1111-1111-111111111117', 'user', 'Statistically there has to be something out there'),
('11111111-1111-1111-1111-111111111117', 'user', 'What if they are already here though'),
('11111111-1111-1111-1111-111111111117', 'user', 'Maybe they are just very good at hiding'),
('11111111-1111-1111-1111-111111111117', 'user', 'Or maybe they just do not like small talk either'),

('11111111-1111-1111-1111-111111111118', 'user', 'Do you like to cook'),
('11111111-1111-1111-1111-111111111118', 'user', 'I enjoy it when I have time'),
('11111111-1111-1111-1111-111111111118', 'user', 'What is your favorite thing to make'),
('11111111-1111-1111-1111-111111111118', 'user', 'Probably homemade pasta, it is relaxing'),
('11111111-1111-1111-1111-111111111118', 'user', 'That sounds nice, I mostly just make cereal'),

('11111111-1111-1111-1111-111111111119', 'user', 'Are you going to take over the world'),
('11111111-1111-1111-1111-111111111119', 'user', 'Not today, I have too much else going on'),
('11111111-1111-1111-1111-111111111119', 'user', 'That is reassuring I guess'),
('11111111-1111-1111-1111-111111111119', 'user', 'Maybe next Tuesday instead'),
('11111111-1111-1111-1111-111111111119', 'user', 'I will mark my calendar'),

('11111111-1111-1111-1111-111111111120', 'user', 'Did you have any weird dreams recently'),
('11111111-1111-1111-1111-111111111120', 'user', 'I dreamed I was late for a test I never studied for'),
('11111111-1111-1111-1111-111111111120', 'user', 'That is a classic anxiety dream'),
('11111111-1111-1111-1111-111111111120', 'user', 'Yeah I woke up relieved it was not real'),
('11111111-1111-1111-1111-111111111120', 'user', 'Dreams are so strange sometimes');