-- F4.2-B: private visual editing only. No public image reads/snapshots in this phase.
BEGIN;
DO $$ BEGIN IF to_regclass('public.cover_media_settings') IS NULL THEN RAISE EXCEPTION 'F4.2-A required'; END IF; END $$;
ALTER TABLE public.works ADD COLUMN visual_settings jsonb CHECK(visual_settings IS NULL OR (
 type IN ('HQ / Comic','Mangá') AND jsonb_typeof(visual_settings)='object'
 AND visual_settings ?& ARRAY['format','mode','direction']
 AND (visual_settings-ARRAY['format','mode','direction'])='{}'::jsonb
 AND jsonb_typeof(visual_settings->'format')='string' AND jsonb_typeof(visual_settings->'mode')='string' AND jsonb_typeof(visual_settings->'direction')='string'
 AND visual_settings->>'format' IN ('hq','manga','webtoon','webcomic')
 AND visual_settings->>'mode' IN ('paged','vertical') AND visual_settings->>'direction' IN ('ltr','rtl')
 AND (visual_settings->>'format'<>'webtoon' OR visual_settings->>'mode'='vertical')));
GRANT SELECT(visual_settings) ON public.works TO authenticated;
CREATE TABLE public.editorial_media_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), max_asset_bytes bigint NOT NULL DEFAULT 20971520 CHECK(max_asset_bytes BETWEEN 1 AND 20971520),
 max_pixels bigint NOT NULL DEFAULT 40000000 CHECK(max_pixels>0 AND max_pixels<=40000000),
 max_width integer NOT NULL DEFAULT 16384 CHECK(max_width BETWEEN 1 AND 16384),
 max_height integer NOT NULL DEFAULT 65535 CHECK(max_height BETWEEN 1 AND 65535),
 max_pages_per_entry integer NOT NULL DEFAULT 1000 CHECK(max_pages_per_entry>0),
 max_owner_assets integer NOT NULL DEFAULT 10000 CHECK(max_owner_assets>0)
);
INSERT INTO public.editorial_media_settings(id) VALUES(true);
ALTER TABLE public.editorial_media_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.editorial_media_settings FROM PUBLIC,anon,authenticated;
CREATE TABLE public.editorial_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id),
 work_id uuid REFERENCES public.works(id) ON DELETE SET NULL, entry_id uuid REFERENCES public.work_entries(id) ON DELETE SET NULL,
 object_key text NOT NULL UNIQUE, filename text NOT NULL CHECK(char_length(filename) BETWEEN 1 AND 255),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')), bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 20971520),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 16384), height integer NOT NULL CHECK(height BETWEEN 1 AND 65535),
 CHECK(width::bigint*height<=40000000), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','deleting','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX editorial_assets_owner ON public.editorial_assets(owner_id,state,created_at);
ALTER TABLE public.editorial_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY editorial_assets_owner ON public.editorial_assets FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.editorial_assets FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.editorial_assets TO authenticated;
CREATE TABLE public.visual_pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid NOT NULL REFERENCES public.work_entries(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES public.editorial_assets(id), position integer NOT NULL CHECK(position>0),
 UNIQUE(entry_id,position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX visual_pages_asset ON public.visual_pages(asset_id);
ALTER TABLE public.visual_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY visual_pages_owner ON public.visual_pages FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.work_entries e JOIN public.works w ON w.id=e.work_id WHERE e.id=entry_id AND w.owner_id=(SELECT auth.uid())));
REVOKE ALL ON public.visual_pages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.visual_pages TO authenticated;

