-- Chantier : schéma, droits (seuls les membres du foyer lisent et écrivent), photos, temps réel.

create table members (
  email text primary key,
  name  text not null unique
);

create table rooms (
  id   text primary key default gen_random_uuid()::text,
  name text not null,
  sort int  not null default 100
);

create table tasks (
  id         text primary key default gen_random_uuid()::text,
  title      text not null,
  lot        text not null default '',
  kind       text not null default 'travaux' check (kind in ('travaux', 'decision', 'test')),
  priority   text not null default 'normale' check (priority in ('urgente', 'haute', 'normale', 'basse')),
  minutes    int,                         -- estimation par pièce
  assignee   text,                        -- members.name, ou null
  note       text not null default '',
  depends_on text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by text
);

-- Une ligne par pièce concernée : c'est l'unité qu'on coche.
create table task_rooms (
  task_id text not null references tasks(id) on delete cascade,
  room_id text not null references rooms(id) on delete cascade,
  done_at timestamptz,
  done_by text,
  primary key (task_id, room_id)
);

-- Options d'une décision.
create table options (
  id       text primary key default gen_random_uuid()::text,
  task_id  text not null references tasks(id) on delete cascade,
  label    text not null,
  price    numeric,
  note     text not null default '',
  photo    text,
  chosen   boolean not null default false
);

-- Carnet : notes, essais (recette / verdict / note sur 5), photos. Rattaché à une tâche ou une pièce.
create table entries (
  id         text primary key default gen_random_uuid()::text,
  task_id    text references tasks(id) on delete cascade,
  room_id    text references rooms(id) on delete cascade,
  kind       text not null default 'note' check (kind in ('note', 'essai', 'photo')),
  body       text not null default '',
  recipe     text not null default '',
  verdict    text not null default '',
  rating     int check (rating between 1 and 5),
  photos     text[] not null default '{}',
  author     text,
  created_at timestamptz not null default now()
);

create table shopping (
  id         text primary key default gen_random_uuid()::text,
  label      text not null,
  qty        text not null default '',
  store      text not null default '',
  task_id    text references tasks(id) on delete set null,
  bought_at  timestamptz,
  created_at timestamptz not null default now()
);

-- Sessions de travail (un samedi, une soirée). items = [{task_id, room_id}]
create table sessions (
  id         text primary key default gen_random_uuid()::text,
  day        date not null,
  label      text not null default '',
  items      jsonb not null default '[]',
  created_by text,
  created_at timestamptz not null default now()
);

create table activity (
  id      text primary key default gen_random_uuid()::text,
  at      timestamptz not null default now(),
  who     text,
  verb    text not null,
  label   text not null,
  task_id text
);

-- Droits : un membre est un compte dont l'e-mail figure dans members.
create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

do $$
declare t text;
begin
  foreach t in array array['rooms','tasks','task_rooms','options','entries','shopping','sessions','activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "membres" on %I for all to authenticated using (is_member()) with check (is_member())', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;

alter table members enable row level security;
create policy "membres lisent" on members for select to authenticated using (is_member());

-- Photos : bucket privé, réservé aux membres.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy "photos membres lecture" on storage.objects for select to authenticated using (bucket_id = 'photos' and is_member());
create policy "photos membres ajout" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and is_member());
create policy "photos membres suppression" on storage.objects for delete to authenticated using (bucket_id = 'photos' and is_member());
