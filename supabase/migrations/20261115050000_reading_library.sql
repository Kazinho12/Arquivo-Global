-- F5.3: private reading data only. No metrics/identity linkage or administrative grants.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.social_library') IS NULL OR to_regclass('public.published_visual_pages') IS NULL THEN RAISE EXCEPTION 'Install F5.1 and F4.2-C first';END IF;
END $$;
CREATE TABLE public.reading_settings(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,sync boolean NOT NULL DEFAULT false,history boolean NOT NULL DEFAULT false,epoch bigint NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.reading_works(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,publication_id uuid NOT NULL,state text NOT NULL DEFAULT 'reading' CHECK(state IN ('reading','completed','want')),generation bigint NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,publication_id));
CREATE TABLE public.reading_progress(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,publication_id uuid NOT NULL,entry_id uuid NOT NULL,position double precision NOT NULL CHECK(position>=0 AND position<=1),locator jsonb NOT NULL DEFAULT '{}',completed boolean NOT NULL DEFAULT false,edition timestamptz NOT NULL,revision bigint NOT NULL DEFAULT 1,seen_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,publication_id,entry_id),FOREIGN KEY(user_id,publication_id) REFERENCES public.reading_works ON DELETE CASCADE);
CREATE INDEX reading_progress_recent ON public.reading_progress(user_id,seen_at DESC,publication_id,entry_id) WHERE seen_at IS NOT NULL;
CREATE TABLE public.reading_history(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,publication_id uuid NOT NULL,entry_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',seen_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,publication_id,entry_id));
CREATE INDEX reading_history_recent ON public.reading_history(user_id,seen_at DESC,publication_id,entry_id);
CREATE TABLE public.reading_lists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),description text NOT NULL DEFAULT '' CHECK(char_length(description)<=1000),revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reading_lists_owner ON public.reading_lists(user_id,updated_at DESC,id);
CREATE TABLE public.reading_list_items(list_id uuid NOT NULL REFERENCES public.reading_lists ON DELETE CASCADE,publication_id uuid NOT NULL,position integer NOT NULL CHECK(position>0),PRIMARY KEY(list_id,publication_id),UNIQUE(list_id,position));
CREATE TABLE public.reading_operations(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
CREATE INDEX reading_operations_rate ON public.reading_operations(user_id,created_at DESC);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['reading_settings','reading_history','reading_works','reading_progress','reading_lists','reading_list_items','reading_operations'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 IF t<>'reading_list_items' THEN EXECUTE format('CREATE POLICY owner_only ON public.%I FOR SELECT TO authenticated USING(user_id=auth.uid())',t);
 ELSE EXECUTE 'CREATE POLICY owner_only ON public.reading_list_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.reading_lists l WHERE l.id=list_id AND l.user_id=auth.uid()))';END IF;
END LOOP;END $$;
CREATE FUNCTION public.reading_library(p_action text,p_data jsonb DEFAULT '{}',p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
<<lib>>
DECLARE actor uuid:=auth.uid();settings public.reading_settings%ROWTYPE;w public.reading_works%ROWTYPE;r public.reading_progress%ROWTYPE;l public.reading_lists%ROWTYPE;p public.published_works%ROWTYPE;receipt public.reading_operations%ROWTYPE;pub uuid;entry uuid;lid uuid;fingerprint text;result jsonb;ids uuid[];n integer;pos double precision;loc jsonb;sort text;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>32000 THEN RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('reading:'||actor::text,0));
 INSERT INTO public.reading_settings(user_id) VALUES(actor) ON CONFLICT DO NOTHING;
 SELECT * INTO settings FROM public.reading_settings WHERE user_id=actor;
 pub:=(p_data->>'work')::uuid;entry:=(p_data->>'entry')::uuid;lid:=(p_data->>'id')::uuid;
 IF p_action='settings' THEN RETURN to_jsonb(settings)-'user_id';
 ELSIF p_action='work' THEN
  SELECT * INTO w FROM public.reading_works WHERE user_id=actor AND publication_id=pub;
  RETURN jsonb_build_object('generation',COALESCE(w.generation,0),'revision',COALESCE(w.revision,0),'state',w.state,'entries',COALESCE((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM(SELECT rp.*,p.is_public IS TRUE AND e.id IS NOT NULL AS available,p.last_published_at=rp.edition AS current_edition FROM public.reading_progress rp LEFT JOIN public.published_works p ON p.id=rp.publication_id LEFT JOIN public.published_work_entries e ON e.publication_id=rp.publication_id AND e.id=rp.entry_id WHERE rp.user_id=actor AND rp.publication_id=pub)x),'[]'));
 ELSIF p_action='lists' THEN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)-'user_id') FROM(SELECT rl.*, (SELECT count(*) FROM public.reading_list_items i WHERE i.list_id=rl.id) AS count FROM public.reading_lists rl WHERE user_id=actor ORDER BY updated_at DESC,id LIMIT 30 OFFSET LEAST(10000,GREATEST(0,COALESCE((p_data->>'offset')::integer,0))))x),'[]');
 ELSIF p_action='list' THEN
  SELECT * INTO l FROM public.reading_lists WHERE id=lid AND user_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
  RETURN (to_jsonb(l)-'user_id')||jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.publication_id,'position',i.position,'available',p.is_public IS TRUE,'title',CASE WHEN p.is_public THEN p.title END) ORDER BY i.position) FROM public.reading_list_items i LEFT JOIN public.published_works p ON p.id=i.publication_id WHERE i.list_id=lid),'[]'));
 ELSIF p_action='history' THEN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT h.publication_id AS id,NULLIF(h.entry_id,'00000000-0000-0000-0000-000000000000') AS entry_id,h.seen_at,rp.position,COALESCE(rp.completed,false) AS completed,p.is_public IS TRUE AND (e.id IS NOT NULL OR h.entry_id='00000000-0000-0000-0000-000000000000') AS available,CASE WHEN p.is_public THEN p.title END AS title,CASE WHEN p.is_public AND e.id IS NOT NULL THEN e.title END AS chapter,p.type AS format FROM public.reading_history h LEFT JOIN public.reading_progress rp ON rp.user_id=h.user_id AND rp.publication_id=h.publication_id AND rp.entry_id=h.entry_id LEFT JOIN public.published_works p ON p.id=h.publication_id AND p.is_public LEFT JOIN public.published_work_entries e ON e.id=h.entry_id AND e.publication_id=h.publication_id WHERE h.user_id=actor AND (COALESCE(p_data->>'q','')='' OR (p.is_public AND p.title ILIKE '%'||(p_data->>'q')||'%')) AND (COALESCE(p_data->>'format','')='' OR (p_data->>'format'='Webtoon' AND p.visual_settings->>'format'='webtoon') OR p.type=p_data->>'format') ORDER BY h.seen_at DESC,h.publication_id,h.entry_id LIMIT 30 OFFSET LEAST(10000,GREATEST(0,COALESCE((p_data->>'offset')::integer,0))))x),'[]');
 ELSIF p_action='library' THEN
  sort:=COALESCE(p_data->>'sort','recent');
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM(
   SELECT targets.publication_id AS id,p.is_public IS TRUE AS available,CASE WHEN p.is_public THEN p.title END AS title,CASE WHEN p.is_public THEN p.author_name END AS author,CASE WHEN p.is_public THEN p.type END AS format,CASE WHEN p.is_public THEN p.genre END AS genre,p.last_published_at AS publication_updated_at,COALESCE(s.saved,false) AS saved,COALESCE(s.favorite,false) AS favorite,COALESCE(s.later,false) AS later,f.user_id IS NOT NULL AS following,w.state,w.revision,COALESCE(w.generation,0) AS generation,GREATEST(w.created_at,s.updated_at,f.created_at) AS added_at,lastread.seen_at AS last_read_at,CASE WHEN p.is_public AND EXISTS(SELECT 1 FROM public.published_work_entries ce WHERE ce.id=lastread.entry_id AND ce.publication_id=p.id) THEN lastread.entry_id END AS last_entry,lastread.position AS last_position
   FROM(SELECT publication_id FROM public.reading_works WHERE user_id=actor UNION SELECT publication_id FROM public.reading_history WHERE user_id=actor UNION SELECT publication_id FROM public.social_library WHERE user_id=actor UNION SELECT publication_id FROM public.social_work_follows WHERE user_id=actor UNION SELECT i.publication_id FROM public.reading_list_items i JOIN public.reading_lists rl ON rl.id=i.list_id WHERE rl.user_id=actor)targets
   LEFT JOIN public.published_works p ON p.id=targets.publication_id AND p.is_public
   LEFT JOIN public.reading_works w ON w.publication_id=targets.publication_id AND w.user_id=actor
   LEFT JOIN public.social_library s ON s.publication_id=targets.publication_id AND s.user_id=actor
   LEFT JOIN public.social_work_follows f ON f.publication_id=targets.publication_id AND f.user_id=actor
   LEFT JOIN LATERAL(SELECT events.seen_at,events.entry_id,events.position FROM(SELECT rp.updated_at AS seen_at,rp.entry_id,rp.position,1 AS priority FROM public.reading_progress rp WHERE rp.user_id=actor AND rp.publication_id=targets.publication_id UNION ALL SELECT h.seen_at,NULLIF(h.entry_id,'00000000-0000-0000-0000-000000000000'),NULL::double precision,0 FROM public.reading_history h WHERE h.user_id=actor AND h.publication_id=targets.publication_id)events ORDER BY events.seen_at DESC,events.priority DESC,events.entry_id LIMIT 1)lastread ON true
   WHERE (COALESCE(p_data->>'q','')='' OR (p.is_public AND concat_ws(' ',p.title,p.author_name,p.genre) ILIKE '%'||(p_data->>'q')||'%'))
   AND (COALESCE(p_data->>'format','')='' OR (p_data->>'format'='Webtoon' AND p.visual_settings->>'format'='webtoon') OR p.type=p_data->>'format') AND (COALESCE(p_data->>'genre','')='' OR p.genre=p_data->>'genre') AND (COALESCE(p_data->>'author','')='' OR p.author_name ILIKE '%'||(p_data->>'author')||'%')
   AND (COALESCE(p_data->>'updated','')='' OR p.last_published_at>=(p_data->>'updated')::timestamptz)
   AND (COALESCE(p_data->>'filter','all')='all' OR p_data->>'filter'=w.state OR (p_data->>'filter'='favorite' AND s.favorite) OR(p_data->>'filter'='saved' AND s.saved) OR(p_data->>'filter'='later' AND s.later) OR(p_data->>'filter'='following' AND f.user_id IS NOT NULL) OR(p_data->>'filter'='recent' AND EXISTS(SELECT 1 FROM public.reading_history h WHERE h.user_id=actor AND h.publication_id=targets.publication_id)))
   ORDER BY CASE WHEN sort='title' THEN p.title END ASC NULLS LAST,CASE WHEN sort='added' THEN GREATEST(w.created_at,s.updated_at,f.created_at) WHEN sort='updated' THEN p.last_published_at ELSE lastread.seen_at END DESC NULLS LAST,targets.publication_id
   LIMIT 30 OFFSET LEAST(10000,GREATEST(0,COALESCE((p_data->>'offset')::integer,0))))x),'[]');
 END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_action,p_data)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.reading_operations WHERE user_id=actor AND id=p_operation;
 IF FOUND THEN IF receipt.fingerprint<>lib.fingerprint THEN RAISE EXCEPTION 'Operation reused' USING ERRCODE='22023';END IF;RETURN receipt.result;END IF;
 IF(SELECT count(*) FROM public.reading_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=60 OR(p_action='progress' AND(SELECT count(*) FROM public.reading_operations WHERE user_id=actor AND action='progress' AND created_at>now()-interval '1 minute')>=20) THEN RAISE EXCEPTION 'Rate limited' USING ERRCODE='54000';END IF;
 result:='{"ok":true}';
 IF p_action='save_settings' THEN
  IF (p_data->>'revision')::bigint IS DISTINCT FROM settings.revision OR jsonb_typeof(p_data->'sync') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_data->'history') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Settings conflict' USING ERRCODE='40001';END IF;
  UPDATE public.reading_settings SET sync=(p_data->>'sync')::boolean,history=(p_data->>'history')::boolean,revision=revision+1,epoch=epoch+1,updated_at=now() WHERE user_id=actor RETURNING to_jsonb(reading_settings)-'user_id' INTO result;
 ELSIF p_action IN ('clear_history','clear_all','forget_history','remove_completed') THEN
  IF (p_data->>'epoch')::bigint IS DISTINCT FROM settings.epoch THEN RAISE EXCEPTION 'Settings conflict' USING ERRCODE='40001';END IF;
  IF p_action='forget_history' THEN DELETE FROM public.reading_history WHERE user_id=actor AND publication_id=pub AND entry_id=COALESCE(entry,'00000000-0000-0000-0000-000000000000');UPDATE public.reading_progress SET seen_at=NULL WHERE user_id=actor AND publication_id=pub AND entry_id=entry;
  ELSIF p_action='remove_completed' THEN UPDATE public.reading_progress SET completed=false,revision=revision+1 WHERE user_id=actor AND (pub IS NULL OR publication_id=pub);
  ELSIF p_action='clear_history' THEN DELETE FROM public.reading_history WHERE user_id=actor;UPDATE public.reading_progress SET seen_at=NULL WHERE user_id=actor;
  ELSE DELETE FROM public.reading_progress WHERE user_id=actor;UPDATE public.reading_works SET generation=generation+1,revision=revision+1,updated_at=now() WHERE user_id=actor;END IF;
  UPDATE public.reading_settings SET epoch=epoch+1,revision=revision+1 WHERE user_id=actor RETURNING to_jsonb(reading_settings)-'user_id' INTO result;
 ELSIF p_action='visit' THEN
  IF NOT settings.history OR (p_data->>'epoch')::bigint IS DISTINCT FROM settings.epoch THEN RAISE EXCEPTION 'History disabled or obsolete' USING ERRCODE='40001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.published_works p WHERE p.id=pub AND p.is_public) OR (entry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_work_entries e WHERE e.id=entry AND e.publication_id=pub)) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO public.reading_history(user_id,publication_id,entry_id) VALUES(actor,pub,COALESCE(entry,'00000000-0000-0000-0000-000000000000')) ON CONFLICT(user_id,publication_id,entry_id) DO UPDATE SET seen_at=now();
 ELSIF p_action IN ('progress','complete','state','clear_work') THEN
  IF pub IS NULL THEN RAISE EXCEPTION 'Invalid work' USING ERRCODE='22023';END IF;
  SELECT * INTO w FROM public.reading_works WHERE user_id=actor AND publication_id=pub;
  IF p_action='clear_work' THEN
   IF COALESCE(w.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'Work conflict' USING ERRCODE='40001';END IF;
   DELETE FROM public.reading_progress WHERE user_id=actor AND publication_id=pub;
   INSERT INTO public.reading_works(user_id,publication_id,generation) VALUES(actor,pub,1) ON CONFLICT(user_id,publication_id) DO UPDATE SET generation=reading_works.generation+1,revision=reading_works.revision+1,updated_at=now();
  ELSE
   SELECT * INTO p FROM public.published_works WHERE id=pub AND is_public;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
   IF p_action='state' THEN
    IF COALESCE(w.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint OR p_data->>'state' IS NULL OR p_data->>'state' NOT IN ('reading','completed','want') THEN RAISE EXCEPTION 'Work conflict' USING ERRCODE='40001';END IF;
    INSERT INTO public.reading_works(user_id,publication_id,state) VALUES(actor,pub,p_data->>'state') ON CONFLICT(user_id,publication_id) DO UPDATE SET state=EXCLUDED.state,revision=reading_works.revision+1,updated_at=now();
   ELSE
    IF NOT settings.sync OR (p_data->>'epoch')::bigint IS DISTINCT FROM settings.epoch OR COALESCE(w.generation,0) IS DISTINCT FROM (p_data->>'generation')::bigint THEN RAISE EXCEPTION 'Sync disabled or obsolete' USING ERRCODE='40001';END IF;
    IF NOT EXISTS(SELECT 1 FROM public.published_work_entries e WHERE e.id=entry AND e.publication_id=pub) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
    IF (p_data->>'edition')::timestamptz IS DISTINCT FROM p.last_published_at THEN RAISE EXCEPTION 'Edition changed' USING ERRCODE='40001';END IF;
    SELECT * INTO r FROM public.reading_progress WHERE user_id=actor AND publication_id=pub AND entry_id=entry;
    IF COALESCE(r.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'Progress conflict' USING ERRCODE='40001';END IF;
    pos:=(p_data->>'position')::double precision;loc:=COALESCE(p_data->'locator','{}');
    IF pos IS NULL OR pos<0 OR pos>1 OR pos='NaN'::float8 OR jsonb_typeof(loc)<>'object' OR octet_length(loc::text)>2000 OR loc - ARRAY['kind','block','offset','page','pageId','direction','vertical']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid position' USING ERRCODE='22023';END IF;
    IF loc->>'kind' IS NULL OR loc->>'kind' NOT IN ('prose','poetry','comic','manga','webtoon') OR (loc ? 'direction' AND loc->>'direction' NOT IN ('rtl','ltr')) OR (loc ? 'vertical' AND jsonb_typeof(loc->'vertical')<>'boolean') THEN RAISE EXCEPTION 'Invalid locator' USING ERRCODE='22023';END IF;
    FOREACH n IN ARRAY ARRAY[0,1,2] LOOP
     IF loc ? (ARRAY['block','offset','page'])[n+1] AND ((loc->>(ARRAY['block','offset','page'])[n+1])::numeric<0 OR (loc->>(ARRAY['block','offset','page'])[n+1])::numeric>1000000) THEN RAISE EXCEPTION 'Invalid locator' USING ERRCODE='22023';END IF;
    END LOOP;
    IF loc ? 'offset' AND ((loc->>'offset')::numeric<0 OR (loc->>'offset')::numeric>1) THEN RAISE EXCEPTION 'Invalid offset' USING ERRCODE='22023';END IF;
    IF loc ? 'pageId' AND NOT EXISTS(SELECT 1 FROM public.published_visual_pages v WHERE v.id=(loc->>'pageId')::uuid AND v.entry_id=entry) THEN RAISE EXCEPTION 'Unavailable page' USING ERRCODE='42501';END IF;
    IF p_action='complete' AND jsonb_typeof(p_data->'completed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid completion' USING ERRCODE='22023';END IF;
    INSERT INTO public.reading_works(user_id,publication_id) VALUES(actor,pub) ON CONFLICT DO NOTHING;
    INSERT INTO public.reading_progress(user_id,publication_id,entry_id,position,locator,completed,edition,seen_at) VALUES(actor,pub,entry,pos,loc,CASE WHEN p_action='complete' THEN(p_data->>'completed')::boolean ELSE COALESCE(r.completed,false) OR pos=1 END,p.last_published_at,CASE WHEN settings.history THEN now() END)
    ON CONFLICT(user_id,publication_id,entry_id) DO UPDATE SET position=EXCLUDED.position,locator=EXCLUDED.locator,completed=EXCLUDED.completed,edition=EXCLUDED.edition,revision=reading_progress.revision+1,seen_at=CASE WHEN settings.history THEN now() ELSE reading_progress.seen_at END,updated_at=now() RETURNING to_jsonb(reading_progress)-'user_id' INTO result;
    IF settings.history THEN INSERT INTO public.reading_history(user_id,publication_id,entry_id) VALUES(actor,pub,entry) ON CONFLICT(user_id,publication_id,entry_id) DO UPDATE SET seen_at=now();END IF;
   END IF;
  END IF;
 ELSIF p_action='save_list' THEN
  IF lid IS NULL THEN
   IF(SELECT count(*) FROM public.reading_lists WHERE user_id=actor)>=100 THEN RAISE EXCEPTION 'List limit' USING ERRCODE='54000';END IF;
   INSERT INTO public.reading_lists(user_id,name,description) VALUES(actor,btrim(p_data->>'name'),COALESCE(p_data->>'description','')) RETURNING * INTO l;
  ELSE
   SELECT * INTO l FROM public.reading_lists WHERE id=lid AND user_id=actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
   IF l.revision IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'List conflict' USING ERRCODE='40001';END IF;
   UPDATE public.reading_lists SET name=btrim(p_data->>'name'),description=COALESCE(p_data->>'description',''),revision=revision+1,updated_at=now() WHERE id=lid RETURNING * INTO l;
  END IF;
  IF p_data ? 'items' THEN
   IF jsonb_typeof(p_data->'items')<>'array' OR jsonb_array_length(p_data->'items')>200 THEN RAISE EXCEPTION 'Invalid items' USING ERRCODE='22023';END IF;
   SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_data->'items');
   IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids)x) OR EXISTS(SELECT 1 FROM unnest(ids)x WHERE x IS NULL) THEN RAISE EXCEPTION 'Duplicate items' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM unnest(ids)x WHERE NOT EXISTS(SELECT 1 FROM public.published_works p WHERE p.id=x AND p.is_public) AND NOT EXISTS(SELECT 1 FROM public.reading_list_items i WHERE i.list_id=l.id AND i.publication_id=x)) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
   DELETE FROM public.reading_list_items WHERE list_id=l.id;
   INSERT INTO public.reading_list_items SELECT l.id,x,ordinality::integer FROM unnest(ids) WITH ORDINALITY AS u(x,ordinality);
  END IF;
  result:=to_jsonb(l)-'user_id';
 ELSIF p_action='delete_list' THEN
  DELETE FROM public.reading_lists WHERE id=lid AND user_id=actor AND revision=(p_data->>'revision')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'List conflict' USING ERRCODE='40001';END IF;
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 INSERT INTO public.reading_operations(user_id,id,fingerprint,result,action) VALUES(actor,p_operation,lib.fingerprint,result,p_action);RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.reading_library(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reading_library(text,jsonb,uuid) TO authenticated;
COMMIT;
