-- F5.4 additive, local installation artefact. No email, private reading history, or external push.
BEGIN;
DO $$ BEGIN IF to_regclass('public.center_notifications') IS NULL OR to_regclass('public.reading_settings') IS NULL THEN RAISE EXCEPTION 'Install F5.1-F5.3 first';END IF;END $$;
ALTER TABLE public.center_notifications DROP CONSTRAINT center_notifications_kind_check;
ALTER TABLE public.center_notifications ADD CONSTRAINT center_notifications_kind_check CHECK(kind IN ('official','service','social'));
ALTER TABLE public.center_notifications ADD COLUMN hidden_at timestamptz,ADD COLUMN category text,ADD COLUMN group_count integer NOT NULL DEFAULT 1 CHECK(group_count>0),ADD COLUMN digest_key text,ADD COLUMN last_event_at timestamptz;
CREATE UNIQUE INDEX center_notifications_digest ON public.center_notifications(user_id,digest_key) WHERE digest_key IS NOT NULL;
CREATE INDEX center_notifications_unread ON public.center_notifications(user_id,created_at DESC,id) WHERE read_at IS NULL AND hidden_at IS NULL;
CREATE TABLE public.notification_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id),events_enabled boolean NOT NULL DEFAULT false,delivery_enabled boolean NOT NULL DEFAULT false,stats_since timestamptz NOT NULL DEFAULT now());
INSERT INTO public.notification_settings(id) VALUES(true);
CREATE TABLE public.notification_preferences(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,followers boolean NOT NULL DEFAULT false,likes boolean NOT NULL DEFAULT false,comments boolean NOT NULL DEFAULT false,replies boolean NOT NULL DEFAULT false,authors boolean NOT NULL DEFAULT false,works boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text UNIQUE NOT NULL,kind text NOT NULL CHECK(kind IN ('author_follow','work_follow','work_like','entry_like','comment','reply','comment_like','new_work','new_entries','work_update')),actor_id uuid REFERENCES auth.users ON DELETE SET NULL,recipient_id uuid REFERENCES auth.users ON DELETE CASCADE,author_id uuid REFERENCES auth.users ON DELETE CASCADE,publication_id uuid REFERENCES public.published_works ON DELETE CASCADE,entry_id uuid,comment_id uuid,created_at timestamptz NOT NULL DEFAULT now(),cursor_id uuid,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','failed')),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,error_code text);
CREATE INDEX notification_outbox_actor ON public.notification_outbox(actor_id,created_at DESC);
CREATE INDEX notification_outbox_pending ON public.notification_outbox(available_at,created_at,id) WHERE state='pending';
CREATE INDEX notification_outbox_retention ON public.notification_outbox(finished_at) WHERE state='done';
CREATE TABLE public.notification_receipts(event_id uuid NOT NULL REFERENCES public.notification_outbox ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,delivered boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,user_id));
CREATE TABLE public.notification_manifests(publication_id uuid PRIMARY KEY REFERENCES public.published_works ON DELETE CASCADE,manifest jsonb NOT NULL,metadata_hash text NOT NULL);
CREATE TABLE public.author_metric_daily(publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,target_id uuid NOT NULL,day date NOT NULL,views bigint NOT NULL DEFAULT 0,likes bigint NOT NULL DEFAULT 0,comments bigint NOT NULL DEFAULT 0,favorites bigint NOT NULL DEFAULT 0,followers bigint NOT NULL DEFAULT 0,PRIMARY KEY(publication_id,target_id,day));
CREATE INDEX author_metric_daily_window ON public.author_metric_daily(publication_id,day);
CREATE TABLE public.author_follow_daily(author_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,day date NOT NULL,change bigint NOT NULL DEFAULT 0,PRIMARY KEY(author_id,day));
CREATE TABLE public.notification_operations(user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
CREATE INDEX notification_operations_rate ON public.notification_operations(user_id,created_at DESC);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['notification_settings','notification_preferences','notification_outbox','notification_receipts','notification_manifests','author_metric_daily','author_follow_daily','notification_operations'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
END LOOP;END $$;
CREATE POLICY preferences_owner ON public.notification_preferences FOR SELECT TO authenticated USING(user_id=auth.uid());
-- A snapshot fingerprint, not stored text or private draft data. Snapshot rebuilds are observed at transaction end.
CREATE FUNCTION public.notification_manifest(p_work uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_object_agg(e.id::text,encode(sha256(convert_to(jsonb_build_array(e.title,e.content,e.entry_type,e.position,e.alignment,(SELECT jsonb_agg(jsonb_build_array(v.asset_id,v.position,v.width,v.height) ORDER BY v.position) FROM public.published_visual_pages v WHERE v.entry_id=e.id))::text,'UTF8')),'hex')),'{}') FROM public.published_work_entries e WHERE e.publication_id=p_work;
$$;
INSERT INTO public.notification_manifests SELECT p.id,public.notification_manifest(p.id),encode(sha256(convert_to(jsonb_build_array(p.title,p.description,p.type,p.genre,p.language,p.age_rating,p.tags,p.content_warnings)::text,'UTF8')),'hex') FROM public.published_works p;
CREATE FUNCTION public.queue_social_event(p_key text,p_kind text,p_actor uuid,p_recipient uuid,p_author uuid,p_work uuid,p_entry uuid,p_comment uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF p_actor IS NULL THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('notification-producer:'||p_actor,0));
 IF(SELECT count(*) FROM public.notification_outbox WHERE actor_id=p_actor AND created_at>now()-interval '1 minute')>=60 THEN RETURN;END IF;
 IF NOT(SELECT events_enabled FROM public.notification_settings WHERE id) OR p_recipient=p_actor THEN RETURN;END IF;
 INSERT INTO public.notification_outbox(event_key,kind,actor_id,recipient_id,author_id,publication_id,entry_id,comment_id) VALUES(p_key,p_kind,p_actor,p_recipient,p_author,p_work,p_entry,p_comment) ON CONFLICT(event_key) DO NOTHING;
END $$;
CREATE FUNCTION public.capture_social_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid;recipient uuid;author uuid;pub uuid;entry uuid;comment uuid;kind text;event text;n bigint;BEGIN
 IF TG_TABLE_NAME='profile_follows' THEN actor:=NEW.follower_id;recipient:=NEW.followed_id;author:=recipient;kind:='author_follow';event:='author-follow:'||actor||':'||recipient;
 ELSE
  IF TG_TABLE_NAME='social_comment_likes' THEN
   SELECT c.publication_id,c.entry_id,c.id,c.user_id INTO pub,entry,comment,recipient FROM public.social_comments c WHERE c.id=NEW.comment_id AND c.status='visible';actor:=NEW.user_id;
   SELECT count(*) INTO n FROM public.social_comment_likes WHERE comment_id=NEW.comment_id;
   IF n NOT IN (1,5,10,25,50,100) THEN RETURN NEW;END IF;kind:='comment_like';event:='comment-like:'||comment||':'||n;
  ELSE pub:=NEW.publication_id;entry:=(to_jsonb(NEW)->>'entry_id')::uuid;actor:=NEW.user_id;
   IF TG_TABLE_NAME='social_likes' THEN kind:=CASE WHEN entry IS NULL THEN 'work_like' ELSE 'entry_like' END;event:='like:'||actor||':'||pub||':'||COALESCE(entry,pub);
   ELSIF TG_TABLE_NAME='social_work_follows' THEN kind:='work_follow';event:='work-follow:'||actor||':'||pub;
   ELSE comment:=NEW.id;kind:=CASE WHEN NEW.parent_id IS NULL THEN 'comment' ELSE 'reply' END;event:='comment:'||comment;
    IF NEW.parent_id IS NOT NULL THEN SELECT user_id INTO recipient FROM public.social_comments WHERE id=NEW.parent_id AND status='visible';END IF;
   END IF;
  END IF;
  SELECT w.owner_id INTO author FROM public.published_works p JOIN public.works w ON w.id=p.work_id WHERE p.id=pub AND p.is_public;
  IF author IS NULL OR(entry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_work_entries e WHERE e.id=entry AND e.publication_id=pub)) THEN RETURN NEW;END IF;
  IF kind='reply' AND recipient IS NOT NULL THEN PERFORM public.queue_social_event(event||':reply','reply',actor,recipient,author,pub,entry,comment);END IF;
  IF kind IN ('comment','reply') THEN
   -- One reply notification when author is also the parent-comment owner.
   IF author IS DISTINCT FROM recipient OR kind='comment' THEN PERFORM public.queue_social_event(event||':author','comment',actor,author,author,pub,entry,comment);END IF;RETURN NEW;
  END IF;
  recipient:=COALESCE(recipient,author);
 END IF;
 PERFORM public.queue_social_event(event,kind,actor,recipient,author,pub,entry,comment);RETURN NEW;
END $$;
CREATE TRIGGER social_notify_author_follow AFTER INSERT ON public.profile_follows FOR EACH ROW EXECUTE FUNCTION public.capture_social_notification();
CREATE TRIGGER social_notify_work_follow AFTER INSERT ON public.social_work_follows FOR EACH ROW EXECUTE FUNCTION public.capture_social_notification();
CREATE TRIGGER social_notify_like AFTER INSERT ON public.social_likes FOR EACH ROW EXECUTE FUNCTION public.capture_social_notification();
CREATE TRIGGER social_notify_comment AFTER INSERT ON public.social_comments FOR EACH ROW EXECUTE FUNCTION public.capture_social_notification();
CREATE TRIGGER social_notify_comment_like AFTER INSERT ON public.social_comment_likes FOR EACH ROW EXECUTE FUNCTION public.capture_social_notification();
CREATE FUNCTION public.capture_public_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot public.published_works%ROWTYPE;current_manifest jsonb;current_meta text;previous public.notification_manifests%ROWTYPE;owner uuid;is_new boolean;BEGIN
 SELECT * INTO snapshot FROM public.published_works WHERE id=NEW.id AND is_public;IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT owner_id INTO owner FROM public.works WHERE id=snapshot.work_id;
 current_manifest:=public.notification_manifest(snapshot.id);
 current_meta:=encode(sha256(convert_to(jsonb_build_array(snapshot.title,snapshot.description,snapshot.type,snapshot.genre,snapshot.language,snapshot.age_rating,snapshot.tags,snapshot.content_warnings)::text,'UTF8')),'hex');
 SELECT * INTO previous FROM public.notification_manifests WHERE publication_id=snapshot.id FOR UPDATE;is_new:=NOT FOUND;
 IF is_new OR current_manifest IS DISTINCT FROM previous.manifest OR current_meta IS DISTINCT FROM previous.metadata_hash THEN
  PERFORM public.queue_social_event('publication:'||snapshot.id||':'||snapshot.last_published_at::text||':'||encode(sha256(convert_to(current_manifest::text||current_meta,'UTF8')),'hex'),CASE WHEN is_new THEN 'new_work' WHEN EXISTS(SELECT 1 FROM jsonb_object_keys(current_manifest) k WHERE NOT previous.manifest ? k) THEN 'new_entries' ELSE 'work_update' END,owner,NULL,owner,snapshot.id,NULL,NULL);
 END IF;
 INSERT INTO public.notification_manifests VALUES(snapshot.id,current_manifest,current_meta) ON CONFLICT(publication_id) DO UPDATE SET manifest=EXCLUDED.manifest,metadata_hash=EXCLUDED.metadata_hash;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER social_notify_publication AFTER INSERT OR UPDATE ON public.published_works DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.capture_public_notification();
-- Aggregated deltas start NOW. Existing cumulative social counters are never replaced or backfilled as past daily data.
CREATE FUNCTION public.capture_author_metrics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rowdata jsonb;pub uuid;target uuid;author uuid;dv bigint:=0;dl bigint:=0;dc bigint:=0;df bigint:=0;dw bigint:=0;direction integer:=CASE WHEN TG_OP='DELETE' THEN -1 ELSE 1 END;BEGIN
 rowdata:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='profile_follows' THEN
  author:=(rowdata->>'followed_id')::uuid;IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=author) THEN RETURN NULL;END IF;INSERT INTO public.author_follow_daily VALUES(author,(now() AT TIME ZONE 'UTC')::date,direction) ON CONFLICT(author_id,day) DO UPDATE SET change=author_follow_daily.change+EXCLUDED.change;RETURN NULL;
 END IF;
 pub:=(rowdata->>'publication_id')::uuid;target:=COALESCE((rowdata->>'entry_id')::uuid,pub);
 IF TG_TABLE_NAME='social_statistics' THEN dv:=GREATEST(0,NEW.views-CASE WHEN TG_OP='UPDATE' THEN OLD.views ELSE 0 END);
 ELSIF TG_TABLE_NAME='social_likes' THEN dl:=direction;
 ELSIF TG_TABLE_NAME='social_work_follows' THEN dw:=direction;
 ELSIF TG_TABLE_NAME='social_library' THEN df:=CASE WHEN TG_OP='DELETE' THEN -(OLD.favorite::integer) WHEN TG_OP='INSERT' THEN NEW.favorite::integer ELSE NEW.favorite::integer-OLD.favorite::integer END;
 ELSIF TG_TABLE_NAME='social_comments' THEN dc:=CASE WHEN TG_OP='DELETE' THEN -((OLD.status='visible')::integer) WHEN TG_OP='INSERT' THEN (NEW.status='visible')::integer ELSE (NEW.status='visible')::integer-(OLD.status='visible')::integer END;END IF;
 IF dv=0 AND dl=0 AND dc=0 AND df=0 AND dw=0 THEN RETURN NULL;END IF;
 -- Parent deletion must not resurrect aggregates during FK cascades.
 IF NOT EXISTS(SELECT 1 FROM public.published_works WHERE id=pub) THEN RETURN NULL;END IF;
 INSERT INTO public.author_metric_daily VALUES(pub,target,(now() AT TIME ZONE 'UTC')::date,dv,dl,dc,df,dw) ON CONFLICT(publication_id,target_id,day) DO UPDATE SET views=author_metric_daily.views+EXCLUDED.views,likes=author_metric_daily.likes+EXCLUDED.likes,comments=author_metric_daily.comments+EXCLUDED.comments,favorites=author_metric_daily.favorites+EXCLUDED.favorites,followers=author_metric_daily.followers+EXCLUDED.followers;RETURN NULL;