CREATE FUNCTION public.assert_editorial_worker(p_worker_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR p_worker_token IS NULL OR (SELECT worker_token_hash FROM public.cover_media_settings WHERE id=true) IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_worker_token,'UTF8')),'hex') THEN RAISE EXCEPTION 'Worker authorization required' USING ERRCODE='42501'; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.assert_editorial_worker(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.guard_visual_page() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; kind text; asset public.editorial_assets%ROWTYPE;
BEGIN
 SELECT w.owner_id,e.entry_type INTO actor,kind FROM public.work_entries e JOIN public.works w ON w.id=e.work_id WHERE e.id=NEW.entry_id;
 SELECT * INTO asset FROM public.editorial_assets WHERE id=NEW.asset_id FOR UPDATE;
 IF NOT FOUND OR actor IS NULL OR kind<>'visual' OR asset.owner_id<>actor OR asset.state<>'ready' THEN RAISE EXCEPTION 'Visual image unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER visual_page_guard BEFORE INSERT OR UPDATE ON public.visual_pages FOR EACH ROW EXECUTE FUNCTION public.guard_visual_page();
REVOKE EXECUTE ON FUNCTION public.guard_visual_page() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.block_unreleased_visual_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.status='published' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.published_revision IS DISTINCT FROM OLD.published_revision)
 AND (NEW.visual_settings IS NOT NULL OR EXISTS(SELECT 1 FROM public.visual_pages v JOIN public.work_entries e ON e.id=v.entry_id WHERE e.work_id=NEW.id)) THEN
 RAISE EXCEPTION 'Visual publication requires F4.2-C/D; images remain private' USING ERRCODE='55000'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER block_unreleased_visual_publication BEFORE UPDATE OF status,published_revision ON public.works FOR EACH ROW EXECUTE FUNCTION public.block_unreleased_visual_publication();
REVOKE EXECUTE ON FUNCTION public.block_unreleased_visual_publication() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.read_private_work(p_work_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_catalog.to_jsonb(w)||pg_catalog.jsonb_build_object('entries',COALESCE((SELECT pg_catalog.jsonb_agg(
 pg_catalog.to_jsonb(e)||pg_catalog.jsonb_build_object('visual_pages',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
 'id',v.id,'asset_id',v.asset_id,'position',v.position,'filename',a.filename,'width',a.width,'height',a.height,'bytes',a.bytes,'mime',a.mime) ORDER BY v.position)
 FROM public.visual_pages v JOIN public.editorial_assets a ON a.id=v.asset_id WHERE v.entry_id=e.id),'[]'::jsonb)) ORDER BY e.position)
 FROM public.work_entries e WHERE e.work_id=w.id),'[]'::jsonb)) FROM public.works w WHERE w.id=p_work_id AND w.owner_id=auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.read_private_work(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_private_work(uuid) TO authenticated;

CREATE FUNCTION public.visual_editor_limits() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 RETURN (SELECT pg_catalog.jsonb_build_object('bytes',max_asset_bytes,'pixels',max_pixels,'width',max_width,'height',max_height,'pages',max_pages_per_entry,'concurrent',2) FROM public.editorial_media_settings WHERE id=true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.visual_editor_limits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_editor_limits() TO authenticated;
CREATE FUNCTION public.reserve_editorial_upload(p_work_id uuid,p_entry_id uuid,p_mime text,p_bytes bigint,p_width integer,p_height integer,p_filename text,p_worker_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); asset public.editorial_assets%ROWTYPE; limits public.editorial_media_settings%ROWTYPE; budget bigint; ext text;
BEGIN
 PERFORM public.assert_editorial_worker(p_worker_token);
 IF NOT EXISTS(SELECT 1 FROM public.work_entries e JOIN public.works w ON w.id=e.work_id WHERE e.id=p_entry_id AND w.id=p_work_id AND w.owner_id=actor AND e.entry_type='visual' AND w.archived_at IS NULL) THEN RAISE EXCEPTION 'Visual owner required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(4242,1);
 SELECT * INTO limits FROM public.editorial_media_settings WHERE id=true;
 SELECT storage_budget_bytes INTO budget FROM public.cover_media_settings WHERE id=true;
 IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND limits.max_asset_bytes OR p_width IS NULL OR p_height IS NULL
 OR p_width NOT BETWEEN 1 AND limits.max_width OR p_height NOT BETWEEN 1 AND limits.max_height OR p_width::bigint*p_height>limits.max_pixels
 OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg','image/png','image/webp') OR p_filename IS NULL OR char_length(p_filename) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'Invalid image metadata' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.editorial_assets WHERE owner_id=actor AND state<>'deleted')>=limits.max_owner_assets
 OR (SELECT COALESCE(sum(bytes),0) FROM public.cover_assets WHERE state<>'deleted')+(SELECT COALESCE(sum(bytes),0) FROM public.editorial_assets WHERE state<>'deleted')+p_bytes>budget THEN RAISE EXCEPTION 'Media quota exceeded' USING ERRCODE='54000'; END IF;
 ext:=CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;asset.id:=gen_random_uuid();
 INSERT INTO public.editorial_assets(id,owner_id,work_id,entry_id,object_key,filename,mime,bytes,width,height) VALUES(asset.id,actor,p_work_id,p_entry_id,'editorial/'||actor::text||'/'||p_work_id::text||'/'||p_entry_id::text||'/'||asset.id::text||'.'||ext,p_filename,p_mime,p_bytes,p_width,p_height) RETURNING * INTO asset;
 RETURN pg_catalog.to_jsonb(asset);
END; $$;
CREATE FUNCTION public.finish_editorial_upload(p_asset_id uuid,p_worker_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE asset public.editorial_assets%ROWTYPE;BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 UPDATE public.editorial_assets SET state='ready' WHERE id=p_asset_id AND owner_id=auth.uid() AND state IN ('pending','ready') RETURNING * INTO asset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;RETURN pg_catalog.to_jsonb(asset);END; $$;
CREATE FUNCTION public.begin_delete_editorial(p_asset_id uuid,p_worker_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE asset public.editorial_assets%ROWTYPE;BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 SELECT * INTO asset FROM public.editorial_assets WHERE id=p_asset_id AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF asset.state='pending' AND asset.created_at>pg_catalog.now()-interval '24 hours' THEN RAISE EXCEPTION 'Upload is in flight' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.visual_pages WHERE asset_id=asset.id) THEN RAISE EXCEPTION 'Image still referenced' USING ERRCODE='23503'; END IF;
 UPDATE public.editorial_assets SET state='deleting' WHERE id=asset.id AND state<>'deleted';RETURN pg_catalog.to_jsonb(asset);END; $$;
CREATE FUNCTION public.finish_delete_editorial(p_asset_id uuid,p_worker_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 UPDATE public.editorial_assets SET state='deleted' WHERE id=p_asset_id AND owner_id=auth.uid() AND state IN ('deleting','deleted');IF NOT FOUND THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;END; $$;
CREATE FUNCTION public.list_unused_editorial_assets(p_limit integer,p_worker_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN PERFORM public.assert_editorial_worker(p_worker_token);
 RETURN COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id)) FROM (SELECT c.id FROM public.editorial_assets c WHERE c.owner_id=auth.uid() AND c.state<>'deleted' AND c.created_at<pg_catalog.now()-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM public.visual_pages v WHERE v.asset_id=c.id) ORDER BY c.created_at,c.id LIMIT GREATEST(1,LEAST(COALESCE(p_limit,50),50)))a),'[]'::jsonb);END; $$;
