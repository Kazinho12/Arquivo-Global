-- F4.2-C. Additive snapshots and public delivery; install only after verified F4.2-B.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.save_visual_chapter(uuid,integer,uuid,integer,text,text,jsonb,jsonb,uuid)') IS NULL THEN RAISE EXCEPTION 'F4.2-B required'; END IF;
END $$;
-- Server activation gate remains OFF on installation. No public feature is activated here.
ALTER TABLE public.editorial_media_settings ADD COLUMN public_reading_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.published_works ADD COLUMN visual_settings jsonb CHECK(visual_settings IS NULL OR (
 type IN ('HQ / Comic','Mangá') AND jsonb_typeof(visual_settings)='object'
 AND visual_settings ?& ARRAY['format','mode','direction'] AND (visual_settings-ARRAY['format','mode','direction'])='{}'::jsonb
 AND jsonb_typeof(visual_settings->'format')='string' AND jsonb_typeof(visual_settings->'mode')='string' AND jsonb_typeof(visual_settings->'direction')='string'
 AND visual_settings->>'format' IN ('hq','manga','webtoon','webcomic') AND visual_settings->>'mode' IN ('paged','vertical')
 AND visual_settings->>'direction' IN ('ltr','rtl') AND (visual_settings->>'format'<>'webtoon' OR visual_settings->>'mode'='vertical')));
GRANT SELECT(visual_settings) ON public.published_works TO anon,authenticated;
CREATE TABLE public.published_visual_pages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_id uuid NOT NULL REFERENCES public.published_work_entries(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES public.editorial_assets(id),
 position integer NOT NULL CHECK(position>0), width integer NOT NULL CHECK(width BETWEEN 1 AND 16384),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 65535), CHECK(width::bigint*height<=40000000), UNIQUE(entry_id,position)
);
CREATE INDEX published_visual_pages_asset ON public.published_visual_pages(asset_id);
ALTER TABLE public.published_visual_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.published_visual_pages FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,entry_id,position,width,height) ON public.published_visual_pages TO anon,authenticated;
CREATE POLICY published_visual_pages_read ON public.published_visual_pages FOR SELECT TO anon,authenticated USING(EXISTS(
 SELECT 1 FROM public.published_work_entries e JOIN public.published_works p ON p.id=e.publication_id WHERE e.id=entry_id AND p.is_public));
CREATE FUNCTION public.guard_published_visual_page() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE asset public.editorial_assets%ROWTYPE; owner uuid; kind text;
BEGIN
 SELECT w.owner_id,e.entry_type INTO owner,kind FROM public.published_work_entries e JOIN public.published_works p ON p.id=e.publication_id JOIN public.works w ON w.id=p.work_id WHERE e.id=NEW.entry_id;
 SELECT * INTO asset FROM public.editorial_assets WHERE id=NEW.asset_id FOR UPDATE;
 IF NOT FOUND OR owner IS NULL OR kind<>'visual' OR asset.owner_id<>owner OR asset.state<>'ready' OR asset.width<>NEW.width OR asset.height<>NEW.height THEN RAISE EXCEPTION 'Invalid visual snapshot' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER published_visual_page_guard BEFORE INSERT OR UPDATE ON public.published_visual_pages FOR EACH ROW EXECUTE FUNCTION public.guard_published_visual_page();