END $$;
CREATE TRIGGER analytics_views AFTER INSERT OR UPDATE ON public.social_statistics FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE TRIGGER analytics_likes AFTER INSERT OR DELETE ON public.social_likes FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE TRIGGER analytics_comments AFTER INSERT OR UPDATE OR DELETE ON public.social_comments FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE TRIGGER analytics_library AFTER INSERT OR UPDATE OR DELETE ON public.social_library FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE TRIGGER analytics_work_follows AFTER INSERT OR DELETE ON public.social_work_follows FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE TRIGGER analytics_author_follows AFTER INSERT OR DELETE ON public.profile_follows FOR EACH ROW EXECUTE FUNCTION public.capture_author_metrics();
CREATE FUNCTION public.process_social_jobs(p_proof text,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE e public.notification_outbox%ROWTYPE;recipient uuid;category text;digest text;title text;body text;delivered integer:=0;processed integer:=0;budget integer:=GREATEST(1,LEAST(COALESCE(p_limit,100),100));batch integer;counted integer;notification uuid;BEGIN
 IF p_proof IS NULL OR length(p_proof)<32 OR NOT EXISTS(SELECT 1 FROM public.social_metric_settings WHERE id AND token_hash=encode(sha256(convert_to(p_proof,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Server proof required' USING ERRCODE='42501';END IF;
 IF NOT(SELECT delivery_enabled FROM public.notification_settings WHERE id) THEN RETURN '{"enabled":false,"processed":0,"delivered":0}';END IF;
 FOR e IN SELECT * FROM public.notification_outbox WHERE state='pending' AND available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 10 LOOP
  EXIT WHEN processed>=budget;batch:=0;counted:=0;
  BEGIN
   IF (e.publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_works WHERE id=e.publication_id AND is_public))
    OR(e.entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_work_entries WHERE id=e.entry_id AND publication_id=e.publication_id))
    OR(e.comment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.social_comments WHERE id=e.comment_id AND status='visible'))
    OR(e.kind='author_follow' AND NOT EXISTS(SELECT 1 FROM public.profile_follows WHERE follower_id=e.actor_id AND followed_id=e.recipient_id))
    OR(e.kind='work_follow' AND NOT EXISTS(SELECT 1 FROM public.social_work_follows WHERE user_id=e.actor_id AND publication_id=e.publication_id))
    OR(e.kind IN ('work_like','entry_like') AND NOT EXISTS(SELECT 1 FROM public.social_likes WHERE user_id=e.actor_id AND publication_id=e.publication_id AND target_id=COALESCE(e.entry_id,e.publication_id))) THEN
     UPDATE public.notification_outbox SET state='done',finished_at=now() WHERE id=e.id;CONTINUE;
   END IF;
   category:=CASE WHEN e.kind IN ('author_follow','work_follow') THEN 'followers' WHEN e.kind IN ('work_like','entry_like','comment_like') THEN 'likes' WHEN e.kind='reply' THEN 'replies' WHEN e.kind='comment' THEN 'comments' ELSE 'publications' END;
   title:=CASE category WHEN 'followers' THEN 'Novos seguidores' WHEN 'likes' THEN 'Novas curtidas' WHEN 'replies' THEN 'Resposta ao teu comentário' WHEN 'comments' THEN 'Comentários na tua obra' ELSE CASE WHEN e.kind='new_work' THEN 'Nova obra publicada' WHEN e.kind='new_entries' THEN 'Novos capítulos ou episódios publicados' ELSE 'Atualização pública de uma obra seguida' END END;
   body:=CASE category WHEN 'followers' THEN 'Uma conta começou a acompanhar o teu perfil ou obra.' WHEN 'likes' THEN 'A tua obra, capítulo ou comentário recebeu novas curtidas.' WHEN 'replies' THEN 'Foi publicada uma resposta ao teu comentário.' WHEN 'comments' THEN 'Foi publicado um comentário numa obra tua.' ELSE 'Há conteúdo público para consultar. Rascunhos privados não são incluídos.' END;
   FOR recipient IN
    SELECT targets.u FROM(
     SELECT e.recipient_id AS u WHERE e.recipient_id IS NOT NULL
     UNION SELECT f.follower_id FROM public.profile_follows f WHERE e.kind IN ('new_work','new_entries','work_update') AND f.followed_id=e.author_id AND f.created_at<=e.created_at
     UNION SELECT f.user_id FROM public.social_work_follows f WHERE e.kind IN ('new_work','new_entries','work_update') AND f.publication_id=e.publication_id AND f.created_at<=e.created_at
    )targets JOIN public.notification_preferences pref ON pref.user_id=targets.u AND pref.updated_at<=e.created_at
    WHERE targets.u<>e.actor_id AND(e.cursor_id IS NULL OR targets.u>e.cursor_id)
    AND CASE category WHEN 'followers' THEN pref.followers WHEN 'likes' THEN pref.likes WHEN 'comments' THEN pref.comments WHEN 'replies' THEN pref.replies ELSE
     (pref.authors AND EXISTS(SELECT 1 FROM public.profile_follows f WHERE f.follower_id=targets.u AND f.followed_id=e.author_id AND f.created_at<=e.created_at)) OR(pref.works AND EXISTS(SELECT 1 FROM public.social_work_follows f WHERE f.user_id=targets.u AND f.publication_id=e.publication_id AND f.created_at<=e.created_at)) END
    ORDER BY targets.u LIMIT budget-processed
   LOOP
    batch:=batch+1;
    -- Serialize recipient quota/digest changes with concurrent workers and preference updates.
    PERFORM 1 FROM public.notification_preferences WHERE user_id=recipient AND updated_at<=e.created_at FOR UPDATE;
    IF NOT FOUND THEN INSERT INTO public.notification_receipts VALUES(e.id,recipient,false,now()) ON CONFLICT DO NOTHING;UPDATE public.notification_outbox SET cursor_id=recipient WHERE id=e.id;CONTINUE;END IF;
    IF NOT EXISTS(SELECT 1 FROM public.notification_receipts WHERE event_id=e.id AND user_id=recipient) THEN
     digest:=category||':'||COALESCE(e.comment_id,e.entry_id,e.publication_id,e.author_id,e.recipient_id)::text||':'||(e.created_at AT TIME ZONE 'UTC')::date::text;
     notification:=NULL;
     IF EXISTS(SELECT 1 FROM public.center_notifications WHERE user_id=recipient AND digest_key=digest) OR(SELECT count(*) FROM public.center_notifications WHERE user_id=recipient AND kind='social' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<20 THEN
      INSERT INTO public.center_notifications(user_id,kind,event_key,title,body,context,category,digest_key,last_event_at) VALUES(recipient,'social','social:'||e.id::text,title,body,jsonb_strip_nulls(jsonb_build_object('work',e.publication_id,'entry',e.entry_id,'comment',e.comment_id,'profile',CASE WHEN e.kind='author_follow' THEN e.recipient_id END)),category,digest,now())
      ON CONFLICT(user_id,digest_key) WHERE digest_key IS NOT NULL DO UPDATE SET last_event_at=now(),group_count=center_notifications.group_count+1,title=EXCLUDED.title,body=EXCLUDED.body,context=EXCLUDED.context,read_at=CASE WHEN center_notifications.hidden_at IS NULL THEN NULL ELSE center_notifications.read_at END RETURNING id INTO notification;
     END IF;
     INSERT INTO public.notification_receipts VALUES(e.id,recipient,notification IS NOT NULL,now());IF notification IS NOT NULL THEN counted:=counted+1;END IF;
    END IF;
    UPDATE public.notification_outbox SET cursor_id=recipient WHERE id=e.id;
   END LOOP;
   IF batch<budget-processed THEN UPDATE public.notification_outbox SET state='done',finished_at=now() WHERE id=e.id;END IF;
   processed:=processed+batch;delivered:=delivered+counted;
  EXCEPTION WHEN OTHERS THEN
   UPDATE public.notification_outbox SET attempts=attempts+1,state=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END,error_code=SQLSTATE,available_at=now()+make_interval(mins=>LEAST(60,power(2,attempts)::integer)) WHERE id=e.id;
  END;
 END LOOP;
 -- Bounded maintenance: no reading data, personal inbox or service notices are removed here.
 DELETE FROM public.notification_outbox WHERE id IN(SELECT id FROM public.notification_outbox WHERE state='done' AND finished_at<now()-interval '90 days' ORDER BY finished_at,id LIMIT 100);
 DELETE FROM public.notification_operations WHERE (user_id,id) IN(SELECT user_id,id FROM public.notification_operations WHERE created_at<now()-interval '90 days' ORDER BY created_at,user_id,id LIMIT 100);
 RETURN jsonb_build_object('enabled',true,'processed',processed,'delivered',delivered);
END $$;
CREATE FUNCTION public.notification_context(p_context jsonb) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pub uuid;entry uuid;public_username text;BEGIN
 IF p_context ? 'profile' THEN SELECT username INTO public_username FROM public.profiles WHERE id=(p_context->>'profile')::uuid;RETURN CASE WHEN public_username IS NOT NULL THEN '/utilizadores/'||public_username END;END IF;
 pub:=(p_context->>'work')::uuid;entry:=(p_context->>'entry')::uuid;
 IF pub IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.published_works WHERE id=pub AND is_public) OR(entry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_work_entries WHERE id=entry AND publication_id=pub)) OR(p_context ? 'comment' AND NOT EXISTS(SELECT 1 FROM public.social_comments WHERE id=(p_context->>'comment')::uuid AND publication_id=pub AND status='visible')) THEN RETURN NULL;END IF;
  RETURN '/obras/'||pub||CASE WHEN entry IS NOT NULL THEN '/capitulos/'||entry ELSE '' END;
 END IF;RETURN NULL;
END $$;
CREATE FUNCTION public.notification_member(p_action text,p_data jsonb DEFAULT '{}',p_operation uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE actor uuid:=auth.uid();pref public.notification_preferences%ROWTYPE;fp text;receipt public.notification_operations%ROWTYPE;result jsonb;k text;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>8000 THEN RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';END IF;
 IF p_action='count' THEN RETURN jsonb_build_object('unread',(SELECT count(*) FROM public.center_notifications WHERE user_id=actor AND read_at IS NULL AND hidden_at IS NULL),'as_of',now());
 ELSIF p_action='preferences' THEN
  SELECT * INTO pref FROM public.notification_preferences WHERE user_id=actor;
  RETURN jsonb_build_object('followers',COALESCE(pref.followers,false),'likes',COALESCE(pref.likes,false),'comments',COALESCE(pref.comments,false),'replies',COALESCE(pref.replies,false),'authors',COALESCE(pref.authors,false),'works',COALESCE(pref.works,false),'revision',COALESCE(pref.revision,0),'official',COALESCE((SELECT official FROM public.center_preferences WHERE user_id=actor),false));
 ELSIF p_action='list' THEN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at DESC,row.id DESC) FROM(SELECT n.id,n.kind,n.category,n.title,n.body,n.context,n.read_at,n.created_at,n.group_count,CASE WHEN n.kind='social' THEN public.notification_context(n.context) END AS path FROM public.center_notifications n WHERE n.user_id=actor AND n.hidden_at IS NULL AND (COALESCE(p_data->>'filter','all')='all' OR(p_data->>'filter'='unread' AND n.read_at IS NULL) OR p_data->>'filter'=n.kind OR p_data->>'filter'=n.category OR(p_data->>'filter'='interactions' AND n.category IN ('likes','comments','replies'))) AND(p_data->>'before' IS NULL OR(n.created_at,n.id)<((p_data->>'before')::timestamptz,COALESCE((p_data->>'before_id')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))) ORDER BY n.created_at DESC,n.id DESC LIMIT 20)row),'[]');
 END IF;
 IF p_operation IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('notification-member:'||actor,0));fp:=encode(sha256(convert_to(jsonb_build_array(p_action,p_data)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.notification_operations WHERE user_id=actor AND id=p_operation;
 IF FOUND THEN IF receipt.fingerprint<>fp THEN RAISE EXCEPTION 'Operation reused' USING ERRCODE='22023';END IF;RETURN receipt.result;END IF;
 IF(SELECT count(*) FROM public.notification_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Rate limited' USING ERRCODE='54000';END IF;
 IF p_action='preferences_save' THEN
  SELECT * INTO pref FROM public.notification_preferences WHERE user_id=actor;
  IF COALESCE(pref.revision,0) IS DISTINCT FROM (p_data->>'revision')::bigint THEN RAISE EXCEPTION 'Preference conflict' USING ERRCODE='40001';END IF;
  FOREACH k IN ARRAY ARRAY['followers','likes','comments','replies','authors','works','official'] LOOP IF jsonb_typeof(p_data->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid preference' USING ERRCODE='22023';END IF;END LOOP;
  INSERT INTO public.notification_preferences(user_id,followers,likes,comments,replies,authors,works) VALUES(actor,(p_data->>'followers')::boolean,(p_data->>'likes')::boolean,(p_data->>'comments')::boolean,(p_data->>'replies')::boolean,(p_data->>'authors')::boolean,(p_data->>'works')::boolean) ON CONFLICT(user_id) DO UPDATE SET followers=EXCLUDED.followers,likes=EXCLUDED.likes,comments=EXCLUDED.comments,replies=EXCLUDED.replies,authors=EXCLUDED.authors,works=EXCLUDED.works,revision=notification_preferences.revision+1,updated_at=now();
  INSERT INTO public.center_preferences(user_id,official) VALUES(actor,(p_data->>'official')::boolean) ON CONFLICT(user_id) DO UPDATE SET official=EXCLUDED.official,updated_at=now();
 ELSIF p_action IN ('read','hide') THEN
  UPDATE public.center_notifications SET read_at=CASE WHEN p_action='read' THEN COALESCE(read_at,now()) ELSE read_at END,hidden_at=CASE WHEN p_action='hide' THEN now() ELSE hidden_at END WHERE user_id=actor AND id=(p_data->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 ELSIF p_action='read_all' THEN
  IF p_data->>'as_of' IS NULL THEN RAISE EXCEPTION 'Cutoff required' USING ERRCODE='22023';END IF;
  UPDATE public.center_notifications SET read_at=now() WHERE user_id=actor AND read_at IS NULL AND hidden_at IS NULL AND COALESCE(last_event_at,created_at)<=LEAST((p_data->>'as_of')::timestamptz,now());
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 result:='{"ok":true}';INSERT INTO public.notification_operations VALUES(actor,p_operation,fp,result,now());RETURN result;
END $$;
CREATE VIEW public.author_analytics_rows AS
 SELECT p.id,w.owner_id,p.title,p.type AS format,p.is_public,p.last_published_at,
 COALESCE((SELECT views FROM public.social_statistics s WHERE s.publication_id=p.id AND s.entry_id IS NULL),0) AS views,
 COALESCE((SELECT sum(views) FROM public.social_statistics s WHERE s.publication_id=p.id AND s.entry_id IS NOT NULL),0) AS reads,
 (SELECT count(*) FROM public.social_likes s WHERE s.publication_id=p.id AND s.entry_id IS NULL) AS likes,
 (SELECT count(*) FROM public.social_likes s WHERE s.publication_id=p.id AND s.entry_id IS NOT NULL) AS chapter_likes,
 (SELECT count(*) FROM public.social_comments s WHERE s.publication_id=p.id AND s.status='visible') AS comments,
 (SELECT count(*) FROM public.social_library s WHERE s.publication_id=p.id AND s.favorite) AS favorites,
 (SELECT count(*) FROM public.social_work_follows s WHERE s.publication_id=p.id) AS followers
 FROM public.published_works p JOIN public.works w ON w.id=p.work_id;
REVOKE ALL ON public.author_analytics_rows FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.author_analytics(p_action text DEFAULT 'overview',p_work uuid DEFAULT NULL,p_before uuid DEFAULT NULL,p_period integer DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();since timestamptz;start_day date;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';END IF;
 IF p_work IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_works p JOIN public.works w ON w.id=p.work_id WHERE p.id=p_work AND w.owner_id=actor) THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 SELECT stats_since INTO since FROM public.notification_settings WHERE id;start_day:=GREATEST((since AT TIME ZONE 'UTC')::date,(now() AT TIME ZONE 'UTC')::date-GREATEST(1,LEAST(COALESCE(p_period,30),90))+1);
 IF p_action='overview' THEN
  RETURN jsonb_build_object('as_of',now(),'stats_since',since,'period_start',start_day,'partial_period',since>now()-make_interval(days=>GREATEST(1,LEAST(COALESCE(p_period,30),90))),
  'published',(SELECT count(*) FROM public.author_analytics_rows WHERE owner_id=actor AND is_public),'writer_followers',(SELECT count(*) FROM public.profile_follows WHERE followed_id=actor),
  'writer_followers_change',(SELECT COALESCE(sum(change),0) FROM public.author_follow_daily WHERE author_id=actor AND day>=start_day),
  'totals',(SELECT jsonb_build_object('views',COALESCE(sum(views),0),'reads',COALESCE(sum(reads),0),'likes',COALESCE(sum(likes),0),'chapter_likes',COALESCE(sum(chapter_likes),0),'comments',COALESCE(sum(comments),0),'favorites',COALESCE(sum(favorites),0),'followers',COALESCE(sum(followers),0)) FROM public.author_analytics_rows WHERE owner_id=actor AND(p_work IS NULL OR id=p_work)));
 ELSIF p_action='works' THEN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row)-'owner_id' ORDER BY row.id) FROM(SELECT * FROM public.author_analytics_rows WHERE owner_id=actor AND(p_before IS NULL OR id>p_before) ORDER BY id LIMIT 20)row),'[]');
 ELSIF p_action='chapters' THEN
  IF p_work IS NULL THEN RETURN '[]';END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.reads DESC,row.id) FROM(SELECT targets.id,e.title,e.id IS NOT NULL AS current_entry,COALESCE(s.views,0) AS reads,(SELECT count(*) FROM public.social_likes l WHERE l.publication_id=p_work AND l.entry_id=targets.id) AS likes,(SELECT count(*) FROM public.social_comments c WHERE c.publication_id=p_work AND c.entry_id=targets.id AND c.status='visible') AS comments FROM(SELECT id FROM public.published_work_entries WHERE publication_id=p_work UNION SELECT entry_id FROM public.social_statistics WHERE publication_id=p_work AND entry_id IS NOT NULL)targets LEFT JOIN public.published_work_entries e ON e.id=targets.id AND e.publication_id=p_work LEFT JOIN public.social_statistics s ON s.publication_id=p_work AND s.entry_id=targets.id WHERE(p_before IS NULL OR COALESCE(s.views,0)<COALESCE((SELECT views FROM public.social_statistics cursor_stats WHERE cursor_stats.publication_id=p_work AND cursor_stats.entry_id=p_before),0) OR(COALESCE(s.views,0)=COALESCE((SELECT views FROM public.social_statistics cursor_stats WHERE cursor_stats.publication_id=p_work AND cursor_stats.entry_id=p_before),0) AND targets.id>p_before)) ORDER BY COALESCE(s.views,0) DESC,targets.id LIMIT 20)row),'[]');
 ELSIF p_action='daily' THEN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.day) FROM(SELECT d.day,sum(CASE WHEN d.target_id=d.publication_id THEN d.views ELSE 0 END) AS views,sum(CASE WHEN d.target_id<>d.publication_id THEN d.views ELSE 0 END) AS reads,sum(d.likes) AS likes_change,sum(d.comments) AS comments_change,sum(d.favorites) AS favorites_change,sum(d.followers) AS followers_change FROM public.author_metric_daily d JOIN public.published_works p ON p.id=d.publication_id JOIN public.works w ON w.id=p.work_id WHERE w.owner_id=actor AND(p_work IS NULL OR p.id=p_work) AND d.day>=start_day GROUP BY d.day ORDER BY d.day LIMIT 90)row),'[]');
 END IF;RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.notification_diagnostics(p_retry uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.center_is_admin() THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002';END IF;
 IF p_retry IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.center_audit WHERE actor_id=auth.uid() AND action='notification_retry' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Retry limited' USING ERRCODE='54000';END IF;
  UPDATE public.notification_outbox SET state='pending',attempts=0,available_at=now(),error_code=NULL WHERE id=p_retry AND state='failed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
  INSERT INTO public.center_audit(actor_id,action,target_id) VALUES(auth.uid(),'notification_retry',p_retry);
 END IF;
 RETURN jsonb_build_object('events_enabled',(SELECT events_enabled FROM public.notification_settings WHERE id),'delivery_enabled',(SELECT delivery_enabled FROM public.notification_settings WHERE id),'pending',(SELECT count(*) FROM public.notification_outbox WHERE state='pending'),'failed',(SELECT count(*) FROM public.notification_outbox WHERE state='failed'),'done',(SELECT count(*) FROM public.notification_outbox WHERE state='done'),'oldest_pending',(SELECT min(created_at) FROM public.notification_outbox WHERE state='pending'),'failed_batches',COALESCE((SELECT jsonb_agg(row) FROM(SELECT id,attempts,error_code,available_at FROM public.notification_outbox WHERE state='failed' ORDER BY created_at,id LIMIT 20)row),'[]'),'as_of',now());
END $$;
-- Revoke permissive defaults on EVERY privileged function before granting just the intended RPC entry points.
REVOKE ALL ON FUNCTION public.notification_manifest(uuid),public.queue_social_event(text,text,uuid,uuid,uuid,uuid,uuid,uuid),public.capture_social_notification(),public.capture_public_notification(),public.capture_author_metrics(),public.notification_context(jsonb),public.process_social_jobs(text,integer),public.notification_member(text,jsonb,uuid),public.author_analytics(text,uuid,uuid,integer),public.notification_diagnostics(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_member(text,jsonb,uuid),public.author_analytics(text,uuid,uuid,integer),public.notification_diagnostics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_social_jobs(text,integer) TO anon;
COMMIT;