REVOKE EXECUTE ON FUNCTION public.reserve_editorial_upload(uuid,uuid,text,bigint,integer,integer,text,text),public.finish_editorial_upload(uuid,text),public.begin_delete_editorial(uuid,text),public.finish_delete_editorial(uuid,text),public.list_unused_editorial_assets(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_editorial_upload(uuid,uuid,text,bigint,integer,integer,text,text),public.finish_editorial_upload(uuid,text),public.begin_delete_editorial(uuid,text),public.finish_delete_editorial(uuid,text),public.list_unused_editorial_assets(integer,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.reserve_cover_upload(p_work_id uuid,p_mime text,p_bytes bigint,p_worker_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); asset public.cover_assets%ROWTYPE; limits public.cover_media_settings%ROWTYPE; ext text;
BEGIN
 IF p_worker_token IS NULL OR (SELECT worker_token_hash FROM public.cover_media_settings WHERE id=true) IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_worker_token,'UTF8')),'hex') THEN RAISE EXCEPTION 'Worker authorization required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.works WHERE id=p_work_id AND owner_id=actor AND archived_at IS NULL) THEN
 RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(4242,1);
 SELECT * INTO limits FROM public.cover_media_settings WHERE id=true;
 IF p_bytes IS NULL OR p_bytes<1 OR p_bytes>limits.max_cover_bytes OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg','image/png','image/webp') THEN
 RAISE EXCEPTION 'Invalid cover upload' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.cover_assets WHERE owner_id=actor AND state<>'deleted')>=limits.max_owner_assets
 OR (SELECT COALESCE(sum(bytes),0) FROM public.cover_assets WHERE state<>'deleted')+(SELECT COALESCE(sum(bytes),0) FROM public.editorial_assets WHERE state<>'deleted')+p_bytes>limits.storage_budget_bytes THEN
 RAISE EXCEPTION 'Media quota exceeded' USING ERRCODE='54000'; END IF;
 ext:=CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
 asset.id:=gen_random_uuid();
 INSERT INTO public.cover_assets(id,owner_id,work_id,object_key,mime,bytes)
 VALUES(asset.id,actor,p_work_id,'covers/'||actor::text||'/'||p_work_id::text||'/'||asset.id::text||'.'||ext,p_mime,p_bytes) RETURNING * INTO asset;
 RETURN pg_catalog.to_jsonb(asset);
