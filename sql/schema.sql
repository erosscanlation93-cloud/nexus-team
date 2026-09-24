-- =========================================================
--  Nexus Team – esquema de base de datos
--  Ejecutar completo en Supabase → SQL Editor → Run
-- =========================================================

-- Series del scan (una por canal de Discord)
create table public.series (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  sinopsis      text,
  tipo          text not null,            -- Manhwa, Manga, Manhua, Doujinshi, Novela
  clasificacion text not null,            -- +15, +18
  link          text,                     -- link de la serie en la web (/link)
  portada_url   text,
  rol_id        text,                     -- IDs de Discord
  canal_id      text unique,
  hilo_id       text,
  categoria_id  text,
  activa        boolean not null default true,
  creado_por    text,
  creado_en     timestamptz not null default now()
);

-- Colaboradores (se actualiza su nombre cada vez que registran)
create table public.colaboradores (
  discord_id     text primary key,
  nombre         text not null,
  actualizado_en timestamptz not null default now()
);

-- Trabajo registrado: una fila por capítulo + rol + persona
create table public.registros (
  id          bigint generated always as identity primary key,
  serie_id    uuid not null references public.series(id) on delete cascade,
  capitulo    numeric(7,1) not null,     -- admite capítulos como 12.5
  rol         text not null,             -- TL, CL, RD, TP...
  discord_id  text not null references public.colaboradores(discord_id),
  link        text,
  creado_en   timestamptz not null default now(),
  unique (serie_id, capitulo, rol, discord_id)
);
create index registros_semana_idx on public.registros (creado_en);
create index registros_serie_cap_idx on public.registros (serie_id, capitulo);

-- Imágenes del hilo "Anuncios" (una imagen puede cubrir un rango)
create table public.imagenes_anuncio (
  id            bigint generated always as identity primary key,
  serie_id      uuid not null references public.series(id) on delete cascade,
  cap_desde     numeric(7,1) not null,
  cap_hasta     numeric(7,1) not null,
  imagen_url    text not null,           -- copia guardada en Supabase Storage
  mensaje_id    text,
  subido_por    text,
  creado_en     timestamptz not null default now()
);
create index imagenes_serie_idx on public.imagenes_anuncio (serie_id, cap_desde, cap_hasta);

-- Capítulos ya anunciados en la comunidad (evita anunciar dos veces)
create table public.publicaciones (
  id             bigint generated always as identity primary key,
  serie_id       uuid not null references public.series(id) on delete cascade,
  capitulo       numeric(7,1) not null,
  publicado_por  text,
  mensaje_url    text,
  publicado_en   timestamptz not null default now(),
  unique (serie_id, capitulo)
);

-- Seguridad: RLS activado sin políticas = nadie accede con la clave pública.
-- El bot usa la clave secreta (service_role), que sí tiene acceso.
alter table public.series            enable row level security;
alter table public.colaboradores     enable row level security;
alter table public.registros         enable row level security;
alter table public.imagenes_anuncio  enable row level security;
alter table public.publicaciones     enable row level security;

-- Bucket público para portadas e imágenes de anuncio
insert into storage.buckets (id, name, public)
values ('imagenes', 'imagenes', true)
on conflict (id) do nothing;