REVOKE EXECUTE ON FUNCTION public.guard_published_visual_page() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.block_unreleased_visual_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.status='published' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.published_revision IS DISTINCT FROM OLD.published_revision)
 AND (NEW.visual_settings IS NOT NULL OR EXISTS(SELECT 1 FROM public.visual_pages v JOIN public.work_entries e ON e.id=v.entry_id WHERE e.work_id=NEW.id))
 AND NOT COALESCE((SELECT public_reading_enabled FROM public.editorial_media_settings WHERE id=true),false) THEN
 RAISE EXCEPTION 'Visual publication is not enabled' USING ERRCODE='55000'; END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.publish_private_work(p_work_id uuid,p_revision integer,p_action text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  source public.works%ROWTYPE;
  receipt public.work_operation_receipts%ROWTYPE;
  fingerprint text;
  published_time timestamptz := pg_catalog.now();
  expected_kind text;
  display_label text;
  username_label text;
  visual_publication boolean;
BEGIN
  IF actor IS NULL OR p_work_id IS NULL OR p_revision IS NULL OR p_operation_id IS NULL
    OR p_action IS NULL OR p_action NOT IN ('publish','withdraw') THEN
    RAISE EXCEPTION 'Authenticated publication required' USING ERRCODE = '42501';
  END IF;
  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'publication:' || p_work_id::text || ':' || p_revision::text || ':' || p_action,'UTF8')),'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_operation_id::text,0));
  SELECT * INTO receipt FROM public.work_operation_receipts WHERE owner_id = actor AND operation_id = p_operation_id;
  IF FOUND THEN
    IF receipt.fingerprint <> fingerprint THEN RAISE EXCEPTION 'Operation key reused' USING ERRCODE = '22023'; END IF;
    RETURN pg_catalog.jsonb_build_object('work',public.read_private_work(receipt.result_work_id),'already_applied',true);
  END IF;
  SELECT * INTO source FROM public.works WHERE id = p_work_id AND owner_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work unavailable' USING ERRCODE = '42501'; END IF;
  IF source.revision <> p_revision THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE = '40001'; END IF;
  IF p_action = 'publish' THEN
    IF source.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore before publication' USING ERRCODE = '55000'; END IF;
    IF source.title !~ '[^[:space:]]' OR source.description !~ '[^[:space:]]'
      OR pg_catalog.lower(pg_catalog.btrim(source.description)) = 'sem sinopse definida.'
      OR source.language !~ '[^[:space:]]' OR source.type NOT IN ('Romance','Conto','Poesia','HQ / Comic','Mangá')
      OR source.age_rating NOT IN ('Livre','+12','+14','+16','+18') THEN
      RAISE EXCEPTION 'Valid title, synopsis, format, language and age rating required' USING ERRCODE = '23514';
    END IF;
    expected_kind := CASE source.type WHEN 'Poesia' THEN 'poem' WHEN 'HQ / Comic' THEN 'visual' WHEN 'Mangá' THEN 'visual' ELSE 'chapter' END;
    visual_publication := source.visual_settings IS NOT NULL;
    IF visual_publication THEN
      IF source.type NOT IN ('HQ / Comic','Mangá') OR NOT COALESCE((SELECT public_reading_enabled FROM public.editorial_media_settings WHERE id=true),false) THEN
        RAISE EXCEPTION 'Visual publication is not enabled' USING ERRCODE='55000';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM public.work_entries e JOIN public.visual_pages v ON v.entry_id=e.id WHERE e.work_id=source.id AND e.entry_type='visual')
      OR EXISTS(SELECT 1 FROM public.work_entries e JOIN public.visual_pages v ON v.entry_id=e.id JOIN public.editorial_assets a ON a.id=v.asset_id
         WHERE e.work_id=source.id AND (e.entry_type<>'visual' OR e.title !~ '[^[:space:]]' OR a.owner_id<>actor OR a.state<>'ready')) THEN
        RAISE EXCEPTION 'At least one valid visual chapter with ready images is required' USING ERRCODE='23514';
      END IF;
      -- Match the deletion/association lock: no asset may enter deleting during snapshot creation.
      PERFORM a.id FROM public.editorial_assets a WHERE a.id IN(SELECT v.asset_id FROM public.visual_pages v JOIN public.work_entries e ON e.id=v.entry_id WHERE e.work_id=source.id) ORDER BY a.id FOR UPDATE;
    ELSE
      IF EXISTS(SELECT 1 FROM public.visual_pages v JOIN public.work_entries e ON e.id=v.entry_id WHERE e.work_id=source.id) THEN
        RAISE EXCEPTION 'Visual settings required' USING ERRCODE='23514';
      END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_entries WHERE work_id = source.id AND content ~ '[^[:space:]]' AND entry_type = expected_kind)
      OR EXISTS (SELECT 1 FROM public.work_entries WHERE work_id = source.id AND content ~ '[^[:space:]]' AND (entry_type <> expected_kind OR title !~ '[^[:space:]]')) THEN
      RAISE EXCEPTION 'At least one valid entry matching the format is required' USING ERRCODE = '23514';
    END IF;
    END IF;
    -- Only fields already intended for public profiles; no Auth metadata/email fallback.
    IF pg_catalog.to_regclass('public.profiles') IS NOT NULL THEN
      SELECT display_name,username INTO display_label,username_label FROM public.profiles WHERE id = actor;
    END IF;
    UPDATE public.works SET status = 'published',visibility = 'public',
      first_published_at = COALESCE(first_published_at,published_time),last_published_at = published_time,
      withdrawn_at = NULL,published_revision = source.revision+1 WHERE id = source.id;
    INSERT INTO public.published_works(id,work_id,slug,title,subtitle,description,type,genre,language,age_rating,tags,
      content_warnings,cover_accent_color,cover_style,cover_seed,cover_image,visual_settings,author_name,author_username,first_published_at,last_published_at,is_public)
      VALUES(source.public_id,source.id,source.slug,source.title,source.subtitle,source.description,source.type,source.genre,
        source.language,source.age_rating,source.tags,source.content_warnings,source.cover_accent_color,source.cover_style,source.cover_seed,source.cover_image,source.visual_settings,display_label,username_label,
        COALESCE(source.first_published_at,published_time),published_time,true)
      ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,subtitle=EXCLUDED.subtitle,description=EXCLUDED.description,
        type=EXCLUDED.type,genre=EXCLUDED.genre,language=EXCLUDED.language,age_rating=EXCLUDED.age_rating,tags=EXCLUDED.tags,
        content_warnings=EXCLUDED.content_warnings,cover_accent_color=EXCLUDED.cover_accent_color,cover_style=EXCLUDED.cover_style,cover_seed=EXCLUDED.cover_seed,cover_image=EXCLUDED.cover_image,visual_settings=EXCLUDED.visual_settings,
        author_name=EXCLUDED.author_name,author_username=EXCLUDED.author_username,last_published_at=EXCLUDED.last_published_at,is_public=true;
    DELETE FROM public.published_work_entries WHERE publication_id = source.public_id;
    INSERT INTO public.published_work_entries(id,publication_id,title,content,entry_type,position,alignment)
      SELECT e.public_id,source.public_id,e.title,CASE WHEN visual_publication THEN '' ELSE e.content END,e.entry_type,e.position,e.alignment FROM public.work_entries e
      WHERE e.work_id=source.id AND ((visual_publication AND EXISTS(SELECT 1 FROM public.visual_pages v WHERE v.entry_id=e.id)) OR (NOT visual_publication AND e.content ~ '[^[:space:]]')) ORDER BY e.position;
    IF visual_publication THEN
      INSERT INTO public.published_visual_pages(entry_id,asset_id,position,width,height)
      SELECT e.public_id,v.asset_id,v.position,a.width,a.height FROM public.work_entries e JOIN public.visual_pages v ON v.entry_id=e.id JOIN public.editorial_assets a ON a.id=v.asset_id WHERE e.work_id=source.id ORDER BY e.position,v.position;
    END IF;
  ELSE
    IF source.status = 'published' THEN
      UPDATE public.published_works SET is_public = false WHERE work_id = source.id;
      UPDATE public.works SET status='draft',visibility='private',withdrawn_at=published_time WHERE id=source.id;
    END IF;
  END IF;
  INSERT INTO public.work_operation_receipts(owner_id,operation_id,fingerprint,result_work_id)
    VALUES(actor,p_operation_id,fingerprint,source.id);
  RETURN pg_catalog.jsonb_build_object('work',public.read_private_work(source.id));