END; $$;
CREATE OR REPLACE FUNCTION public.mutate_private_work(
  p_work_id uuid, p_revision integer, p_action text, p_payload jsonb, p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  source public.works%ROWTYPE;
  target public.works%ROWTYPE;
  entry public.work_entries%ROWTYPE;
  receipt public.work_operation_receipts%ROWTYPE;
  fingerprint text;
  result_id uuid;
  entry_id uuid;
  copied_entry_id uuid;
  next_position integer;
  entry_kind text;
  ordered_ids uuid[];
  current_ids uuid[];
  is_deleted boolean := false;
  response jsonb;
BEGIN
  IF actor IS NULL OR p_operation_id IS NULL OR p_work_id IS NULL OR p_revision IS NULL
    OR p_action IS NULL OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Authenticated operation required' USING ERRCODE = '42501';
  END IF;
  fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    p_work_id::text || ':' || p_revision::text || ':' || p_action || ':' || p_payload::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || p_operation_id::text,0));
  SELECT * INTO receipt FROM public.work_operation_receipts
    WHERE owner_id = actor AND operation_id = p_operation_id;
  IF FOUND THEN
    IF receipt.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'Operation key reused with a different request' USING ERRCODE = '22023';
    END IF;
    IF receipt.deleted THEN RETURN pg_catalog.jsonb_build_object('deleted_id',receipt.result_work_id); END IF;
    -- Return the latest state, never an obsolete content snapshot.
    RETURN pg_catalog.jsonb_build_object('work',public.read_private_work(receipt.result_work_id), 'already_applied',true);
  END IF;
  SELECT * INTO source FROM public.works WHERE id = p_work_id AND owner_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work unavailable' USING ERRCODE = '42501'; END IF;
  IF source.revision <> p_revision THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE = '40001'; END IF;
  IF source.archived_at IS NOT NULL AND p_action NOT IN ('restore','duplicate_work','delete_work','archive') THEN
    RAISE EXCEPTION 'Restore the archived work before editing' USING ERRCODE = '55000';
  END IF;
  result_id := source.id;
  entry_kind := CASE source.type WHEN 'Poesia' THEN 'poem' WHEN 'HQ / Comic' THEN 'visual' WHEN 'Mangá' THEN 'visual' ELSE 'chapter' END;

  IF p_action = 'duplicate_work' THEN
    INSERT INTO public.works(owner_id,title,slug,description,type,language,subtitle,genre,tags,age_rating,content_warnings,cover_accent_color,cover_style,cover_seed,cover_image,visual_settings)
      VALUES(actor,pg_catalog.left(source.title,190) || ' (Cópia)', 'copia-' || pg_catalog.gen_random_uuid()::text,
        source.description,source.type,source.language,source.subtitle,source.genre,source.tags,source.age_rating,
        source.content_warnings,source.cover_accent_color,source.cover_style,source.cover_seed,source.cover_image,source.visual_settings) RETURNING * INTO target;
    result_id := target.id;
    INSERT INTO public.work_entries(work_id,title,content,entry_type,position,alignment)
      SELECT target.id,title,content,entry_type,position,alignment FROM public.work_entries WHERE work_id = source.id;
    INSERT INTO public.visual_pages(entry_id,asset_id,position)
    SELECT n.id,v.asset_id,v.position FROM public.work_entries e JOIN public.visual_pages v ON v.entry_id=e.id
    JOIN public.work_entries n ON n.work_id=target.id AND n.position=e.position WHERE e.work_id=source.id;
  ELSIF p_action = 'archive' THEN
    IF source.archived_at IS NULL THEN UPDATE public.works SET archived_at = pg_catalog.now() WHERE id = source.id; END IF;
  ELSIF p_action = 'restore' THEN
    IF source.archived_at IS NOT NULL THEN UPDATE public.works SET archived_at = NULL WHERE id = source.id; END IF;
  ELSIF p_action = 'delete_work' THEN
    DELETE FROM public.works WHERE id = source.id;
    is_deleted := true;
  ELSIF p_action = 'add_entry' THEN
    SELECT COALESCE(pg_catalog.max(position),0)+1 INTO next_position FROM public.work_entries WHERE work_id = source.id;
    IF next_position > 1000 THEN RAISE EXCEPTION 'Entry limit reached' USING ERRCODE = '23514'; END IF;
    INSERT INTO public.work_entries(work_id,title,content,entry_type,position)
      VALUES(source.id,COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'title'),''),
        CASE entry_kind WHEN 'poem' THEN 'Poema ' WHEN 'visual' THEN 'Ato ' ELSE 'Capítulo ' END || next_position::text),
        '',entry_kind,next_position);
    UPDATE public.works SET title = title WHERE id = source.id;
  ELSIF p_action IN ('save_entry','duplicate_entry','delete_entry') THEN
    entry_id := (p_payload->>'entry_id')::uuid;
    SELECT * INTO entry FROM public.work_entries WHERE id = entry_id AND work_id = source.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE = '42501'; END IF;
    IF entry.revision IS DISTINCT FROM (p_payload->>'entry_revision')::integer THEN
      RAISE EXCEPTION 'Entry revision conflict' USING ERRCODE = '40001';
    END IF;
    IF p_action = 'save_entry' THEN
      UPDATE public.work_entries SET title = p_payload->>'title', content = p_payload->>'content',
        alignment = COALESCE(p_payload->>'alignment','left'), revision = revision+1, updated_at = pg_catalog.now()
        WHERE id = entry.id;
    ELSIF p_action = 'duplicate_entry' THEN
      SELECT COALESCE(pg_catalog.max(position),0)+1 INTO next_position FROM public.work_entries WHERE work_id = source.id;
      IF next_position > 1000 THEN RAISE EXCEPTION 'Entry limit reached' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.work_entries(work_id,title,content,entry_type,position,alignment)
        VALUES(source.id,pg_catalog.left(entry.title,190) || ' (Cópia)',entry.content,entry.entry_type,next_position,entry.alignment) RETURNING id INTO copied_entry_id;
      INSERT INTO public.visual_pages(entry_id,asset_id,position) SELECT copied_entry_id,v.asset_id,v.position FROM public.visual_pages v WHERE v.entry_id=entry.id;
    ELSE
      DELETE FROM public.work_entries WHERE id = entry.id;
      UPDATE public.work_entries SET position = position-1, revision = revision+1, updated_at = pg_catalog.now()
        WHERE work_id = source.id AND position > entry.position;
    END IF;
    UPDATE public.works SET title = title WHERE id = source.id;
  ELSIF p_action = 'reorder_entries' THEN
    IF pg_catalog.jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Order must be an array' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY ordinal),'{}'::uuid[]) INTO ordered_ids
      FROM pg_catalog.jsonb_array_elements_text(p_payload->'ids') WITH ORDINALITY AS items(value,ordinal);
    SELECT COALESCE(pg_catalog.array_agg(id ORDER BY id),'{}'::uuid[]) INTO current_ids FROM public.work_entries WHERE work_id = source.id;
    IF pg_catalog.cardinality(ordered_ids) <> pg_catalog.cardinality(current_ids)
      OR (SELECT COALESCE(pg_catalog.array_agg(id ORDER BY id),'{}'::uuid[]) FROM (SELECT DISTINCT pg_catalog.unnest(ordered_ids) AS id) ids) <> current_ids
      OR pg_catalog.array_position(ordered_ids,NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Order must include every entry exactly once' USING ERRCODE = '22023';
    END IF;
    UPDATE public.work_entries e SET position = ordering.ordinal::integer,
      revision = e.revision+1, updated_at = pg_catalog.now()
      FROM pg_catalog.unnest(ordered_ids) WITH ORDINALITY AS ordering(id,ordinal)
      WHERE e.id = ordering.id AND e.work_id = source.id;
    UPDATE public.works SET title = title WHERE id = source.id;
  ELSE
    RAISE EXCEPTION 'Unsupported editorial operation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.work_operation_receipts(owner_id,operation_id,fingerprint,result_work_id,deleted)
    VALUES(actor,p_operation_id,fingerprint,result_id,is_deleted);
  IF is_deleted THEN response := pg_catalog.jsonb_build_object('deleted_id',result_id);
  ELSE response := pg_catalog.jsonb_build_object('work',public.read_private_work(result_id)); END IF;
  RETURN response;
END;
$$;

CREATE FUNCTION public.save_visual_chapter(p_work_id uuid,p_revision integer,p_entry_id uuid,p_entry_revision integer,p_title text,p_script text,p_settings jsonb,p_pages jsonb,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); source public.works%ROWTYPE; entry public.work_entries%ROWTYPE; receipt public.work_operation_receipts%ROWTYPE; fingerprint text; max_pages integer;
BEGIN
 IF actor IS NULL OR p_work_id IS NULL OR p_revision IS NULL OR p_entry_id IS NULL OR p_entry_revision IS NULL OR p_operation_id IS NULL OR p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200 OR p_script IS NULL OR octet_length(p_script)>1048576 OR p_settings IS NULL OR p_pages IS NULL OR jsonb_typeof(p_pages)<>'array' OR octet_length(p_pages::text)>2097152 THEN RAISE EXCEPTION 'Invalid visual request' USING ERRCODE='22023'; END IF;
 fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('visual:'||p_work_id::text||':'||p_revision::text||':'||p_entry_id::text||':'||p_entry_revision::text||':'||p_title||':'||p_script||':'||p_settings::text||':'||p_pages::text,'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_operation_id::text,0));
 SELECT * INTO receipt FROM public.work_operation_receipts WHERE owner_id=actor AND operation_id=p_operation_id;
 IF FOUND THEN IF receipt.fingerprint<>fingerprint THEN RAISE EXCEPTION 'Operation key reused' USING ERRCODE='22023'; END IF;RETURN pg_catalog.jsonb_build_object('work',public.read_private_work(receipt.result_work_id),'already_applied',true); END IF;
 SELECT * INTO source FROM public.works WHERE id=p_work_id AND owner_id=actor FOR UPDATE;
 IF NOT FOUND OR source.type NOT IN ('HQ / Comic','Mangá') THEN RAISE EXCEPTION 'Visual owner required' USING ERRCODE='42501'; END IF;
 IF source.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore before editing' USING ERRCODE='55000'; END IF;
 IF source.revision<>p_revision THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO entry FROM public.work_entries WHERE id=p_entry_id AND work_id=source.id AND entry_type='visual' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
 IF entry.revision<>p_entry_revision THEN RAISE EXCEPTION 'Entry revision conflict' USING ERRCODE='40001'; END IF;
 SELECT max_pages_per_entry INTO max_pages FROM public.editorial_media_settings WHERE id=true;
 IF jsonb_array_length(p_pages)>max_pages OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_pages)p WHERE jsonb_typeof(p)<>'object' OR NOT(p ?& ARRAY['id','assetId']) OR (p-ARRAY['id','assetId'])<>'{}'::jsonb)
 OR (SELECT count(DISTINCT p->>'id') FROM jsonb_array_elements(p_pages)p)<>jsonb_array_length(p_pages) THEN RAISE EXCEPTION 'Invalid page sequence' USING ERRCODE='22023'; END IF;
 -- A stable asset lock order serializes association against Worker deletion.
 PERFORM a.id FROM public.editorial_assets a WHERE a.id IN(SELECT (p->>'assetId')::uuid FROM jsonb_array_elements(p_pages)p) ORDER BY a.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_pages)p LEFT JOIN public.editorial_assets a ON a.id=(p->>'assetId')::uuid WHERE a.id IS NULL OR a.owner_id<>actor OR a.state<>'ready') THEN RAISE EXCEPTION 'Image unavailable' USING ERRCODE='42501'; END IF;
 DELETE FROM public.visual_pages WHERE entry_id=entry.id;
 INSERT INTO public.visual_pages(id,entry_id,asset_id,position) SELECT (p.value->>'id')::uuid,entry.id,(p.value->>'assetId')::uuid,p.ordinality::integer FROM jsonb_array_elements(p_pages) WITH ORDINALITY p;
 UPDATE public.work_entries SET title=p_title,content=p_script,revision=revision+1,updated_at=pg_catalog.now() WHERE id=entry.id;
 UPDATE public.works SET visual_settings=p_settings WHERE id=source.id;
 INSERT INTO public.work_operation_receipts(owner_id,operation_id,fingerprint,result_work_id) VALUES(actor,p_operation_id,fingerprint,source.id);
 RETURN pg_catalog.jsonb_build_object('work',public.read_private_work(source.id));
END; $$;
REVOKE EXECUTE ON FUNCTION public.save_visual_chapter(uuid,integer,uuid,integer,text,text,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_visual_chapter(uuid,integer,uuid,integer,text,text,jsonb,jsonb,uuid) TO authenticated;

COMMIT;
