-- F5.1 local only. Public interaction targets are F3/F4 snapshots, never private IDs.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.profile_follows') IS NULL OR to_regclass('public.published_work_entries') IS NULL
 OR to_regclass('public.published_visual_pages') IS NULL THEN RAISE EXCEPTION 'Install F4.1 and F4.2-C first'; END IF;
END $$;
-- Chapter UUIDs are historical public identities, deliberately NOT cascading FKs to
-- published_work_entries: F4 rebuilds those rows on snapshot refresh. Every RPC
-- verifies the current chapter/publication pair before exposing or mutating data.
CREATE TABLE public.social_likes (
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 entry_id uuid, target_id uuid GENERATED ALWAYS AS (COALESCE(entry_id,publication_id)) STORED,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,publication_id,target_id)
);
CREATE INDEX social_likes_target ON public.social_likes(publication_id,target_id);
CREATE TABLE public.social_work_follows (
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,publication_id)
);
CREATE INDEX social_work_follows_target ON public.social_work_follows(publication_id);
CREATE TABLE public.social_library (
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 saved boolean NOT NULL DEFAULT false, favorite boolean NOT NULL DEFAULT false, later boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,publication_id)
);
CREATE INDEX social_library_owner_updated ON public.social_library(user_id,updated_at DESC,publication_id);
CREATE TABLE public.social_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users ON DELETE SET NULL,
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 entry_id uuid, parent_id uuid REFERENCES public.social_comments ON DELETE CASCADE,
 body text NOT NULL CHECK(char_length(body)<=4000), status text NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','deleted','hidden')),
 created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz
);
CREATE INDEX social_comments_target ON public.social_comments(publication_id,COALESCE(entry_id,publication_id),created_at DESC,id DESC);
CREATE INDEX social_comments_visible_count ON public.social_comments(publication_id,COALESCE(entry_id,publication_id)) WHERE status='visible';
CREATE INDEX social_comments_user_time ON public.social_comments(user_id,created_at DESC);
CREATE TABLE public.social_comment_likes (
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 comment_id uuid NOT NULL REFERENCES public.social_comments ON DELETE CASCADE,
 PRIMARY KEY(user_id,comment_id)
);
CREATE INDEX social_comment_likes_target ON public.social_comment_likes(comment_id);
CREATE TABLE public.social_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users ON DELETE SET NULL,
 comment_id uuid NOT NULL REFERENCES public.social_comments ON DELETE CASCADE,
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 500),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,comment_id)
);
CREATE INDEX social_reports_actor_time ON public.social_reports(user_id,created_at DESC);
CREATE INDEX social_reports_queue ON public.social_reports(status,created_at,id);
CREATE TABLE public.social_moderators(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE);
CREATE TABLE public.social_moderation_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES auth.users ON DELETE SET NULL,
 comment_id uuid REFERENCES public.social_comments ON DELETE SET NULL, action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.social_operations(
 user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, operation_id uuid NOT NULL,
 fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE INDEX social_operations_rate ON public.social_operations(user_id,created_at DESC);
CREATE TABLE public.social_metric_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), token_hash text CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 network_daily_limit integer NOT NULL DEFAULT 240 CHECK(network_daily_limit BETWEEN 1 AND 10000)
);
INSERT INTO public.social_metric_settings(id) VALUES(true);
CREATE TABLE public.social_metric_visitors(
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 entry_id uuid, target_id uuid GENERATED ALWAYS AS (COALESCE(entry_id,publication_id)) STORED,
 visitor_hash text NOT NULL CHECK(visitor_hash ~ '^[a-f0-9]{64}$'), last_seen timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(publication_id,target_id,visitor_hash)
);
CREATE TABLE public.social_metric_networks(
 network_hash text NOT NULL CHECK(network_hash ~ '^[a-f0-9]{64}$'), day date NOT NULL,
 hits integer NOT NULL DEFAULT 0, PRIMARY KEY(network_hash,day)
);
CREATE TABLE public.social_statistics(
 publication_id uuid NOT NULL REFERENCES public.published_works ON DELETE CASCADE,
 entry_id uuid, target_id uuid GENERATED ALWAYS AS (COALESCE(entry_id,publication_id)) STORED,
 views bigint NOT NULL DEFAULT 0 CHECK(views>=0), visitors bigint NOT NULL DEFAULT 0 CHECK(visitors>=0),
 PRIMARY KEY(publication_id,target_id)
);
-- No default table/function grants may leak identities, receipts, reports or hashes.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['social_likes','social_work_follows','social_library','social_comments','social_comment_likes',
 'social_reports','social_moderators','social_moderation_log','social_operations','social_metric_settings','social_metric_visitors','social_metric_networks','social_statistics'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
-- RPC-only writes; explicit owner policies provide defence in depth for personal data.
CREATE POLICY social_library_owner ON public.social_library FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY social_likes_owner ON public.social_likes FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY social_follows_owner ON public.social_work_follows FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE FUNCTION public.social_assert_target(p_work uuid,p_entry uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM 1 FROM public.published_works WHERE id=p_work AND is_public FOR SHARE;
 IF NOT FOUND OR (p_entry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.published_work_entries WHERE id=p_entry AND publication_id=p_work)) THEN
 RAISE EXCEPTION 'Public content unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.social_assert_target(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.read_social_state(p_work uuid,p_entry uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); result jsonb; BEGIN
 PERFORM public.social_assert_target(p_work,p_entry);
 SELECT pg_catalog.jsonb_build_object(
 'likes',(SELECT count(*) FROM public.social_likes WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),
 'comments',(SELECT count(*) FROM public.social_comments WHERE publication_id=p_work AND COALESCE(entry_id,publication_id)=COALESCE(p_entry,p_work) AND status='visible'),
 'followers',(SELECT count(*) FROM public.social_work_follows WHERE publication_id=p_work),
 'liked',EXISTS(SELECT 1 FROM public.social_likes WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work) AND user_id=actor),
 'following',EXISTS(SELECT 1 FROM public.social_work_follows WHERE publication_id=p_work AND user_id=actor),
 'saved',COALESCE((SELECT saved FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'favorite',COALESCE((SELECT favorite FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'later',COALESCE((SELECT later FROM public.social_library WHERE publication_id=p_work AND user_id=actor),false),
 'views',COALESCE((SELECT views FROM public.social_statistics WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),0),
 'visitors',COALESCE((SELECT visitors FROM public.social_statistics WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work)),0),
 'can_moderate',EXISTS(SELECT 1 FROM public.social_moderators WHERE user_id=actor)) INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_state(uuid,uuid) TO anon,authenticated;

CREATE FUNCTION public.mutate_social(p_work uuid,p_entry uuid,p_action text,p_payload jsonb,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); fp text; receipt public.social_operations%ROWTYPE;
 c public.social_comments%ROWTYPE; cid uuid; desired boolean; result jsonb:='{"ok":true}'::jsonb;
BEGIN
 IF actor IS NULL OR p_work IS NULL OR p_operation IS NULL OR p_action IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 fp:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_work,p_entry,p_action,p_payload)::text,'UTF8')),'hex');
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('social:'||actor::text,0));
 SELECT * INTO receipt FROM public.social_operations WHERE user_id=actor AND operation_id=p_operation;
 IF FOUND THEN
  IF receipt.fingerprint<>fp THEN RAISE EXCEPTION 'Operation key reused' USING ERRCODE='22023'; END IF;
  RETURN receipt.result;
 END IF;
 IF (SELECT count(*) FROM public.social_operations WHERE user_id=actor AND created_at>now()-interval '1 minute')>=120 THEN RAISE EXCEPTION 'Too many operations' USING ERRCODE='54000'; END IF;
 -- Own deletion remains possible after withdrawal; all other actions require a public target.
 IF p_action<>'delete_comment' AND NOT(p_action='follow' AND p_payload->'value'='false'::jsonb) THEN PERFORM public.social_assert_target(p_work,p_entry); END IF;
 IF p_action IN ('like','follow','saved','favorite','later','comment_like') THEN
  IF jsonb_typeof(p_payload->'value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Boolean required' USING ERRCODE='22023'; END IF;
  desired:=(p_payload->>'value')::boolean;
 END IF;
 IF p_action='like' THEN
  IF desired THEN INSERT INTO public.social_likes(user_id,publication_id,entry_id) VALUES(actor,p_work,p_entry) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.social_likes WHERE user_id=actor AND publication_id=p_work AND target_id=COALESCE(p_entry,p_work); END IF;
 ELSIF p_action='follow' THEN
  IF desired THEN INSERT INTO public.social_work_follows(user_id,publication_id) VALUES(actor,p_work) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.social_work_follows WHERE user_id=actor AND publication_id=p_work; END IF;
 ELSIF p_action IN ('saved','favorite','later') THEN
  INSERT INTO public.social_library(user_id,publication_id) VALUES(actor,p_work) ON CONFLICT DO NOTHING;
  UPDATE public.social_library SET saved=CASE WHEN p_action='saved' THEN desired ELSE saved END,
    favorite=CASE WHEN p_action='favorite' THEN desired ELSE favorite END,later=CASE WHEN p_action='later' THEN desired ELSE later END,updated_at=now()
    WHERE user_id=actor AND publication_id=p_work;
  DELETE FROM public.social_library WHERE user_id=actor AND publication_id=p_work AND NOT(saved OR favorite OR later);
 ELSIF p_action='comment' THEN
  IF p_payload->>'body' IS NULL OR (char_length(p_payload->>'body') NOT BETWEEN 1 AND 4000 OR p_payload->>'body' !~ '[^[:space:]]') THEN RAISE EXCEPTION 'Invalid comment' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.social_comments WHERE user_id=actor AND created_at>now()-interval '10 seconds') OR
   (SELECT count(*) FROM public.social_comments WHERE user_id=actor AND created_at>now()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Comment rate limited' USING ERRCODE='54000'; END IF;
  cid:=NULLIF(p_payload->>'parent_id','')::uuid;
  IF cid IS NOT NULL THEN
   SELECT * INTO c FROM public.social_comments WHERE id=cid AND publication_id=p_work AND entry_id IS NOT DISTINCT FROM p_entry FOR UPDATE;
   IF NOT FOUND OR c.status<>'visible' OR c.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid reply target' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.social_comments(user_id,publication_id,entry_id,parent_id,body) VALUES(actor,p_work,p_entry,cid,btrim(p_payload->>'body')) RETURNING id INTO cid;
  result:=pg_catalog.jsonb_build_object('ok',true,'comment_id',cid);
 ELSIF p_action IN ('edit_comment','delete_comment','comment_like','report','hide','restore_comment','dismiss_report') THEN
  cid:=(p_payload->>'comment_id')::uuid;
  SELECT * INTO c FROM public.social_comments WHERE id=cid AND publication_id=p_work AND entry_id IS NOT DISTINCT FROM p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
  IF p_action IN ('edit_comment','delete_comment') THEN
   IF c.user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Comment owner required' USING ERRCODE='42501'; END IF;
   IF p_action='delete_comment' THEN UPDATE public.social_comments SET body='',status='deleted',edited_at=now() WHERE id=cid;
   ELSE
    IF c.status<>'visible' OR p_payload->>'body' IS NULL OR (char_length(p_payload->>'body') NOT BETWEEN 1 AND 4000 OR p_payload->>'body' !~ '[^[:space:]]') THEN RAISE EXCEPTION 'Invalid comment' USING ERRCODE='22023'; END IF;
    IF c.edited_at>now()-interval '5 seconds' THEN RAISE EXCEPTION 'Edit rate limited' USING ERRCODE='54000'; END IF;
    UPDATE public.social_comments SET body=btrim(p_payload->>'body'),edited_at=now() WHERE id=cid;
   END IF;
  ELSIF p_action='comment_like' THEN
   IF c.status<>'visible' THEN RAISE EXCEPTION 'Comment unavailable' USING ERRCODE='42501'; END IF;
   IF desired THEN INSERT INTO public.social_comment_likes VALUES(actor,cid) ON CONFLICT DO NOTHING;
   ELSE DELETE FROM public.social_comment_likes WHERE user_id=actor AND comment_id=cid; END IF;
  ELSIF p_action='report' THEN
   IF c.status<>'visible' OR p_payload->>'reason' IS NULL OR char_length(btrim(p_payload->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid report' USING ERRCODE='22023'; END IF;
   IF (SELECT count(*) FROM public.social_reports WHERE user_id=actor AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Report rate limited' USING ERRCODE='54000'; END IF;
   INSERT INTO public.social_reports(user_id,comment_id,reason) VALUES(actor,cid,btrim(p_payload->>'reason')) ON CONFLICT(user_id,comment_id) DO NOTHING;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.social_moderators WHERE user_id=actor) THEN RAISE EXCEPTION 'Moderator required' USING ERRCODE='42501'; END IF;
   IF p_action='hide' THEN UPDATE public.social_comments SET status='hidden' WHERE id=cid AND status='visible';
   ELSIF p_action='restore_comment' THEN UPDATE public.social_comments SET status='visible' WHERE id=cid AND status='hidden'; END IF;
   UPDATE public.social_reports SET status=CASE WHEN p_action='dismiss_report' THEN 'dismissed' ELSE 'resolved' END WHERE comment_id=cid AND status='open';
   INSERT INTO public.social_moderation_log(actor_id,comment_id,action) VALUES(actor,cid,p_action);
  END IF;
 ELSE RAISE EXCEPTION 'Unknown social action' USING ERRCODE='22023'; END IF;
 INSERT INTO public.social_operations(user_id,operation_id,fingerprint,result) VALUES(actor,p_operation,fp,result);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.mutate_social(uuid,uuid,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_social(uuid,uuid,text,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.read_social_comments(p_work uuid,p_entry uuid DEFAULT NULL,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.social_assert_target(p_work,p_entry);
 RETURN COALESCE((SELECT pg_catalog.jsonb_agg(row ORDER BY row.created_at DESC,row.id DESC) FROM (
 SELECT c.id,c.parent_id,c.created_at,c.edited_at,c.status,
 CASE WHEN c.status='visible' THEN c.body ELSE '' END AS body,
 pr.display_name AS author_name,pr.username AS author_username,
 c.user_id=auth.uid() AS own,
 (SELECT count(*) FROM public.social_comment_likes l WHERE l.comment_id=c.id AND c.status='visible') AS likes,
 EXISTS(SELECT 1 FROM public.social_comment_likes l WHERE l.comment_id=c.id AND l.user_id=auth.uid()) AND c.status='visible' AS liked
 FROM public.social_comments c LEFT JOIN public.profiles pr ON pr.id=c.user_id
 WHERE c.publication_id=p_work AND c.entry_id IS NOT DISTINCT FROM p_entry
 AND (p_before IS NULL OR (c.created_at,c.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY c.created_at DESC,c.id DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,20),50))
 ) row),'[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_comments(uuid,uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_comments(uuid,uuid,timestamptz,uuid,integer) TO anon,authenticated;

CREATE FUNCTION public.read_social_reports(p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.social_moderators WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'Moderator required' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(row) FROM (
 SELECT r.id,r.comment_id,r.reason,r.created_at,c.publication_id,c.entry_id,c.body,c.status FROM public.social_reports r JOIN public.social_comments c ON c.id=r.comment_id
 JOIN public.published_works p ON p.id=c.publication_id AND p.is_public WHERE r.status='open'
 ORDER BY r.created_at,r.id LIMIT GREATEST(1,LEAST(COALESCE(p_limit,30),50))) row),'[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_reports(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_reports(integer) TO authenticated;

CREATE FUNCTION public.read_social_library(p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 24) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(row ORDER BY row.updated_at DESC,row.id DESC) FROM (
 SELECT targets.publication_id AS id,COALESCE(l.saved,false) AS saved,COALESCE(l.favorite,false) AS favorite,COALESCE(l.later,false) AS later,
 f.user_id IS NOT NULL AS following,GREATEST(l.updated_at,f.created_at) AS updated_at,p.is_public IS TRUE AS available,
 CASE WHEN p.is_public THEN p.title ELSE NULL END AS title,
 CASE WHEN p.is_public THEN p.type ELSE NULL END AS format
 FROM (SELECT publication_id FROM public.social_library WHERE user_id=auth.uid() UNION SELECT publication_id FROM public.social_work_follows WHERE user_id=auth.uid()) targets
 JOIN public.published_works p ON p.id=targets.publication_id
 LEFT JOIN public.social_library l ON l.publication_id=targets.publication_id AND l.user_id=auth.uid()
 LEFT JOIN public.social_work_follows f ON f.publication_id=targets.publication_id AND f.user_id=auth.uid()
 WHERE (p_before IS NULL OR (GREATEST(l.updated_at,f.created_at),targets.publication_id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 ORDER BY GREATEST(l.updated_at,f.created_at) DESC,targets.publication_id DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,24),50))) row),'[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.read_social_library(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_social_library(timestamptz,uuid,integer) TO authenticated;
-- Remove personal references even if the work has been withdrawn.
CREATE FUNCTION public.remove_social_library(p_work uuid,p_field text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR p_field IS NULL OR p_field NOT IN ('saved','favorite','later','all') THEN RAISE EXCEPTION 'Invalid owner operation' USING ERRCODE='42501'; END IF;
 UPDATE public.social_library SET saved=CASE WHEN p_field IN ('saved','all') THEN false ELSE saved END,
 favorite=CASE WHEN p_field IN ('favorite','all') THEN false ELSE favorite END,later=CASE WHEN p_field IN ('later','all') THEN false ELSE later END,updated_at=now()
 WHERE user_id=auth.uid() AND publication_id=p_work;
 DELETE FROM public.social_library WHERE user_id=auth.uid() AND publication_id=p_work AND NOT(saved OR favorite OR later);
END $$;
REVOKE EXECUTE ON FUNCTION public.remove_social_library(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_social_library(uuid,text) TO authenticated;

CREATE FUNCTION public.read_author_follow(p_author uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_author) THEN RAISE EXCEPTION 'Author unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('followers',(SELECT count(*) FROM public.profile_follows WHERE followed_id=p_author),
 'followed',(SELECT count(*) FROM public.profile_follows WHERE follower_id=p_author),
 'following',EXISTS(SELECT 1 FROM public.profile_follows WHERE followed_id=p_author AND follower_id=auth.uid()));
END $$;
CREATE FUNCTION public.set_author_follow(p_author uuid,p_value boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL OR p_author=auth.uid() OR p_value IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_author) THEN RAISE EXCEPTION 'Invalid author follow' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('author-follow:'||auth.uid()::text,0));
 IF p_value THEN INSERT INTO public.profile_follows(follower_id,followed_id) VALUES(auth.uid(),p_author) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.profile_follows WHERE follower_id=auth.uid() AND followed_id=p_author; END IF;
 RETURN public.read_author_follow(p_author);
END $$;
REVOKE EXECUTE ON FUNCTION public.read_author_follow(uuid),public.set_author_follow(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_author_follow(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_author_follow(uuid,boolean) TO authenticated;

-- Only the Vercel metrics endpoint has the proof. Browser anon/auth cannot choose identities or counters.
CREATE FUNCTION public.record_social_view(p_work uuid,p_entry uuid,p_visitor text,p_network text,p_proof text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.social_metric_settings%ROWTYPE; seen public.social_metric_visitors%ROWTYPE; fresh boolean; BEGIN
 SELECT * INTO cfg FROM public.social_metric_settings WHERE id;
 IF p_proof IS NULL OR length(p_proof)<32 OR cfg.token_hash IS NULL OR cfg.token_hash IS DISTINCT FROM
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_proof,'UTF8')),'hex') THEN RAISE EXCEPTION 'Server proof required' USING ERRCODE='42501'; END IF;
 IF p_visitor IS NULL OR p_network IS NULL OR p_visitor !~ '^[a-f0-9]{64}$' OR p_network !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid metric' USING ERRCODE='22023'; END IF;
 PERFORM public.social_assert_target(p_work,p_entry);
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('metric-network:'||p_network,0));
 PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('metric-visitor:'||p_work::text||COALESCE(p_entry::text,'')||p_visitor,0));
 SELECT * INTO seen FROM public.social_metric_visitors WHERE publication_id=p_work AND target_id=COALESCE(p_entry,p_work) AND visitor_hash=p_visitor FOR UPDATE;
 fresh:=NOT FOUND;
 IF NOT fresh AND seen.last_seen>now()-interval '24 hours' THEN RETURN '{"counted":false}'::jsonb; END IF;
 INSERT INTO public.social_metric_networks(network_hash,day) VALUES(p_network,current_date) ON CONFLICT DO NOTHING;
 IF (SELECT hits FROM public.social_metric_networks WHERE network_hash=p_network AND day=current_date)>=cfg.network_daily_limit THEN RETURN '{"counted":false}'::jsonb; END IF;
 UPDATE public.social_metric_networks SET hits=hits+1 WHERE network_hash=p_network AND day=current_date;
 INSERT INTO public.social_metric_visitors(publication_id,entry_id,visitor_hash) VALUES(p_work,p_entry,p_visitor)
 ON CONFLICT(publication_id,target_id,visitor_hash) DO UPDATE SET last_seen=now();
 INSERT INTO public.social_statistics(publication_id,entry_id,views,visitors) VALUES(p_work,p_entry,1,1)
 ON CONFLICT(publication_id,target_id) DO UPDATE SET views=public.social_statistics.views+1,visitors=public.social_statistics.visitors+CASE WHEN fresh THEN 1 ELSE 0 END;
 RETURN '{"counted":true}'::jsonb;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_social_view(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_view(uuid,uuid,text,text,text) TO anon;
-- Administrative maintenance only; never callable by a browser or metrics endpoint.
CREATE FUNCTION public.prune_social_metric_identifiers() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 DELETE FROM public.social_metric_visitors WHERE last_seen<now()-interval '45 days';
 DELETE FROM public.social_metric_networks WHERE day<current_date-7;
END $$;
REVOKE EXECUTE ON FUNCTION public.prune_social_metric_identifiers() FROM PUBLIC,anon,authenticated;
COMMIT;