END;
$$;
CREATE OR REPLACE FUNCTION public.read_public_work(p_public_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT pg_catalog.jsonb_build_object(
   'id',p.id,'slug',p.slug,'title',p.title,'subtitle',p.subtitle,'description',p.description,
   'type',p.type,'genre',p.genre,'language',p.language,'age_rating',p.age_rating,'tags',p.tags,
   'content_warnings',p.content_warnings,'cover_accent_color',p.cover_accent_color,'cover_style',p.cover_style,'cover_seed',p.cover_seed,'cover_image',p.cover_image,
   'visual_settings',p.visual_settings,'author_name',p.author_name,'author_username',p.author_username,
   'first_published_at',p.first_published_at,'last_published_at',p.last_published_at,
   'entries',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,'publication_id',e.publication_id,
        'title',e.title,'content',e.content,'entry_type',e.entry_type,'position',e.position,'alignment',e.alignment,'visual_page_count',(SELECT count(*) FROM public.published_visual_pages v WHERE v.entry_id=e.id)) ORDER BY e.position)
      FROM public.published_work_entries e WHERE e.publication_id = p.id),'[]'::jsonb))
 FROM public.published_works p WHERE p.id = p_public_id AND p.is_public;
$$;
CREATE OR REPLACE FUNCTION public.begin_delete_editorial(p_asset_id uuid,p_worker_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE asset public.editorial_assets%ROWTYPE;BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 SELECT * INTO asset FROM public.editorial_assets WHERE id=p_asset_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF asset.state='pending' AND asset.created_at>pg_catalog.now()-interval '24 hours' THEN RAISE EXCEPTION 'Upload is in flight' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.visual_pages WHERE asset_id=asset.id) OR EXISTS(SELECT 1 FROM public.published_visual_pages WHERE asset_id=asset.id) THEN RAISE EXCEPTION 'Image still referenced' USING ERRCODE='23503'; END IF;
 UPDATE public.editorial_assets SET state='deleting' WHERE id=asset.id AND state<>'deleted';RETURN pg_catalog.to_jsonb(asset);END; $$;
CREATE OR REPLACE FUNCTION public.list_unused_editorial_assets(p_limit integer,p_worker_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 RETURN COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id)) FROM (SELECT c.id FROM public.editorial_assets c WHERE c.owner_id=auth.uid() AND c.state<>'deleted' AND c.created_at<pg_catalog.now()-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM public.visual_pages v WHERE v.asset_id=c.id) AND NOT EXISTS(SELECT 1 FROM public.published_visual_pages v WHERE v.asset_id=c.id) ORDER BY c.created_at,c.id LIMIT GREATEST(1,LEAST(COALESCE(p_limit,50),50)))a),'[]'::jsonb);END; $$;

-- Bounded metadata only: no private IDs, keys, filenames, scripts or operation receipts.
CREATE FUNCTION public.read_public_visual_pages(p_public_id uuid,p_entry_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('total',(SELECT count(*) FROM public.published_visual_pages v WHERE v.entry_id=e.id),
 'items',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',v.id,'position',v.position,'width',v.width,'height',v.height) ORDER BY v.position)
 FROM (SELECT id,position,width,height FROM public.published_visual_pages WHERE entry_id=e.id ORDER BY position LIMIT GREATEST(1,LEAST(COALESCE(p_limit,20),40)) OFFSET GREATEST(0,COALESCE(p_offset,0)))v),'[]'::jsonb))
 FROM public.published_work_entries e JOIN public.published_works p ON p.id=e.publication_id WHERE p.id=p_public_id AND e.id=p_entry_id AND p.is_public AND p.visual_settings IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.read_public_visual_pages(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_visual_pages(uuid,uuid,integer,integer) TO anon,authenticated;
-- Only the existing Worker can resolve R2 keys. This RPC is NOT an image/key API for browsers.
CREATE FUNCTION public.resolve_public_visual_asset(p_public_id uuid,p_entry_id uuid,p_page_id uuid,p_worker_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_worker_token IS NULL OR (SELECT worker_token_hash FROM public.cover_media_settings WHERE id=true) IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_worker_token,'UTF8')),'hex') THEN RAISE EXCEPTION 'Worker authorization required' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE((SELECT public_reading_enabled FROM public.editorial_media_settings WHERE id=true),false) THEN RETURN NULL; END IF;
 RETURN (SELECT pg_catalog.jsonb_build_object('object_key',a.object_key,'mime',a.mime,'bytes',a.bytes,'width',v.width,'height',v.height)
 FROM public.published_visual_pages v JOIN public.published_work_entries e ON e.id=v.entry_id JOIN public.published_works p ON p.id=e.publication_id JOIN public.editorial_assets a ON a.id=v.asset_id
 WHERE v.id=p_page_id AND e.id=p_entry_id AND p.id=p_public_id AND p.is_public AND p.visual_settings IS NOT NULL AND a.state='ready');
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_public_visual_asset(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_public_visual_asset(uuid,uuid,uuid,text) TO anon,authenticated;
COMMIT;
